import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    JSON,
    Math,
    Number,
    URLSearchParams,
    exports: mod.exports,
    module: mod,
    require: () => { throw new Error("Unexpected import"); }
  });
  return mod.exports;
}

test("Home feed locations are validated and rounded to stable cache coordinates", () => {
  const serverLocation = loadTs("lib/home-feed-location.ts");
  const mobileLocation = loadTs("mobile/src/home/homeFeedLocation.ts");
  const input = { lat: 12.9715987, lng: 77.5945621 };

  assert.equal(JSON.stringify(serverLocation.normalizeHomeFeedLocation(input)), JSON.stringify({ lat: 12.9716, lng: 77.5946 }));
  assert.equal(serverLocation.homeFeedLocationKey(input), "12.9716,77.5946");
  assert.equal(mobileLocation.homeFeedLocationKey(input), "12.9716,77.5946");
  assert.equal(serverLocation.normalizeHomeFeedLocation({ lat: 91, lng: 0 }), null);
  assert.equal(serverLocation.homeFeedLocationKey(null), "none");

  assert.equal(
    JSON.stringify(serverLocation.parseHomeFeedLocation(new URLSearchParams("lat=12.9716&lng=77.5946")).location),
    JSON.stringify({ lat: 12.9716, lng: 77.5946 })
  );
  assert.match(serverLocation.parseHomeFeedLocation(new URLSearchParams("lat=12.9")).error, /provided together/);
});

test("startup resolves one account-scoped global location before the notification prompt", () => {
  const store = source("mobile/src/stores/userLocationStore.ts");
  const bootstrap = source("mobile/src/providers/UserLocationBootstrap.tsx");
  const providers = source("mobile/src/providers/AppProviders.tsx");
  const config = source("mobile/app.json");

  assert.match(store, /resolveStartupLocation: async \(\) =>/);
  assert.match(store, /await get\(\)\.hydrate\(\)/);
  assert.match(store, /settleWithin\(get\(\)\.syncRemoteLocation\(\), STARTUP_REMOTE_LOCATION_TIMEOUT_MS\)/);
  assert.match(store, /requestPermission: true, silent: true/);
  assert.match(store, /startupResolved: true/);
  assert.match(store, /locationStoreEpoch \+= 1/);
  assert.match(bootstrap, /void resolveStartupLocation\(\)/);
  assert.match(providers, /startupLocationResolved \? \([\s\S]*<PushNotificationBootstrap \/>[\s\S]*<ProfileHeaderPrefetchBootstrap \/>[\s\S]*\) : null/);
  assert.match(config, /show nearby posts and restaurant discovery/);
});

test("Home and Explore consume the same location and Home keys its cache by coordinates", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const refresh = source("mobile/src/hooks/useHomeRefresh.ts");
  const service = source("mobile/src/services/feeds.ts");

  assert.match(home, /const homeLocation = useUserLocationStore\(\(state\) => state\.location\)/);
  assert.match(home, /location: homeLocation/);
  assert.match(home, /isAuthenticated && startupLocationResolved/);
  assert.match(explore, /const exploreLocation = useUserLocationStore\(\(state\) => state\.location\)/);
  assert.match(explore, /enabled: locationHydrated && startupLocationResolved && isActiveMainTab/);
  assert.match(hooks, /circlePagesForLocation/);
  assert.match(hooks, /queryKey: feedKeys\.circlePagesForLocation\(location\)/);
  assert.match(refresh, /homeFeedQueryKeyRef\.current = feedKeys\.circlePagesForLocation\(normalizedLocation\)/);
  assert.match(refresh, /location: locationRef\.current, refresh: true, signal/);
  assert.match(refresh, /context\.locationKey === locationKeyRef\.current/);
  assert.match(service, /params\.set\("lat", String\(location\.lat\)\)/);
  assert.match(service, /params\.set\("lng", String\(location\.lng\)\)/);
});

test("Circle API binds ranked cursors to the requested location", () => {
  const route = source("app/api/feed/circle/route.ts");
  const canonical = source("lib/server/canonical-circle-feed.ts");

  assert.match(route, /parseHomeFeedLocation\(req\.nextUrl\.searchParams\)/);
  assert.match(route, /cursor\?\.locationKey && cursor\.locationKey !== homeFeedLocationKey\(parsedLocation\.location\)/);
  assert.match(route, /location: parsedLocation\.location/);
  assert.match(canonical, /db\.rpc\("circle_feed_page_v3"/);
  assert.match(canonical, /p_cursor_seen: options\.cursor\?\.seen \?\? null/);
  assert.match(canonical, /p_seen_cutoff: options\.cursor\?\.seenCutoff \?\? null/);
  assert.match(canonical, /p_viewer_lat: location\?\.lat \?\? null/);
  assert.match(canonical, /const nextCursor = payload\.nextCursor[\s\S]*locationKey/);
  assert.doesNotMatch(canonical, /rankCircleFeedReviews/);
});

test("database pagination orders the full eligible feed unseen-first and nearest-first", () => {
  const migration = source("supabase/migrations/202607210005_home_location_ranked_feed.sql");

  assert.match(migration, /create or replace function private\.circle_feed_page_v3/);
  assert.match(migration, /seen\.first_viewed_at <= params\.seen_cutoff/);
  assert.match(migration, /case when seen_by_viewer then 1 else 0 end as seen_bucket/);
  assert.match(migration, /6371000\.0 \* 2\.0 \* asin/);
  assert.match(migration, /coalesce\(distance_meters, 9223372036854775807::bigint\) as distance_sort/);
  assert.match(migration, /order by seen_bucket asc, distance_sort asc, created_at desc, id desc/);
  assert.match(migration, /limit \(\(select row_limit from params\) \+ 1\)/);
  assert.match(migration, /'distanceMeters', distance_meters/);
  assert.match(migration, /'seenCutoff', \(select seen_cutoff from params\)/);
  assert.match(migration, /new\.first_viewed_at := old\.first_viewed_at/);
  assert.match(migration, /if auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /revoke all on function public\.circle_feed_page_v3[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.circle_feed_page_v3[\s\S]*to service_role/);
});
