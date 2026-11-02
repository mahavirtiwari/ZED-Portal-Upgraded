const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { FileStore } = require('metro-cache');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * npm workspaces: watch the whole mobile/ folder (for @zed/shared) and resolve modules from the app first,
 * then from the hoisted mobile/node_modules.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // The transform and file-map caches live in mobile/.metro-cache (ignored), not in %TEMP% on the system drive.
  cacheStores: [new FileStore({ root: path.join(workspaceRoot, '.metro-cache') })],
  fileMapCacheDirectory: path.join(workspaceRoot, '.metro-cache', 'file-map'),
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')],
    disableHierarchicalLookup: false,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
