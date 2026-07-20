const appJson = require("./app.json");

const FORBIDDEN_PUBLIC_SUPABASE_NAME = /^EXPO_PUBLIC_.*SUPABASE.*(?:SERVICE(?:_ROLE|_KEY)?|SECRET|ADMIN|PRIVATE_KEY)/i;
const FORBIDDEN_CLIENT_CONFIG_NAME = /SUPABASE.*(?:SERVICE(?:_ROLE|_KEY)?|SECRET|ADMIN|PRIVATE_KEY)/i;
const FORBIDDEN_LEGACY_AUTH_NAME = /^EXPO_PUBLIC_DEV_AUTOLOGIN(?:_|$)/i;
const APP_ENVIRONMENTS = new Set(["local", "development", "preview", "production"]);
const HOME_LIST_ENGINES = new Set(["flatlist", "flashlist"]);
const PROD_IDENTITY = Object.freeze({
  androidPackage: "com.circlebites.mobile",
  displayName: "CircleBites",
  iosBundleIdentifier: "com.circlebites.mobile",
  scheme: "circlebites"
});

function applicationEnvironment(env = process.env) {
  const value = (env.EXPO_PUBLIC_APP_ENVIRONMENT ?? "local").trim().toLowerCase();
  if (!APP_ENVIRONMENTS.has(value)) throw new Error(`Unsupported mobile application environment: ${value || "missing"}`);
  return value;
}

function releaseIdentity(environment) {
  if (environment === "preview") {
    return {
      androidPackage: `${PROD_IDENTITY.androidPackage}.preview`,
      displayName: `${PROD_IDENTITY.displayName} Preview`,
      iosBundleIdentifier: `${PROD_IDENTITY.iosBundleIdentifier}.preview`,
      scheme: `${PROD_IDENTITY.scheme}-preview`
    };
  }
  if (environment === "development" || environment === "local") {
    return {
      androidPackage: `${PROD_IDENTITY.androidPackage}.dev`,
      displayName: `${PROD_IDENTITY.displayName} Dev`,
      iosBundleIdentifier: `${PROD_IDENTITY.iosBundleIdentifier}.dev`,
      scheme: `${PROD_IDENTITY.scheme}-dev`
    };
  }
  return PROD_IDENTITY;
}

function parsedPublicHttpsUrl(value, name, options = {}) {
  let url;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  const hostname = url.hostname.toLowerCase();
  const unsafeHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "10.0.2.2" ||
    hostname.endsWith(".local") || hostname.endsWith(".test") || hostname.endsWith(".invalid") ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  if (url.protocol !== "https:" || unsafeHost || (!options.allowUsername && url.username) || url.password) {
    throw new Error(`${name} must use a public HTTPS endpoint`);
  }
  return url;
}

function requiredNonPlaceholder(value, name, minimumLength = 16) {
  const normalized = value?.trim() ?? "";
  if (normalized.length < minimumLength || /replace|placeholder|example|your[-_ ]/i.test(normalized)) {
    throw new Error(`${name} is missing or contains a placeholder`);
  }
  return normalized;
}

