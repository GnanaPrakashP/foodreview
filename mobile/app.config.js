const appJson = require("./app.json");

const FORBIDDEN_PUBLIC_SUPABASE_NAME = /^EXPO_PUBLIC_.*SUPABASE.*(?:SERVICE(?:_ROLE|_KEY)?|SECRET|ADMIN|PRIVATE_KEY)/i;
const FORBIDDEN_CLIENT_CONFIG_NAME = /SUPABASE.*(?:SERVICE(?:_ROLE|_KEY)?|SECRET|ADMIN|PRIVATE_KEY)/i;
const DEV_AUTOLOGIN_NAMES = ["EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL", "EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD"];

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
  const productionBuild = env.EAS_BUILD === "true" || env.NODE_ENV === "production";
  const releaseDevCredential = productionBuild && DEV_AUTOLOGIN_NAMES.find((name) => Boolean(env[name]));
  if (releaseDevCredential) {
    throw new Error(`Development auto-login configuration is forbidden in production client builds: ${releaseDevCredential}`);
  }
  const applicationEnvironment = (env.EXPO_PUBLIC_APP_ENVIRONMENT ?? "local").trim().toLowerCase();
  if (applicationEnvironment === "production") {
    if (!env.EXPO_PUBLIC_SENTRY_DSN?.trim()) throw new Error("Production mobile Sentry DSN is required");
    const releaseId = env.EXPO_PUBLIC_RELEASE_ID?.trim() ?? "";
    if (!releaseId || releaseId === "local") throw new Error("Production mobile release ID is required");
    if (isLocalHttpUrl(env.EXPO_PUBLIC_API_BASE_URL ?? "")) throw new Error("Production mobile API URL cannot be local");
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
  if (!plugins.includes("@sentry/react-native")) plugins.push("@sentry/react-native");

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
