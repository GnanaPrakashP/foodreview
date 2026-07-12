const appJson = require("./app.json");

const FORBIDDEN_PUBLIC_SUPABASE_NAME = /^EXPO_PUBLIC_.*SUPABASE.*(?:SERVICE(?:_ROLE|_KEY)?|SECRET|ADMIN|PRIVATE_KEY)/i;
const FORBIDDEN_CLIENT_CONFIG_NAME = /SUPABASE.*(?:SERVICE(?:_ROLE|_KEY)?|SECRET|ADMIN|PRIVATE_KEY)/i;

function validateClientConfiguration(env = process.env, extra = {}) {
  const forbiddenEnvironmentName = Object.keys(env).find((name) =>
    name === "EXPO_PUBLIC_SUPABASE_SERVICE_KEY" || FORBIDDEN_PUBLIC_SUPABASE_NAME.test(name)
  );
  if (forbiddenEnvironmentName) {
    throw new Error(`Privileged Supabase environment name is forbidden in Expo client builds: ${forbiddenEnvironmentName}`);
  }
  const forbiddenExtraName = Object.keys(extra ?? {}).find((name) => FORBIDDEN_CLIENT_CONFIG_NAME.test(name));
  if (forbiddenExtraName) {
    throw new Error(`Privileged Supabase configuration is forbidden in Expo extra: ${forbiddenExtraName}`);
  }
}

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
  validateClientConfiguration(process.env, config.extra);
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const plugins = [...(config.plugins ?? [])];
  if (!plugins.includes("expo-sqlite")) plugins.push("expo-sqlite");

  if (isLocalHttpUrl(apiBaseUrl)) {
    plugins.push("./plugins/withAndroidCleartextForLocalApi");
    config.ios = {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: {
          ...config.ios?.infoPlist?.NSAppTransportSecurity,
          NSAllowsLocalNetworking: true
        }
      }
    };
  }

  return {
    ...config,
    plugins
  };
};

module.exports.validateClientConfiguration = validateClientConfiguration;
