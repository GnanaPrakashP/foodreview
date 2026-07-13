# Alert policy

The machine-readable source is `config/operations-alerts.json`. Threshold evaluation is deterministic and covered by tests. Production monitoring must evaluate Sentry-source alerts in Sentry and poll the service-role operations health contract at least every five minutes.

## Severity and routing

- Warning: assign to the listed owner during support hours and investigate the trend.
- Critical: page the on-call owner immediately, open an incident, preserve correlation/release metadata, and follow the linked runbook.
- Unknown: treat as monitoring failure. If it lasts two evaluation windows, page platform on-call.

Owners are mobile, API, platform, media, privacy, push, or trust and safety. Critical privacy, credential, private-media, or deletion-integrity events also notify the security/privacy lead immediately.

Alerts must deduplicate on alert ID plus environment, require two consecutive samples for noisy rate/latency metrics, and resolve only after two healthy samples. Zero-tolerance integrity alerts—invalid indexes, unvalidated constraints, deletion ambiguity—may fire on the first sample.

## Baseline thresholds

Mobile alerts cover crash-free sessions below 99.5%/99.0%, ANR rate above 0.3%/1.0%, and cold-start p95 above 2.5s/4s. API alerts cover 5xx above 1%/3%, p95 above 800/1500ms, and p99 above 1500/3000ms. Database, media, deletion, push, moderation, and scheduler thresholds are declared in the configuration file and must be changed in code review with a runbook update.

An alert is not proof of root cause. Operators should compare release, environment, endpoint/job name, duration, safe error code, queue age, and the immediately preceding deployment or migration.
