# Chat Production Hardening

Use this skill for chat, memories, `shared_memory_messages`, `shared_memory_photos`, Supabase storage, media upload, upload intent/finalize, cleanup, RLS, notifications, or production hardening work.

## Workflow

1. Read `docs/security/CHAT_PRODUCTION_STATUS.md`.
2. Determine the current phase.
3. Implement only the current phase or current blocker-fix phase.
4. Run tests.
5. Do a security gate review.
6. Update `docs/security/CHAT_PRODUCTION_STATUS.md`.
7. Stop. Do not automatically start the next phase.

## Phase Order

1. Phase 1: Critical Security Fixes
2. Phase 1.1: Final Critical Security Cleanup
3. Phase 2: Media Upload and Storage Hardening
4. Phase 2.1: Final Media Upload Trust-Boundary Fixes
5. Phase 2.2: Cleanup Correctness and Production DB Verification
6. Phase 3: Database and Scalability Fixes
7. Phase 4: Mobile Performance Fixes
8. Phase 5: Monitoring and Production Operations
9. Phase 6: Tests and CI/CD

## Security Rules

- Work phase by phase.
- Never skip a security gate.
- Never move to the next phase if the current gate has a Fail or Partial production blocker.
- Do not weaken prior phase security.
- Do not expose service-role keys to the mobile app.
- Do not make private memory media public.
- Do not log private message bodies, signed URLs, media URLs, storage paths, or notification previews.
- Keep `SECURITY DEFINER` functions using safe `search_path`.
- Keep RLS scoped to authenticated user, room membership, uploader identity, bucket, path, upload intent, and blocked-user state.

## Required Checks

Run relevant tests after changes:

```sh
npm run test:memory-hardening
node --test tests/shared-memory-phase1-security.test.mjs
node --test tests/shared-memory-phase2-media-security.test.mjs
npm test
npm run typecheck
cd mobile && npm run typecheck
```

If Supabase CLI/config is unavailable, do not claim DB checks passed. Document exact staging/manual SQL steps instead.
