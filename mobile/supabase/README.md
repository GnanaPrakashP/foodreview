# Shared Supabase backend

The mobile application does not own an independent Supabase project or migration history.

The canonical Supabase project lives at the repository root.

The only executable migration root is:

```text
../../supabase/migrations
```

Run all database commands from the repository root:

```sh
cd ../..
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
```

Do not add `mobile/supabase/config.toml`, create `mobile/supabase/migrations`, or run a mobile-root `supabase db push`. CI rejects executable SQL or a Supabase project configuration under this directory.

The retired migration hashes and reconciliation decisions are recorded in `docs/database/migration-history-manifest.json`. Historical duplicate/conflicting mobile copies are preserved outside an executable Supabase project at `docs/database/legacy-mobile-migrations`.
