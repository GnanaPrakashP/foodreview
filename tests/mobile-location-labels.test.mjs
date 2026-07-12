import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../mobile/src/services/locationLabels.ts", import.meta.url),
  "utf8"
);
const userLocationSource = readFileSync(
  new URL("../mobile/src/services/userLocation.ts", import.meta.url),
  "utf8"
);
const userLocationBootstrapSource = readFileSync(
  new URL("../mobile/src/providers/UserLocationBootstrap.tsx", import.meta.url),
  "utf8"
);

function loadLocationLabels() {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    module: mod,
    exports: mod.exports,
  });
  return mod.exports;
}

function loadUserLocation({ fetchImpl, reverseGeocodeAsync }) {
  const { outputText } = ts.transpileModule(userLocationSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  const require = (specifier) => {
    if (specifier === "expo-location") {
      return {
        Accuracy: { Balanced: 3, High: 4 },
        getCurrentPositionAsync: async () => ({ coords: { latitude: 17.415, longitude: 78.434 } }),
        getForegroundPermissionsAsync: async () => ({ status: "granted" }),
        getLastKnownPositionAsync: async () => null,
        requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
        reverseGeocodeAsync,
      };
    }
    if (specifier === "expo-secure-store") {
      return {
        deleteItemAsync: async () => undefined,
        getItemAsync: async () => null,
        setItemAsync: async () => undefined,
      };
    }
    if (specifier === "react-native") return { Platform: { OS: "android" } };
    if (specifier === "@/api/config") return { apiUrl: (path) => `https://app.test${path}` };
    if (specifier === "@/api/supabase") return { supabase: {} };
    if (specifier === "@/security/cacheOwnership") return {
      getActiveCacheGeneration: () => 0,
      getActiveCacheOwner: () => null,
      isCacheGenerationActive: () => false,
      isValidCacheOwnerScope: () => false,
    };
    if (specifier === "@/services/locationLabels") return loadLocationLabels();
    throw new Error(`Unexpected import: ${specifier}`);
  };
  vm.runInNewContext(outputText, {
    Date,
    URLSearchParams,
    clearTimeout,
    fetch: fetchImpl,
    globalThis: {},
    module: mod,
    exports: mod.exports,
    require,
    setTimeout,
  });
  return mod.exports;
}

test("mobile location labels strip plus codes and administrative-only parts", () => {
  const { compactAddressText, compactLocationLabel, isPlusCodeLocationPart } = loadLocationLabels();

  assert.equal(isPlusCodeLocationPart("F8MR+QX"), true);
  assert.equal(compactAddressText("F8MR+QX, Hyderabad, Telangana 500081, India"), "Hyderabad");
  assert.equal(compactAddressText("F8MR+QX, JV Hill, Hyderabad, Telangana 500081, India"), "JV Hill, Hyderabad");
  assert.equal(compactLocationLabel(["F8MR+QX", "Banjara Hills", "Hyderabad"]), "Banjara Hills, Hyderabad");
  assert.equal(compactLocationLabel(["JV Hills", "994", "Hyderabad"]), "JV Hills, Hyderabad");
});

test("mobile area label keeps the trailing area and city of a full address", () => {
  const { compactAreaLabel } = loadLocationLabels();

  assert.equal(
    compactAreaLabel("Telecom Nagar Extension, Old Mumbai Hwy, Telecom Nagar, Gachibowli, Hyderabad"),
    "Gachibowli, Hyderabad"
  );
  assert.equal(
    compactAreaLabel("Flat no 305, 3rd Floor, Osmania University Rd, Vidya Nagar, Adikmet, Hyderabad"),
    "Adikmet, Hyderabad"
  );
  assert.equal(compactAreaLabel("Indiranagar, Bengaluru, Karnataka 560038, India"), "Indiranagar, Bengaluru");
  assert.equal(compactAreaLabel("Hyderabad"), "Hyderabad");
  assert.equal(compactAreaLabel(""), null);
});

test("mobile current-location label prefers device area over backend city-only label", async () => {
  const { reverseGeocodeUserLocation } = loadUserLocation({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ label: "Hyderabad" }),
    }),
    reverseGeocodeAsync: async () => [{
      city: "Hyderabad",
      country: "India",
      district: null,
      name: "F8MR+QX",
      region: "Telangana",
      street: "JV Hill",
      subregion: null,
    }],
  });

  assert.equal(await reverseGeocodeUserLocation(17.415, 78.434), "JV Hill, Hyderabad");
});

test("mobile Explore header keeps precise area labels instead of collapsing to city", () => {
  const { shortUserLocationLabel } = loadUserLocation({
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    reverseGeocodeAsync: async () => [],
  });

  assert.equal(shortUserLocationLabel("F8MR+QX, JV Hill, Hyderabad, Telangana 500081, India"), "JV Hill, Hyderabad");
  assert.equal(shortUserLocationLabel("Telecom Nagar Extension West, Hyderabad"), "Telecom Nagar Extens..., Hyderabad");
});

test("mobile location sync keeps precise labels over newer city-only rows at the same coordinates", () => {
  const { newerUserLocation } = loadUserLocation({
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    reverseGeocodeAsync: async () => [],
  });
  const precise = {
    lat: 17.415,
    lng: 78.434,
    label: "JV Hill, Hyderabad",
    source: "device",
    updatedAt: "2026-07-11T10:00:00.000Z",
  };
  const coarse = {
    lat: 17.4151,
    lng: 78.4341,
    label: "Hyderabad",
    source: "device",
    updatedAt: "2026-07-11T10:05:00.000Z",
  };

  assert.equal(newerUserLocation(precise, coarse).label, "JV Hill, Hyderabad");
});

test("mobile current-location path can prefer a fresh precise fix before last-known fallback", () => {
  assert.match(userLocationSource, /REVERSE_GEOCODE_TIMEOUT_MS/);
  assert.match(userLocationSource, /FRESH_CURRENT_LOCATION_TIMEOUT_MS/);
  assert.match(userLocationSource, /preferFresh/);
  assert.match(userLocationSource, /if \(options\.preferFresh\) \{/);
  assert.match(userLocationSource, /Location\.getCurrentPositionAsync\(\{ accuracy: Location\.Accuracy\.High \}\)/);
  assert.match(userLocationSource, /Promise\.all\(\[\s*withTimeout\(reverseGeocodeUserLocationFromBackend/);
  assert.match(userLocationSource, /Location\.getLastKnownPositionAsync\(\{ maxAge: LAST_KNOWN_LOCATION_MAX_AGE_MS \}\)/);
  assert.match(userLocationSource, /lastKnown \? CURRENT_LOCATION_WITH_LAST_KNOWN_TIMEOUT_MS : CURRENT_LOCATION_TIMEOUT_MS/);
});

test("mobile bootstrap refreshes coarse manual labels when permission is already granted", () => {
  assert.match(userLocationSource, /export function isCoarseUserLocationLabel/);
  assert.match(userLocationBootstrapSource, /isCoarseUserLocationLabel\(state\.location\.label\)/);
  assert.match(userLocationBootstrapSource, /COARSE_DEVICE_LOCATION_REFRESH_MS/);
  assert.match(userLocationBootstrapSource, /isCoarseUserLocationLabel\(state\.location\.label\)\s*\?\s*COARSE_DEVICE_LOCATION_REFRESH_MS/);
  assert.match(userLocationBootstrapSource, /state\.location\?\.source === "manual" && !isCoarseUserLocationLabel\(state\.location\.label\)/);
  assert.match(userLocationBootstrapSource, /preferFresh: currentLocation \? isCoarseUserLocationLabel\(currentLocation\.label\) : false/);
});
