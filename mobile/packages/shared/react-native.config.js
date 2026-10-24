// Autolinking of the shared native module (TurboModule "ZedDevice").
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import org.qcin.zed.shared.ZedSharedPackage;',
        packageInstance: 'new ZedSharedPackage()',
      },
      ios: null,
    },
  },
};
