const AWS = require('aws-sdk');
const cloudformation = new AWS.CloudFormation();
const { Octokit } = require("@octokit/rest");
const toml = require('toml');
const crypto = require('crypto');
const atob = require('atob');
const merge = require('deepmerge');

const WildcardMatches = require('./src/wildcard-matches');

const { 
  PROJECT_NAME, PIPELINE_ROLE_ARN, ARTIFACTS_BUCKET, PERM_UPDATE_INVOKE,
  DEPLOY_ROLE_ARN, GITHUB_AUTH, GITHUB_OWNER, GITHUB_REPO, GITHUB_SECRET,
} = process.env;

const octokit = new Octokit({
  auth: GITHUB_AUTH,
  //repo: {
  //  owner: GITHUB_OWNER,
  //  repo: GITHUB_REPO,
  //},
});

function fatal(err, callback){
  console.error('Exited with error:', err);
  callback(err, {
    statusCode: 400,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({message: 'Bad Request. See cloudwatch logs.'}),
  });
}

function success(body, callback){
  console.log('Exited returning success:', body);
  callback(null, {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
  });
}

exports.handler = async (event, context, callback) => {
  console.log('RECEIVED EVENT', JSON.stringify(event));

  // This is a github webhook
  if(event.routeKey == "POST /" && event.headers){
    // Grab details from request
    const githubEvent = event.headers['x-github-event'];
    const githubSignature = event.headers['x-hub-signature'];
    if (!githubEvent || !githubSignature) {
      return fatal('Missing request header', callback);
    }

    // Respond to pings from github
    if (githubEvent == 'ping') {
      console.log('Ping from github, just sending a reply.');
      return success({msg: 'pong'}, callback);
    }

    // We need body content from this point on
    let body = event.isBase64Encoded ? atob(event.body) : event.body;
    if (!body) {
      return fatal('Missing request payload', callback);
    }

    // Hash body with our secret and compare to github's hash
    // This confirms the request is from a legit source
    const secretSignature = 'sha1=' + crypto.createHmac('sha1', GITHUB_SECRET).update(body).digest('hex');
    if (githubSignature !== secretSignature){
      return fatal('Mismatched secret signature.', callback);
    }

    // Parse payload
    let payload = {};
    try {
      let p = body.replace(/^payload=/, '');

      // We know we should decode if body starts with urlencoded `{`
      if(p.startsWith('%7B')){
        p = decodeURIComponent(p);
      }

      // Parse as json
      payload = JSON.parse(p);
    } catch (e) {
      console.error(e);
      return fatal(`Couldn't parse request payload!`, callback);
    }

    // Must be from our repo
    if (payload.repository.owner.name == GITHUB_OWNER && payload.repository.name == GITHUB_REPO){
      // Get default config
      let config = require('./src/default-config');

      // Add user config settings
      try {
        // Obtain config from file in repo
        let configFile = '';
        try {
          configFile = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: 'transmutation.toml',
            mediaType: {
              format: 'raw'
            }
          });
        } catch (e) {
          console.warn(`Couldn't find transmutation.toml; Using default settings.`);
        }

        // Merge user config with defaults
        config = merge(config, toml.parse(configFile.data));
      } catch (e) {
        console.error(e);
        return fatal(`Couldn't parse transmutation.toml!`, callback);
      }

      // All pipelines must specify a branch
      if (config.pipeline.some(p => !p.branch)) {
        return fatal(`All pipelines in your transmutation.toml must specify a branch!`, callback);
      }

      // Process commit
      const branch = payload.ref.replace(/^refs\/\w+\//, '');

      // Obtain settings for our pipeline
      const pipeline = 
        // We can treat the config as a pipeline, then the individual pipelines take precedence in order
        [config, ...config.pipeline]
          // We're only interested in pipelines that match this branch
          .filter(p => WildcardMatches(p.branch, branch))
          // Merge all pipeline settings into one.
          .reduce((merged, p) => merged = merge(merged, p), {});

      // Branch is not a setting
      delete pipeline.branch;

      // Neither is the array of pipelines
      delete pipeline.pipeline;

      // Only run pipeline if it is enabled
      if(pipeline.enabled){
        const pipelineStackName = `${PROJECT_NAME}--ci--${branch}-pipeline`;
        
        // See if a stack for this pipeline already exist
        try{
          await cloudformation.describeStacks({
            StackName: pipelineStackName
          }).promise();
          console.log(`Pipeline for '${branch}' already exists!`)
        } catch(e) {
          console.log(`Creating pipeline for '${branch}' with settings:`, JSON.stringify(pipeline, null, 2));

          await cloudformation.createStack({
            StackName: pipelineStackName,
            Capabilities: [
              'CAPABILITY_IAM',
              'CAPABILITY_NAMED_IAM',
              'CAPABILITY_AUTO_EXPAND',
            ],
            DisableRollback: true,
            EnableTerminationProtection: true,
            OnFailure: 'DO_NOTHING',
            RoleARN: PIPELINE_ROLE_ARN,
            TemplateURL: 'https://s3.amazonaws.com/aws-transmutation-pipeline/pipeline.yaml',
            Parameters: Object.entries({
              PipelineName: pipelineStackName,
              DeployStackName: `${PROJECT_NAME}--${branch}-deployment`,
              PipelineStage: pipeline.stage,
              PipelineFeatures: pipeline.features,
              EnvironmentCompute: pipeline.environment.compute,
              EnvironmentImage: pipeline.environment.image,
              EnvironmentType: pipeline.environment.type,
              // Source (GitHub)
              GithubToken: GITHUB_AUTH,
              GithubOwner: GITHUB_OWNER,
              GithubRepo: GITHUB_REPO,
              GithubBranch: branch,
              // Files
              PackagedTemplatePath: pipeline.file_paths.packaged_template,
              TemplateConfigurationPath: pipeline.file_paths.template_configuration,
              BuildSpecPath: pipeline.file_paths.build_spec,
              DeploySpecPath: pipeline.file_paths.deploy_spec,
              IntegSpecPath: pipeline.file_paths.integ_spec,
              CleanupSpecPath: pipeline.file_paths.cleanup_spec,
              // Resources
              ArtifactsBucket: ARTIFACTS_BUCKET,
              InvokePermissionsUpdate: PERM_UPDATE_INVOKE,
              DeployRoleArn: DEPLOY_ROLE_ARN,
              PipelineRoleArn: PIPELINE_ROLE_ARN,
            }).map(([k, v]) => ({ParameterKey: k, ParameterValue: v})),
          }).promise();
        }
      }
    }
  }

  success({msg: 'success'}, callback);
};