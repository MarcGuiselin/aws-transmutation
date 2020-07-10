const toml = require('toml');
const merge = require('deepmerge');

const { Matches } = require('../utils/wildcard');
const DefaultConfig = require('./default');

// Obtains settings for a pipeline given it's branch name
const GetConfigForBranch = async ({octokit, owner, repo, branch = 'master'}) => {
  // Copy default config
  let config = merge({}, DefaultConfig);

  // Add user config settings
  try {
    // Obtain config from file in repo
    let configFile = await octokit.repos.getContent({
      owner,
      repo,
      path: 'transmutation.toml',
      mediaType: {
        format: 'raw'
      }
    });

    // Merge user config with defaults
    try {
      config = merge(config, toml.parse(configFile.data));
    } catch (e) {
      console.error(e);
      throw `Couldn't parse transmutation.toml!`;
    }
  } catch (e) {
    console.warn(`Couldn't find transmutation.toml; Using default settings.`);
  }

  // All pipelines must specify a branch
  if (config.pipeline.some(p => !p.branch)) {
    throw `All pipelines in your transmutation.toml must specify a branch!`;
  }

  // Obtain settings for our pipeline
  const pipeline = 
    // We can treat the config as a pipeline, then the individual pipelines take precedence in order
    [config, ...config.pipeline]
      // We're only interested in pipelines that match this branch
      .filter(p => Matches(p.branch, branch))
      // Merge all pipeline settings into one.
      .reduce((merged, p) => merged = merge(merged, p), {});

  // Branch is not a setting
  delete pipeline.branch;

  // Neither is the array of pipelines
  delete pipeline.pipeline;

  return pipeline;
}

module.exports = {
  GetConfigForBranch
};