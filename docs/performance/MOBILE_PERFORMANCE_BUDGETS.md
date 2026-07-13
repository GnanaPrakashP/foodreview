# Mobile performance budgets

Date: 2026-07-13
Owner: Production Hardening Phase 6
Machine-readable authority: `config/mobile-performance-budgets.json`

## Purpose

These budgets prevent structural mobile regressions and define the measurements required before release. A repository gate proves architecture and artifact ceilings; it does not substitute for representative staging data, physical devices, or Phase 9 capacity testing.

## Timing budgets

| Metric | Budget | Measurement rule |
| --- | ---: | --- |
| JavaScript start to useful Circle content | 1,500 ms | Five cold samples from an installed release/profile build with valid owner-scoped cached data |
| Owner cache hydration after boundary begins | 200 ms | `app.cache_hydration`; excludes remote account-status validation |
| Warm return to retained tab cached content | 150 ms | Five samples per Circle, Explore, and Profile tab |

Useful content means real cached or server content, not a splash screen, spinner, skeleton, error state, or navigation shell. Development builds are invalid evidence.

## Rendering and resource budgets

| Control | Budget |
| --- | ---: |
| Feed initial render | 4 items |
| Feed render batch | 4 items |
| Feed window | 5 viewports |
| Active feed video players | 1 |
| Wi-Fi/Ethernet thumbnail prefetch | Next 2 image thumbnails |
| Repeated representative-flow PSS growth | At most 40 MiB |

The memory budget must be measured with representative content. Error-shell timeouts or an empty feed are diagnostic evidence but cannot pass the representative-flow budget.

## Bundle budgets

| Artifact | Budget |
| --- | ---: |
| Android release APK | 178,257,920 bytes (170 MiB) |
| Native Expo export, each platform | 19,922,944 bytes (19 MiB) |
| Hermes bundle, each platform | 11,010,048 bytes (10.5 MiB) |
| Font assets, each platform | 2,621,440 bytes (2.5 MiB) |

The Phase 5 Android reference is 151,758,357 bytes at commit `0af380ac1533253dca07af95f144ad6892714f50`. `npm run report:mobile-bundle` fails when a checked ceiling is exceeded.

## Phase 6 measured artifacts

| Artifact | Before icon deep imports | Phase 6 final | Change |
| --- | ---: | ---: | ---: |
| Android native export | 19,206,051 B | 16,647,373 B | -2,558,678 B (-13.32%) |
| Android Hermes | 9,441,097 B | 9,262,946 B | -178,151 B (-1.89%) |
| Android fonts | 4,480,956 B | 2,101,500 B | -2,379,456 B (-53.10%) |
| iOS native export | 19,198,495 B | 16,639,725 B | -2,558,770 B (-13.33%) |
| iOS Hermes | 9,432,544 B | 9,254,301 B | -178,243 B (-1.89%) |
| iOS fonts | 4,480,956 B | 2,101,500 B | -2,379,456 B (-53.10%) |
| Android release APK | 151,758,357 B Phase 5 baseline | 151,601,421 B | -156,936 B (-0.10%) |

Only Ionicons and MaterialCommunityIcons remain in the native exports. Product assets were preserved. The report is based on separate production Android and iOS exports because an attempted all-platform export also selected web, whose unrelated `expo-sqlite` WASM asset is not installed; native exports are the Phase 6 requirement.

## Instrumentation and privacy

Set `EXPO_PUBLIC_PERFORMANCE_PROFILE=1` only in a controlled release-profile artifact. Metrics are aggregate stable names, durations, counts, and resource totals. The instrumentation has a 250-event cap and must never record content, search terms, usernames, user IDs, tokens, media URLs, Storage paths, or signed URLs.

Commands:

```text
npm run validate:mobile-performance
npm run report:mobile-performance
npm run test:mobile-performance
npm run report:mobile-bundle
npm run profile:mobile-performance -- --serial=<adb-serial> --samples=5 --output=<report.json>
```

## Release acceptance

A release candidate needs representative mixed image/video data, five cold and warm samples per supported device class, feed fast-scroll and repeated tab cycles, a long Memory chat, offline/reconnect and background/foreground cycles, active-player verification, and memory/frame evidence. Physical mid-range Android and physical iOS evidence are mandatory before production even when repository budgets pass.
