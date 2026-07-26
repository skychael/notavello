"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeWeatherLocation } = require("./weather-location");

test("normalizes ZIP, city, and geolocation handoffs without inventing fields", () => {
  assert.deepEqual(normalizeWeatherLocation({ lat: "38.9", lon: "-77.04", label: "20001", zip: "20001" }, 10), {
    lat: 38.9, lon: -77.04, label: "20001", savedAt: 10, zip: "20001"
  });
  assert.deepEqual(normalizeWeatherLocation({
    lat: 34.05, lon: -118.24, label: "Los Angeles, CA", city: "Los Angeles", state: "CA", country: "US"
  }, 11), {
    lat: 34.05, lon: -118.24, label: "Los Angeles, CA", savedAt: 11,
    city: "Los Angeles", state: "CA", country: "US"
  });
  assert.deepEqual(normalizeWeatherLocation({ lat: 47.61, lon: -122.33, label: "Current location" }, 12), {
    lat: 47.61, lon: -122.33, label: "Current location", savedAt: 12
  });
});

test("accepts saved and cached enriched locations with missing optional fields", () => {
  assert.deepEqual(normalizeWeatherLocation({
    lat: 40.71, lon: -74, displayName: "New York", region: "NY", postalCode: "10001", timezone: -14400, savedAt: 5
  }), {
    lat: 40.71, lon: -74, label: "New York", savedAt: 5, region: "NY", postalCode: "10001", timezone: -14400
  });
  assert.deepEqual(normalizeWeatherLocation({ lat: 1, lon: 2 }, 20), {
    lat: 1, lon: 2, label: "", savedAt: 20
  });
});

test("rejects malformed and out-of-range stored locations", () => {
  assert.equal(normalizeWeatherLocation(null), null);
  assert.equal(normalizeWeatherLocation({ lat: "bad", lon: 1 }), null);
  assert.equal(normalizeWeatherLocation({ lat: 91, lon: 1 }), null);
  assert.equal(normalizeWeatherLocation({ lat: 1, lon: -181 }), null);
});

test("start page writes the handoff during normal link activation before navigation", async () => {
  const root = path.join(__dirname, "start");
  const [html, script] = await Promise.all([
    fs.readFile(path.join(root, "index.html"), "utf8"),
    fs.readFile(path.join(root, "script.js"), "utf8")
  ]);
  assert.match(html, /data-full-forecast/);
  assert.ok(html.indexOf("../weather-location.js") < html.indexOf("script.js"));
  assert.match(script, /fullForecastLink\?\.addEventListener\("click", syncWeatherCenterLocation\)/);
  assert.match(script, /storageSet\(WEATHER_CENTER_KEY, normalized\)/);
  assert.doesNotMatch(script, /weather\\.html\\?/);
});

test("Weather Center validates and automatically loads handoff while preserving manual entry", async () => {
  const [html, script] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "..", "weather.html"), "utf8"),
    fs.readFile(path.join(__dirname, "weather-page.js"), "utf8")
  ]);
  assert.ok(html.indexOf("/tools/koga/weather-location.js") < html.indexOf("/tools/koga/weather-page.js"));
  assert.match(script, /const saved = normalizeLocation\(raw\)/);
  assert.match(script, /await loadWeather\(saved\)/);
  assert.match(script, /locationForm\.addEventListener\('submit', submitSearch\)/);
  assert.match(script, /locationInput\.addEventListener\('keydown'/);
  assert.doesNotMatch(script, /removeItem\(LOCATION_KEY\)/);
});
