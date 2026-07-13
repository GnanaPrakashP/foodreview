# Privacy data inventory

This is an implementation inventory for store forms and legal review, not a legal conclusion.

| Data | Purpose and surface | Storage/sharing | Deletion/retention notes |
| --- | --- | --- | --- |
| Email and authentication state | signup, login, recovery | Supabase Auth; local SecureStore | local state clears on account-ending transitions; provider deletion is asynchronous |
| Profile/name | identity and Circle discovery | database and owner-scoped cache | deleted with account subject to safety/backup retention |
| Posts, dishes, restaurants, photos, videos | core sharing | database; public or access-controlled Storage according to visibility | user deletion, moderation and account cleanup; short-lived signed URLs have bounded residual lifetime |
| Optional location | nearby discovery and selected restaurant | account-scoped local storage; selected coordinates may accompany a post | permission optional; local copy cleared with owner |
| Memories, participants, messages, media, voice notes | private room collaboration | RLS/access-controlled database and Storage; owner-scoped offline SQLite | participant/deletion policy; local cache bounded and cleared |
| Circle, blocks, reports, moderation state | sharing authorization and safety | database; bounded moderation provider/operator processing | safety records may outlive visible content under reviewed retention |
| Push token/install ID/preferences | notifications and abuse controls | device SecureStore plus database; Expo push delivery | token disabled on provider rejection and removed on account ending |
| Drafts and pending uploads | termination/network recovery | per-owner MMKV/files in OS cache, excluded from backup | seven-day draft/recovery bound; cleared on cancel, success, logout/switch/deletion |
| Crash/performance diagnostics | reliability and security | Sentry with release/environment and bounded aggregate metadata | no user identity, content, URL/path, token or body; provider retention/access must be configured before launch |
| Operational job/health records | retries, deletion, media, push, moderation, scheduler | service-role-only database tables and privacy-safe logs | bounded cleanup/retention jobs; no private bodies or credentials |

Processors include Supabase, Expo/EAS, Sentry, restaurant/place providers, media-processing infrastructure and moderation providers where enabled. Production owner must record legal entity/controller identity, processor agreements, regions, exact retention, support response process, age policy and jurisdiction-specific store answers.
