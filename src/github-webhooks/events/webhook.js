const AWS = require('aws-sdk');
const cloudformation = new AWS.CloudFormation();
const { Octokit } = require("@octokit/rest");
const crypto = require('crypto');
const atob = require('atob');

const { GetConfigForBranch } = require('../config');

const { 
  PROJECT_NAME, PIPELINE_ROLE_ARN, ARTIFACTS_BUCKET, PERM_UPDATE_INVOKE,
  DEPLOY_ROLE_ARN, GITHUB_AUTH, GITHUB_OWNER, GITHUB_REPO, GITHUB_SECRET,
} = process.env;

const octokit = new Octokit({
  auth: GITHUB_AUTH,
});

const webhook = async event => {
  // Grab details from request
  const githubEvent = event.headers['x-github-event'];
  const githubSignature = event.headers['x-hub-signature'];
  if (!githubEvent || !githubSignature) {
    throw 'Missing request header';
  }

  // Respond to pings from github
  if (githubEvent == 'ping') {
    console.log('Ping from github, just sending a reply.');
    return { msg: 'pong' };
  }

  // We need body content from this point on
  let body = event.isBase64Encoded ? atob(event.body) : event.body;
  if (!body) {
    throw 'Missing request payload';
  }

  // Hash body with our secret and compare to github's hash
  // This confirms the request is from a legit source
  const secretSignature = 'sha1=' + crypto.createHmac('sha1', GITHUB_SECRET).update(body).digest('hex');
  if (githubSignature !== secretSignature){
    throw 'Mismatched secret signature.';
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
    throw `Couldn't parse request payload!`;
  }

  // Important details from payload
  const branch = payload.ref.replace(/^refs\/\w+\//, '');
  const commit = payload.after;

  // Must be from our repo
  if (payload.repository.owner.name == GITHUB_OWNER && payload.repository.name == GITHUB_REPO){
    
    // Obtain settings for this pipeline
    const config = GetConfigForBranch({
      octokit,
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      branch,
    });

    // Only run pipeline if it is enabled
    if(config.enabled){
      // We must be able to uniquely identify each pipeline stack from each other; so we
      // create an unique identifier with a short length to stay under the 128 character limit
      const alphanumericBranchName = branch.replace(/[^a-zA-z0-9_-]/g, '_');
      const uniqueBranchHash = crypto.createHash('sha1').update(branch).digest('hex').substring(0, 12);
      const uniqueBranchIdentifier = `${alphanumericBranchName.substring(0, 20)}-${uniqueBranchHash}`;
      
      // A name for this branch's unique pipeline
      const pipelineName = `${PROJECT_NAME}--ci--${uniqueBranchIdentifier}-pipeline`;
      
      // See if a stack for this pipeline already exist
      try{
        await cloudformation.describeStacks({
          StackName: pipelineName
        }).promise();

        // No error means this stack exists. We don't need to do anything, since the pipeline will automatically run
        console.log(`Pipeline for '${branch}' already exists!`)
      } catch(e) {
        // Error means this pipeline doesn't exist, so let's create one
        console.log(`Creating pipeline for '${branch}' with settings:`, JSON.stringify(config, null, 2));

        // Create stack
        const createStackPromise = cloudformation.createStack({
          StackName: pipelineName,
          Capabilities: [
            'CAPABILITY_IAM',
            'CAPABILITY_NAMED_IAM',
            'CAPABILITY_AUTO_EXPAND',
          ],
          DisableRollback: true,
          EnableTerminationProtection: true,
          //OnFailure: 'DO_NOTHING',
          RoleARN: PIPELINE_ROLE_ARN,
          TemplateURL: 'https://s3.amazonaws.com/aws-transmutation-pipeline/pipeline.yaml',
          Parameters: Object.entries({
            PipelineName: pipelineName,
            DeployStackName: config.stack == 'default' ? `${PROJECT_NAME}--${uniqueBranchIdentifier}-deployment` : config.stack,
            PipelineStage: config.stage,
            PipelineFeatures: config.features,
            EnvironmentCompute: config.environment.compute,
            EnvironmentImage: config.environment.image,
            EnvironmentType: config.environment.type,
            // Source (GitHub)
            GithubToken: GITHUB_AUTH,
            GithubOwner: GITHUB_OWNER,
            GithubRepo: GITHUB_REPO,
            GithubBranch: branch,
            // Files
            PackagedTemplatePath: config.file_paths.packaged_template,
            TemplateConfigurationPath: config.file_paths.template_configuration,
            BuildSpecPath: config.file_paths.build_spec,
            DeploySpecPath: config.file_paths.deploy_spec,
            IntegSpecPath: config.file_paths.integ_spec,
            CleanupSpecPath: config.file_paths.cleanup_spec,
            // Resources
            ArtifactsBucket: ARTIFACTS_BUCKET,
            InvokePermissionsUpdate: PERM_UPDATE_INVOKE,
            DeployRoleArn: DEPLOY_ROLE_ARN,
            PipelineRoleArn: PIPELINE_ROLE_ARN,
          }).map(([k, v]) => ({ParameterKey: k, ParameterValue: v})),
        }).promise();

        // Show 'pending' status on github as pipeline is being deployed
        const createCommitStatus = octokit.repos.createCommitStatus({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          sha: commit,
          state: 'pending',
          target_url: `https://console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipelineName}/view`,
          description: 'Build started',
          context: 'Transmutation CI',
        });

        // Create pipeline status page
        const createStatusPage = Promise.resolve();

        // Wait for all actions to complete
        await Promise.all([createStackPromise, createCommitStatus, createStatusPage]);
      }
    }
  }

  return { msg: 'success' };
};

exports = webhook;