function validateClientConfiguration(env = process.env, extra = {}) {
  const forbiddenLegacyAuthName = Object.keys(env).find((name) => FORBIDDEN_LEGACY_AUTH_NAME.test(name));
  if (forbiddenLegacyAuthName) {
    throw new Error(`Development auto-login configuration is forbidden: ${forbiddenLegacyAuthName}`);
  }
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
  const releaseBuild = env.EAS_BUILD === "true" || env.NODE_ENV === "production" || env.EXPO_PUBLIC_APP_ENVIRONMENT === "production";
  const environment = applicationEnvironment(env);
  const configuredHomeListEngine = env.EXPO_PUBLIC_HOME_LIST_ENGINE?.trim().toLowerCase();
  if (configuredHomeListEngine !== undefined && !HOME_LIST_ENGINES.has(configuredHomeListEngine)) {
    throw new Error("EXPO_PUBLIC_HOME_LIST_ENGINE must be flatlist or flashlist");
  }
  if (releaseBuild && environment === "local") {
    throw new Error("Release and EAS builds must bind EXPO_PUBLIC_APP_ENVIRONMENT explicitly");
  }
  if (environment === "production") {
    parsedPublicHttpsUrl(env.EXPO_PUBLIC_SUPABASE_URL, "EXPO_PUBLIC_SUPABASE_URL");
    parsedPublicHttpsUrl(env.EXPO_PUBLIC_API_BASE_URL, "EXPO_PUBLIC_API_BASE_URL");
    const publicWebUrl = parsedPublicHttpsUrl(env.EXPO_PUBLIC_WEB_BASE_URL, "EXPO_PUBLIC_WEB_BASE_URL");
    if (
      !["circlebites.in", "www.circlebites.in"].includes(publicWebUrl.hostname.toLowerCase()) ||
      publicWebUrl.pathname !== "/" ||
      publicWebUrl.search ||
      publicWebUrl.hash
    ) {
      throw new Error("EXPO_PUBLIC_WEB_BASE_URL must be the canonical CircleBites web origin");
    }
    const sentryDsn = parsedPublicHttpsUrl(env.EXPO_PUBLIC_SENTRY_DSN, "EXPO_PUBLIC_SENTRY_DSN", { allowUsername: true });
    if (!sentryDsn.username) throw new Error("EXPO_PUBLIC_SENTRY_DSN must include a public DSN key");
    requiredNonPlaceholder(env.EXPO_PUBLIC_SUPABASE_ANON_KEY, "EXPO_PUBLIC_SUPABASE_ANON_KEY", 20);
    const releaseId = requiredNonPlaceholder(env.EXPO_PUBLIC_RELEASE_ID, "EXPO_PUBLIC_RELEASE_ID", 7);
    if (releaseId === "local") throw new Error("Production mobile release ID is required");
    if (env.EXPO_PUBLIC_RELEASE_CHANNEL !== "production") {
      throw new Error("Production mobile release channel must be production");
    }
    if (extra?.eas?.projectId !== "920bf9e9-fe27-4c98-a35a-0d860d3e0402") {
      throw new Error("Production mobile EAS project ID is invalid");
    }
  }
}

function isLocalHttpUrl(value) {
  if (!value || !value.startsWith("http://")) return false;

  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "10.0.2.2" ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  } catch {
    return false;
  }
}

module.exports = ({ config: expoConfig } = {}) => {
  const environment = applicationEnvironment(process.env);
  const identity = releaseIdentity(environment);
  const config = {
    ...expoConfig,
    ...appJson.expo,
    name: identity.displayName,
    scheme: identity.scheme,
    android: {
      ...expoConfig?.android,
      ...appJson.expo.android,
      package: identity.androidPackage
    },
    ios: {
      ...expoConfig?.ios,
      ...appJson.expo.ios,
      bundleIdentifier: identity.iosBundleIdentifier
    },
    extra: {
      ...expoConfig?.extra,
      ...appJson.expo.extra,
      applicationEnvironment: environment,
      releaseChannel: process.env.EXPO_PUBLIC_RELEASE_CHANNEL ?? environment
    }
  };
  validateClientConfiguration(process.env, config.extra);
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const plugins = [...(config.plugins ?? [])].filter((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-dev-client"
  );
  plugins.push(["expo-dev-client", { addGeneratedScheme: environment !== "production" }]);
  if (!plugins.includes("expo-sqlite")) plugins.push("expo-sqlite");
  if (!plugins.includes("@sentry/react-native")) plugins.push("@sentry/react-native");
  plugins.push("./plugins/withReleaseNativePolicy");

  if (isLocalHttpUrl(apiBaseUrl) && environment !== "production") {
    config.ios = {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: {
          ...config.ios?.infoPlist?.NSAppTransportSecurity,
          NSAllowsLocalNetworking: true
        },
        NSLocalNetworkUsageDescription: "CircleBites connects to this Mac only while running the dedicated local-device test environment."
      }
    };
  }

  return {
    ...config,
    plugins
  };
};

module.exports.validateClientConfiguration = validateClientConfiguration;
module.exports.applicationEnvironment = applicationEnvironment;
module.exports.releaseIdentity = releaseIdentity;
