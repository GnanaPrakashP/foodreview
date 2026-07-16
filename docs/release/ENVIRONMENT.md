# CircleBites release environments

CircleBites has three EAS environments. `development` uses the `circlebites-dev` scheme and `.dev` application identifiers; `preview` uses `circlebites-preview` and `.preview`; `production` alone uses `circlebites`, `com.circlebites.mobile`, and store distribution. Local native development maps to the development identity. The checked-in Android Gradle project and generated iOS configuration derive the same IDs, labels and callback schemes from `EXPO_PUBLIC_APP_ENVIRONMENT`; EAS must supply endpoint values from its named environment. No profile embeds credentials in `eas.json`.

## Variable ownership

- Mobile-public/build-time: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`, `EXPO_PUBLIC_APP_ENVIRONMENT`, `EXPO_PUBLIC_RELEASE_CHANNEL`, `EXPO_PUBLIC_RELEASE_ID`, `EXPO_PUBLIC_SENTRY_DSN`, and the traces sample rate. These values are visible to anyone inspecting the app.
- Build-only secret manager: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `EXPO_TOKEN`, Android keystore material, Apple certificates and profiles. They may be exposed only to the protected `production-release` CI environment.
- Server-only: Supabase service role, rate-limit HMAC, observability secret, paid provider keys and moderation operator secret.
- Worker-only: media, deletion, cleanup and push-delivery worker secrets.
- Scheduler-only: cron, Memory cleanup and dish-curation secrets.

Production Expo configuration fails before bundling when endpoints are not public HTTPS, public values contain placeholders, the Sentry DSN/release is absent, the channel is not `production`, an EAS build has no environment, or any privileged Supabase-looking public variable exists. No development auto-login exists in the application.

Secret values are owned in the deployment secret manager, not `.env`, Git, EAS profile JSON, logs or build reports. Rotate values through the owning provider and rebuild affected artifacts. Artifact scans report only pattern names and hashes.

## Authentication redirects

Configure each Supabase Auth environment with only its matching callbacks:

- development: `circlebites-dev://auth/callback`
- preview: `circlebites-preview://auth/callback`
- production: `circlebites://auth/callback`

Google OAuth returns through the matching `/auth/callback`. Passwordless email authentication uses a six-digit OTP and does not require an app callback. Password recovery callbacks are not allowlisted. Hosted Supabase must use the checked-in OTP length, expiry, resend interval and `{{ .Token }}` email template, and must activate `public.circlebites_access_token_hook` as its SQL Custom Access Token Hook. The app validates scheme, host, path, flow mode, one-time nonce and expiry for OAuth callbacks.

`supabase/config.toml` is the local-development configuration and contains localhost service settings. Do not push it wholesale to a hosted project. Apply the OTP fields and template through an environment-scoped hosted configuration that preserves the hosted site URL, redirect allowlist, MFA settings, email confirmation policy and unrelated Storage configuration.

Native session persistence is installation-bound. Supabase sessions remain in SecureStore through close, force-stop, reboot, ordinary update and Android cache clearing. A separate marker in the ordinary app document sandbox survives update/cache clearing but is removed by clear-data or uninstall. The first release containing this marker promotes only an exact active-owner marker left in the prior app sandbox; that prevents rollout from being mistaken for reinstall. If neither marker exists while iOS Keychain credentials survive, startup deletes the orphaned session and PKCE/install state before the authenticated tree can mount. Android backup and device-transfer rules exclude SecureStore, MMKV and databases, and application backup is disabled.

## OTA policy

Expo Updates/EAS Update is disabled. Release binaries contain their JavaScript and are distributed through internal/store tracks. No update channel may deliver JavaScript independently of its native runtime. A bad release is recovered with API feature containment and a new store binary; store binaries cannot be remotely recalled.
