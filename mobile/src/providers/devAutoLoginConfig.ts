import { isSupabaseConfigured } from "@/api/supabase";

type RuntimeProcessGlobal = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function runtimeEnvValue(name: string) {
  return (globalThis as RuntimeProcessGlobal).process?.env?.[name];
}

// Keep local automation convenient without ever retaining its credentials in
// an optimized client bundle. Metro replaces `__DEV__` at compile time and
// drops the unreachable branch for release builds.
export const devAutoLoginEmail = __DEV__
  ? runtimeEnvValue("EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL") ?? process.env.EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL ?? ""
  : "";
export const devAutoLoginPassword = __DEV__
  ? runtimeEnvValue("EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD") ?? process.env.EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD ?? ""
  : "";

export const devAutoLoginEnabled =
  __DEV__ && isSupabaseConfigured && Boolean(devAutoLoginEmail) && Boolean(devAutoLoginPassword);
