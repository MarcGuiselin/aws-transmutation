const DEFINITIONS = {
    'AWS::CloudFront::Distribution'(id, partition, user){
        return `arn:${partition}:cloudfront::${user}:distribution/${id}`;
    },
    'AWS::CertificateManager::Certificate'(id){
        return id;
    },
    'AWS::S3::Bucket'(id, partition){
        return [
            `arn:${partition}:s3:::${id}`,
            `arn:${partition}:s3:::${id}/*`
        ];
    },
    'AWS::Lambda::Function'(id, partition, user, zone){
        return `arn:${partition}:lambda:${zone}:${user}:function:${id}`;
    },
    'AWS::ApiGatewayV2::Api'(id, partition, user, zone){
        return [
            `arn:${partition}:apigateway:${zone}:${user}:/apis/${id}`,
            `arn:${partition}:apigateway:${zone}:${user}:/apis/${id}/*`
        ];
    },
    // TODO:
    // EC2
    // load balancers
    // glacier
    // efs
    // dynamodb
    // elasticache
    // and many more...
};

module.exports = function(resourceType, physicalResourceId, partition, region, user) {
    return resourceType in DEFINITIONS && DEFINITIONS[resourceType](physicalResourceId, partition, user, region) || undefined;
}