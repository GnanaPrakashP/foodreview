# Continuous media worker deployment

The production API remains on Vercel. Media processing runs as a separate,
continuous Render background worker because video jobs can exceed a serverless
request lifetime and must keep polling independently of user traffic.

## One-time deployment

1. Install and authenticate the Render CLI:

   ```sh
   brew install render
   render login
   render blueprints validate render.yaml
   ```

2. In Render, create a Blueprint from this repository's root `render.yaml`.
   Approve the `circlebites-media-worker` service only after entering every
   `sync: false` value. Never paste these values into the repository or a
   mobile/EAS environment.

3. Required secret values:

   ```text
   APP_MIGRATION_HEAD=202607270001
   APP_RELEASE=<the deployed git SHA>
   NEXT_PUBLIC_SUPABASE_URL=<production project URL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<production publishable/anon key>
   SUPABASE_SERVICE_ROLE_KEY=<production service-role key>
   MEDIA_WORKER_SECRET=<the same 32+ character value used by the worker container>
   GOOGLE_API_KEY=<server-only Vision/Video Intelligence key>
   SENTRY_DSN=<production server/worker DSN>
   ```

`APP_MIGRATION_HEAD` is non-secret and is pinned in the Blueprint. Update it
whenever a newer production migration becomes the release head.

The Blueprint creates two Singapore worker instances. Each process generates a
unique worker ID, uses atomic database claims, sends lease heartbeats, and
honours a five-minute graceful shutdown window. Automatic deployment is gated
on repository checks.

## Release and verification

After committing and pushing a release:

```sh
render services
render services instances circlebites-media-worker
render logs --resources <worker-service-id> --tail
npm run operations:health:media
```

The protected worker endpoint must report a fresh heartbeat, claims when work
is queued, no stale leases, and a decreasing oldest queued age. A queue with
jobs older than 120 seconds and zero claims in the previous minute is degraded
and returns HTTP 503.

To validate the same image locally against the configured environment without
publishing it:

```sh
npm run media:worker:build
docker run --rm --env-file .env.local foodreview-media-worker:phase2
```

The local command is a validation/fallback only. It is not a production
deployment and stops processing as soon as the local container exits.
