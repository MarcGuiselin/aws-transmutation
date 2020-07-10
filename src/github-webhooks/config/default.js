module.exports = {
  enabled: false,
  branch: '*',
  stack: 'default',
  stage: 'test',
  features: 'Build',
  description: 'No Description',
  delete_old_pipeline: false,
  file_paths: {
    packaged_template: 'packaged-template.yaml',
    template_configuration: 'test-configuration.json',
    build_spec: 'build.yaml',
    deploy_spec: 'deploy.yaml',
    integ_spec: 'integ.yaml',
    cleanup_spec: 'integ.yaml',
  },
  environment: {
    compute_type: 'BUILD_GENERAL1_SMALL',
    environment_type: 'LINUX_CONTAINER',
    image: 'aws/codebuild/amazonlinux2-x86_64-standard:3.0',
  },
}