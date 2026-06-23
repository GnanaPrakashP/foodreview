# Repository Agent Instructions

For chat, memories, `shared_memory_messages`, `shared_memory_photos`, Supabase storage, media upload, upload intent/finalize, cleanup, RLS, notifications, or production hardening, use the `chat-production-hardening` skill.

Work phase by phase. Never skip a security gate, and never move to the next phase if the current gate has a Fail or Partial production blocker.

Do not weaken prior phase security. In particular:

- Do not expose service-role keys to the mobile app.
- Do not make private memory media public.
- Do not log private message bodies, signed URLs, media URLs, storage paths, or notification previews.
- Keep `SECURITY DEFINER` functions using safe `search_path`.
- Keep RLS scoped to authenticated user, room membership, uploader identity, bucket, path, upload intent, and blocked-user state.

After changes, run the relevant tests:

```sh
npm run test:memory-hardening
node --test tests/shared-memory-phase1-security.test.mjs
node --test tests/shared-memory-phase2-media-security.test.mjs
npm test
npm run typecheck
cd mobile && npm run typecheck
```

If Supabase CLI/config is unavailable, do not claim DB checks passed. Document exact staging/manual SQL steps instead.
