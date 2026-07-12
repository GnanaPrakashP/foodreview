import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function transpile(src) {
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  return outputText;
}

const sources = {
  autocomplete: transpile(readFileSync(new URL("../app/api/places/autocomplete/route.ts", import.meta.url), "utf8")),
  details: transpile(readFileSync(new URL("../app/api/places/details/route.ts", import.meta.url), "utf8")),
  "reverse-geocode": transpile(readFileSync(new URL("../app/api/places/reverse-geocode/route.ts", import.meta.url), "utf8")),
};

const mockNextResponse = {
  json(body, opts) {
    return { _body: body, _status: opts?.status ?? 200 };
  },
};

function body(res) {
  return JSON.parse(JSON.stringify(res._body));
}

function status(res) {
  return res._status;
}

function makeReq(path) {
  return { nextUrl: new URL(path, "http://localhost:3000") };
}

function googleResponse(payload, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => payload,
  };
}

function loadRoute(kind, { env = {}, fetchImpl = async () => googleResponse({}) } = {}) {
  const mod = { exports: {} };
  const fetchCalls = [];

  vm.runInNewContext(sources[kind], {
    module: mod,
    exports: mod.exports,
    console: { ...console, warn() {} },
    process: { env },
    URL,
    URLSearchParams,
    fetch: async (...args) => {
      fetchCalls.push(args);
      return fetchImpl(...args);
    },
    require(id) {
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      throw new Error(`Unexpected require in places ${kind} tests: ${id}`);
    },
  });

  return { route: mod.exports, fetchCalls };
}

test("places autocomplete: missing input returns 400", async () => {
  const { route } = loadRoute("autocomplete");
  const res = await route.GET(makeReq("/api/places/autocomplete"));
  assert.equal(status(res), 400);
  assert.equal(body(res).error, "input is required");
});

test("places autocomplete: missing API key safely returns no suggestions", async () => {
  const { route, fetchCalls } = loadRoute("autocomplete", { env: {} });
  const res = await route.GET(makeReq("/api/places/autocomplete?input=bawa"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { suggestions: [] });
  assert.equal(fetchCalls.length, 0);
});

test("places autocomplete: maps Google place predictions and skips invalid duplicates", async () => {
  const { route, fetchCalls } = loadRoute("autocomplete", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse({
      suggestions: [
        {
          placePrediction: {
            placeId: "place-1",
            text: { text: "Bawarchi, RTC X Roads, Hyderabad" },
            structuredFormat: {
              mainText: { text: "Bawarchi" },
              secondaryText: { text: "RTC X Roads, Hyderabad" },
            },
          },
        },
        {
          placePrediction: {
            placeId: "place-1",
            text: { text: "Duplicate Bawarchi" },
            structuredFormat: { mainText: { text: "Duplicate Bawarchi" } },
          },
        },
        { placePrediction: { text: { text: "No Place ID" } } },
      ],
    }),
  });

  const res = await route.GET(makeReq("/api/places/autocomplete?input=bawa&sessionToken=session-1"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), {
    suggestions: [{
      placeId: "place-1",
      text: "Bawarchi, RTC X Roads, Hyderabad",
      mainText: "Bawarchi",
      secondaryText: "RTC X Roads, Hyderabad",
    }],
  });

  assert.equal(fetchCalls.length, 1);
  const [url, options] = fetchCalls[0];
  assert.equal(url, "https://places.googleapis.com/v1/places:autocomplete");
  assert.equal(options.method, "POST");
  assert.equal(options.headers["X-Goog-Api-Key"], "places-key");
  assert.match(options.headers["X-Goog-FieldMask"], /placePrediction\.placeId/);
  assert.deepEqual(JSON.parse(options.body), {
    input: "bawa",
    includeQueryPredictions: false,
    regionCode: "in",
    sessionToken: "session-1",
  });
});

test("places autocomplete: adds locationBias circle when lat/lng params provided", async () => {
  const { route, fetchCalls } = loadRoute("autocomplete", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse({ suggestions: [] }),
  });

  await route.GET(makeReq("/api/places/autocomplete?input=sindhu&lat=13.2168&lng=79.0993"));

  assert.equal(fetchCalls.length, 1);
  const sentBody = JSON.parse(fetchCalls[0][1].body);
  assert.deepEqual(sentBody.locationBias, {
    circle: {
      center: { latitude: 13.2168, longitude: 79.0993 },
      radius: 30000,
    },
  });
});

test("places autocomplete: omits locationBias when lat/lng params are absent", async () => {
  const { route, fetchCalls } = loadRoute("autocomplete", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse({ suggestions: [] }),
  });

  await route.GET(makeReq("/api/places/autocomplete?input=sindhu"));

  assert.equal(fetchCalls.length, 1);
  const sentBody = JSON.parse(fetchCalls[0][1].body);
  assert.equal(sentBody.locationBias, undefined);
});

