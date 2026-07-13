export type MobileReleaseEnvironment = "local" | "development" | "preview" | "production";

const supportedEnvironments = new Set<MobileReleaseEnvironment>(["local", "development", "preview", "production"]);

export function mobileReleaseEnvironment(): MobileReleaseEnvironment {
  const value = (process.env.EXPO_PUBLIC_APP_ENVIRONMENT ?? "local").trim().toLowerCase() as MobileReleaseEnvironment;
  return supportedEnvironments.has(value) ? value : "local";
}

export function authSchemeForEnvironment(environment = mobileReleaseEnvironment()) {
  if (environment === "preview") return "circlebites-preview";
  if (environment === "development" || environment === "local") return "circlebites-dev";
  return "circlebites";
}

export function releaseChannelForEnvironment(environment = mobileReleaseEnvironment()) {
  const configured = process.env.EXPO_PUBLIC_RELEASE_CHANNEL?.trim().toLowerCase();
  return configured || environment;
}
