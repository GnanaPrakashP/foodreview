# Supabase outage

## Symptoms and alert

Database/Auth/Storage/Realtime calls fail across services, health RPC is unavailable, or mobile connectivity is healthy while Supabase dependencies fail.

## Immediate checks

Check official provider status, project/region, database connections, Auth, REST, Realtime, and Storage separately; compare errors across API and workers and record the first correlation/release timestamp.

## Commands and evidence

Use `/api/health`, read-only operational reports when reachable, synthetic Auth/database probes, and provider incident ID. Do not repeatedly run heavy diagnostics against a degraded project.

## Containment

Pause nonessential schedulers/workers, preserve durable local/server queues, keep bounded retries/backoff, and present safe temporary failures. Never bypass authorization with service credentials in clients.

## Recovery and rollback

After provider recovery, resume jobs gradually, reconcile stale leases, sessions, queues, and Realtime catch-up. Restore to an isolated project only under the backup runbook and incident command.

## Verification, escalation, follow-up

Auth, canonical contracts, API flows, Storage authorization, Realtime, and all heartbeats healthy for two windows. Page platform and relevant domain owners; engage Supabase support. Record achieved RPO/RTO and dependency improvements.