test("places autocomplete: Google errors are hidden from clients", async () => {
  const { route } = loadRoute("autocomplete", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse(
      { error: { status: "PERMISSION_DENIED", message: "Requests from referer <empty> are blocked." } },
      { ok: false, status: 403, statusText: "Forbidden" },
    ),
  });

  const res = await route.GET(makeReq("/api/places/autocomplete?input=bawa"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { suggestions: [] });
});

test("places details: missing placeId returns 400", async () => {
  const { route } = loadRoute("details");
  const res = await route.GET(makeReq("/api/places/details"));
  assert.equal(status(res), 400);
  assert.equal(body(res).error, "placeId is required");
});

test("places details: missing API key safely returns null details", async () => {
  const { route, fetchCalls } = loadRoute("details", { env: {} });
  const res = await route.GET(makeReq("/api/places/details?placeId=place-1"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { details: null });
  assert.equal(fetchCalls.length, 0);
});

test("places details: maps Google details payload", async () => {
  const { route, fetchCalls } = loadRoute("details", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse({
      id: "place-1",
      formattedAddress: "Gachibowli, Hyderabad, Telangana 500032, India",
      shortFormattedAddress: "Gachibowli, Hyderabad",
      primaryType: "coffee_shop",
      types: ["coffee_shop", "cafe", "food", "point_of_interest"],
      location: { latitude: 17.4239, longitude: 78.4738 },
    }),
  });

  const res = await route.GET(makeReq("/api/places/details?placeId=place-1&sessionToken=session-1"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), {
    details: {
      placeId: "place-1",
      name: "",
      formattedAddress: "Gachibowli, Hyderabad, Telangana 500032, India",
      shortFormattedAddress: "Gachibowli, Hyderabad",
      locationLabel: "",
      primaryType: "coffee_shop",
      types: ["coffee_shop", "cafe", "food", "point_of_interest"],
      latitude: 17.4239,
      longitude: 78.4738,
    },
  });

  assert.equal(fetchCalls.length, 1);
  const [url, options] = fetchCalls[0];
  const requestUrl = new URL(url);
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://places.googleapis.com/v1/places/place-1");
  assert.equal(requestUrl.searchParams.get("regionCode"), "in");
  assert.equal(requestUrl.searchParams.get("sessionToken"), "session-1");
  assert.equal(options.method, "GET");
  assert.equal(options.headers["X-Goog-Api-Key"], "places-key");
  assert.match(options.headers["X-Goog-FieldMask"], /formattedAddress/);
  assert.match(options.headers["X-Goog-FieldMask"], /addressComponents/);
  assert.match(options.headers["X-Goog-FieldMask"], /primaryType/);
  assert.match(options.headers["X-Goog-FieldMask"], /,types/);
});

test("places details: derives an area + city label from address components", async () => {
  const { route } = loadRoute("details", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse({
      id: "place-2",
      displayName: { text: "Cafe Bahar" },
      formattedAddress: "Old MLA Quarters, Basheer Bagh, Hyderabad, Telangana 500029, India",
      shortFormattedAddress: "Basheer Bagh, Hyderabad",
      addressComponents: [
        { longText: "Old MLA Quarters", shortText: "Old MLA Quarters", types: ["neighborhood", "political"] },
        { longText: "Basheer Bagh", shortText: "Basheer Bagh", types: ["sublocality_level_1", "sublocality", "political"] },
        { longText: "Hyderabad", shortText: "Hyderabad", types: ["locality", "political"] },
        { longText: "Telangana", shortText: "TS", types: ["administrative_area_level_1", "political"] },
        { longText: "India", shortText: "IN", types: ["country", "political"] },
      ],
      location: { latitude: 17.4045, longitude: 78.4765 },
    }),
  });

  const res = await route.GET(makeReq("/api/places/details?placeId=place-2"));
  assert.equal(status(res), 200);
  assert.equal(body(res).details.locationLabel, "Basheer Bagh, Hyderabad");
});

test("places details: falls back to city when no sublocality is present", async () => {
  const { route } = loadRoute("details", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse({
      id: "place-3",
      formattedAddress: "Hyderabad, Telangana, India",
      shortFormattedAddress: "Hyderabad",
      addressComponents: [
        { longText: "Hyderabad", shortText: "Hyderabad", types: ["locality", "political"] },
        { longText: "Telangana", shortText: "TS", types: ["administrative_area_level_1", "political"] },
        { longText: "India", shortText: "IN", types: ["country", "political"] },
      ],
      location: { latitude: 17.385, longitude: 78.4867 },
    }),
  });

  const res = await route.GET(makeReq("/api/places/details?placeId=place-3"));
  assert.equal(status(res), 200);
  assert.equal(body(res).details.locationLabel, "Hyderabad");
});

