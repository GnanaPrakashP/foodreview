const { withInfoPlist, withPodfileProperties } = require("expo/config-plugins");

module.exports = function withReleaseNativePolicy(config) {
  const production = config.extra?.applicationEnvironment === "production";

  config = withInfoPlist(config, (mod) => {
    const transportSecurity = {
      ...(mod.modResults.NSAppTransportSecurity ?? {}),
      NSAllowsArbitraryLoads: false
    };
    if (production) delete transportSecurity.NSAllowsLocalNetworking;
    mod.modResults.NSAppTransportSecurity = transportSecurity;
    return mod;
  });

  return withPodfileProperties(config, (mod) => {
    if (production) mod.modResults.EX_DEV_CLIENT_NETWORK_INSPECTOR = "false";
    return mod;
  });
};
