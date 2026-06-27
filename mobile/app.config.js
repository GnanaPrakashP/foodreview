const appJson = require("./app.json");

function isLocalHttpUrl(value) {
  if (!value || !value.startsWith("http://")) return false;

  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "10.0.2.2";
  } catch {
    return false;
  }
}

module.exports = ({ config: expoConfig } = {}) => {
  const config = {
    ...expoConfig,
    ...appJson.expo,
    android: {
      ...expoConfig?.android,
      ...appJson.expo.android
    },
    ios: {
      ...expoConfig?.ios,
      ...appJson.expo.ios
    },
    extra: {
      ...expoConfig?.extra,
      ...appJson.expo.extra
    }
  };
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const plugins = [...(config.plugins ?? [])];

  if (isLocalHttpUrl(apiBaseUrl)) {
    plugins.push("./plugins/withAndroidCleartextForLocalApi");
  }

  return {
    ...config,
    plugins
  };
};