test("places details: Google errors are hidden from clients", async () => {
  const { route } = loadRoute("details", {
    env: { GOOGLE_PLACES_API_KEY: "places-key" },
    fetchImpl: async () => googleResponse(
      { error: { status: "INVALID_ARGUMENT", message: "Bad place id" } },
      { ok: false, status: 400, statusText: "Bad Request" },
    ),
  });

  const res = await route.GET(makeReq("/api/places/details?placeId=bad"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { details: null });
});

// ── reverse-geocode ──────────────────────────────────────────────────────────

test("reverse-geocode: missing lat/lng returns 400", async () => {
  const { route } = loadRoute("reverse-geocode");
  const res = await route.GET(makeReq("/api/places/reverse-geocode"));
  assert.equal(status(res), 400);
});

test("reverse-geocode: missing API key returns null label without calling Google", async () => {
  const { route, fetchCalls } = loadRoute("reverse-geocode", { env: {} });
  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.415&lng=78.434"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: null });
  assert.equal(fetchCalls.length, 0);
});

test("reverse-geocode: extracts sublocality + locality into a short label", async () => {
  const { route, fetchCalls } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({
      status: "OK",
      results: [{
        address_components: [
          { long_name: "Banjara Hills", short_name: "Banjara Hills", types: ["sublocality_level_1", "sublocality", "political"] },
          { long_name: "Hyderabad", short_name: "Hyderabad", types: ["locality", "political"] },
          { long_name: "Telangana", short_name: "TS", types: ["administrative_area_level_1", "political"] },
        ],
      }],
    }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.415&lng=78.434"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: "Banjara Hills, Hyderabad" });

  assert.equal(fetchCalls.length, 1);
  const [url] = fetchCalls[0];
  const u = new URL(url);
  assert.equal(u.searchParams.get("latlng"), "17.415,78.434");
  assert.equal(u.searchParams.get("result_type"), null);
  assert.equal(u.searchParams.get("key"), "maps-key");
});

test("reverse-geocode: reads typed components and ignores the plus-code formatted address and admin area", async () => {
  const { route } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({
      status: "OK",
      results: [{
        address_components: [
          { long_name: "Hyderabad", short_name: "Hyderabad", types: ["locality", "political"] },
          { long_name: "Telangana", short_name: "TS", types: ["administrative_area_level_1", "political"] },
          { long_name: "India", short_name: "IN", types: ["country", "political"] },
        ],
        formatted_address: "F8MR+QX, Hyderabad, Telangana 500081, India",
      }],
    }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.415&lng=78.434"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: "Hyderabad" });
});

test("reverse-geocode: returns null when a result has no area or city component types", async () => {
  const { route } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({
      status: "OK",
      results: [{
        address_components: [
          { long_name: "Telangana", short_name: "TS", types: ["administrative_area_level_1", "political"] },
          { long_name: "India", short_name: "IN", types: ["country", "political"] },
        ],
        formatted_address: "F8MR+QX, Telangana 500081, India",
      }],
    }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.415&lng=78.434"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: null });
});

test("reverse-geocode: prefers a later area label over an initial plus-code city fallback", async () => {
  const { route } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({
      status: "OK",
      results: [
        {
          address_components: [],
          formatted_address: "F8MR+QX, Hyderabad, Telangana 500081, India",
          types: ["plus_code"],
        },
        {
          address_components: [
            { long_name: "JV Hill", short_name: "JV Hill", types: ["sublocality_level_3", "sublocality", "political"] },
            { long_name: "Hyderabad", short_name: "Hyderabad", types: ["locality", "political"] },
            { long_name: "Telangana", short_name: "TS", types: ["administrative_area_level_1", "political"] },
          ],
          formatted_address: "JV Hill, Hyderabad, Telangana 500081, India",
        },
      ],
    }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.415&lng=78.434"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: "JV Hill, Hyderabad" });
});

test("reverse-geocode: does not use street numbers as the second short label", async () => {
  const { route } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({
      status: "OK",
      results: [{
        address_components: [
          { long_name: "JV Hills", short_name: "JV Hills", types: ["sublocality_level_3", "sublocality", "political"] },
          { long_name: "Hyderabad", short_name: "Hyderabad", types: ["locality", "political"] },
          { long_name: "Telangana", short_name: "TS", types: ["administrative_area_level_1", "political"] },
        ],
        formatted_address: "994, JV Hills, Hyderabad, Telangana 500081, India",
      }],
    }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.473721&lng=78.352070"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: "JV Hills, Hyderabad" });
});

test("reverse-geocode: falls back to locality when no sublocality is present", async () => {
  const { route } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({
      status: "OK",
      results: [{
        address_components: [
          { long_name: "Hyderabad", short_name: "Hyderabad", types: ["locality", "political"] },
        ],
      }],
    }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.385&lng=78.486"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: "Hyderabad" });
});

test("reverse-geocode: non-OK Google status returns null label", async () => {
  const { route } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({ status: "ZERO_RESULTS", results: [] }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=0&lng=0"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: null });
});

test("reverse-geocode: Google HTTP error returns null label", async () => {
  const { route } = loadRoute("reverse-geocode", {
    env: { GOOGLE_MAPS_API_KEY: "maps-key" },
    fetchImpl: async () => googleResponse({}, { ok: false, status: 403, statusText: "Forbidden" }),
  });

  const res = await route.GET(makeReq("/api/places/reverse-geocode?lat=17.415&lng=78.434"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res), { label: null });
});
