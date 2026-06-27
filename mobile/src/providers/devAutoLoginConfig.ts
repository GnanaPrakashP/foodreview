import { isSupabaseConfigured } from "@/api/supabase";

type RuntimeProcessGlobal = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function runtimeEnvValue(name: string) {
  return (globalThis as RuntimeProcessGlobal).process?.env?.[name];
}

export const devAutoLoginEmail =
  runtimeEnvValue("EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL") ?? process.env.EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL ?? "";
export const devAutoLoginPassword =
  runtimeEnvValue("EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD") ?? process.env.EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD ?? "";

export const devAutoLoginEnabled =
  __DEV__ && isSupabaseConfigured && Boolean(devAutoLoginEmail) && Boolean(devAutoLoginPassword);
