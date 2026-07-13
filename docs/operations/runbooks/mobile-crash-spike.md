# Mobile crash or ANR spike

## Symptoms and alert

Crash-free sessions fall below threshold, ANR/app-hang rate rises, or native watchdog/NDK events cluster by release.

## Immediate checks

Confirm environment, platform, app version/build, release, rollout percentage, first-seen time, affected OS/device family, and whether auth/startup/media/Memory flow failures moved at the same time. Compare against the prior release without opening private event content.

## Commands and evidence

Run `npm run operations:release` and `npm run operations:health`; preserve Sentry issue/event IDs, safe tags, stack symbolication state, rollout history, and correlation IDs.

## Containment

Pause staged rollout. Disable only the implicated remote feature if an existing safe switch exists. Do not bypass cache isolation, media authorization, or server validation.

## Recovery and rollback

Rollback the mobile rollout or submit an expedited compatible build. Keep APIs backward compatible for installed versions. Upload matching symbols/source maps and verify native plus JavaScript stacks.

## Verification, escalation, follow-up

Require two healthy alert windows and successful cold start, warm resume, login/logout, feed, media, Memory, and comments smoke tests. Page mobile on-call; page platform/security if auth or private-data boundaries are involved. Add a regression test and release-specific postmortem action.
