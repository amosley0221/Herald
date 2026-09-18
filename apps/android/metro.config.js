// Metro, configured for this monorepo.
//
// The app lives at apps/android but @herald/core resolves to packages/core, so
// Metro has to watch the repo root and look in both node_modules trees.
// Hierarchical lookup is disabled because it lets Metro silently pick up a
// second copy of React from a nested tree, which breaks hooks at runtime in a
// way that is very hard to diagnose.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
