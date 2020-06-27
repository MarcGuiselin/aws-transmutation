const AWS = require('aws-sdk');
const IAM = new AWS.IAM();
const CloudFormation = new AWS.CloudFormation();
const CodePipeline = new AWS.CodePipeline();
const ArnFromResourceId = require('./aws-arn-from-resource-id');

const {STACK_NAME, ROLE_NAME, POLICY_NAME, AWS_PARTITION, AWS_REGION, AWS_ACCOUNT} = process.env;

exports.handler = async (event, context) => {
    const jobId = event['CodePipeline.job'].id;

    try {
        // Retrieve a list of all the resources created by our stack
        let stackResources = (await CloudFormation.describeStackResources({
                StackName: STACK_NAME
            }).promise()).StackResources;

        // Get arns from resources array
        let arns = stackResources
            .filter(r => r.ResourceStatus == 'CREATE_COMPLETE')
            .map(r => ArnFromResourceId(r.ResourceType, r.PhysicalResourceId, AWS_PARTITION, AWS_REGION, AWS_ACCOUNT))
            .filter(a => a)
            .flat();

        if(arns.length){
            // Update role
            console.log('Updating Role...');
            await IAM.putRolePolicy({
                PolicyDocument: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: {
                        Effect: 'Allow',
                        Action: '*',
                        Resource: arns
                    }
                }), 
                PolicyName: POLICY_NAME, 
                RoleName: ROLE_NAME
            }).promise();
        }

        // Notify AWS CodePipeline of a successful job
        await CodePipeline.putJobSuccessResult({jobId}).promise();
        
        // Success
        context.succeed({});
    } catch(err) {
        // Notify AWS CodePipeline of a failed job
        await CodePipeline.putJobFailureResult({
            jobId,
            failureDetails: {
                message: err.toString(),
                type: 'JobFailed',
                externalExecutionId: context.awsRequestId
            }
        }).promise();

        // Failure
        context.fail(err);
    }
}