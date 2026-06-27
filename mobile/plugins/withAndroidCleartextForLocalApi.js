const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withAndroidCleartextForLocalApi(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];

    if (application) {
      application.$ = application.$ ?? {};
      application.$["android:usesCleartextTraffic"] = "true";
    }

    return manifestConfig;
  });
};
