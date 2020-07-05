const AWS = require('aws-sdk');
const axios = require('axios');

const CONTEXT = 'CodePipeline';
const {GITHUB_AUTH, GITHUB_OWNER, GITHUB_REPO} = process.env;
const GITHUB_API_HEADERS = {
    headers: {
        'Content-Type': 'application/json'
    },
    auth: {
        password: GITHUB_AUTH
    }
};

async function GetPipelineExecution(pipelineName, pipelineExecutionId) {
    const result = await new AWS.CodePipeline().getPipelineExecution({pipelineName, pipelineExecutionId}).promise();
    const {revisionUrl, revisionId: sha} = result.pipelineExecution.artifactRevisions[0];

    const matches = /github.com\/(.+)\/(.+)\/commit\//.exec(revisionUrl);

    return {
        owner: matches[1],
        repository: matches[2],
        sha
    };
}

exports.handler = async (event) => {
    const region = event.region;
    const executionId = event.detail['execution-id'];
    const pipelineName = event.detail.pipeline;
    const [state, description] = {
        STARTED:   ['pending', 'Build started'], 
        SUCCEEDED: ['success', 'Build succeeded'],
        FAILED:    ['failure', 'Build failed!']
    }[event.detail.state];

    if (state) {
        // Get details from updated pipeline
        const {owner, repository, sha} = await GetPipelineExecution(pipelineName, executionId);

        if(owner == GITHUB_OWNER && repository == GITHUB_REPO){
            // Status update parameters
            const parameters = {
                state,
                target_url: `https://${region}.console.aws.amazon.com/codepipeline/home?region=${region}#/view/${pipelineName}`,
                description,
                context: CONTEXT
            };
            
            // Post status to GitHub
            await axios.post(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/statuses/${sha}`,
                parameters,
                GITHUB_API_HEADERS
            );
        }
    }
}