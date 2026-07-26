const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const dashboard = require("./script.js");
const root = path.resolve(__dirname, "../../../..");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");

function storage(value, throws) {
  return {
    getItem() {
      if (throws) throw new Error("blocked");
      return value;
    }
  };
}

test("appearance defaults to System and preserves supported shared values", () => {
  assert.equal(dashboard.savedTheme(storage(null)), "system");
  assert.equal(dashboard.savedTheme(storage("dark")), "dark");
  assert.equal(dashboard.savedTheme(storage("unexpected")), "system");
  assert.equal(dashboard.savedTheme(storage(null, true)), "system");
  assert.equal(dashboard.themeColor("system", true), "#121318");
  assert.equal(dashboard.themeColor("system", false), "#f3f4f7");
  assert.equal((html.match(/data-theme="(?:system|light|dark)"/g) || []).length, 3);
  assert.match(script, /querySelectorAll\("\[data-theme\]"\)/);
});

test("search uses DuckDuckGo with the expected query field", () => {
  assert.match(html, /action="https:\/\/duckduckgo\.com\/"/);
  assert.match(html, /name="q"/);
  assert.match(html, /type="search"/);
});

test("malformed storage data is ignored safely", () => {
  assert.equal(dashboard.safeParse("{nope"), null);
  assert.equal(dashboard.safeParse(""), null);
});

test("headline data is bounded and unsafe URLs are rejected", () => {
  const items = dashboard.safeHeadlineItems({
    items: [
      { title: "One", url: "https://example.com/1", publisher: "A" },
      { title: "Bad", url: "javascript:alert(1)", publisher: "B" },
      { title: "Two", url: "http://example.com/2", publisher: "C" },
      { title: "Three", url: "https://example.com/3", publisher: "D" },
      { title: "Four", url: "https://example.com/4", publisher: "E" }
    ]
  });
  assert.deepEqual(items.map((item) => item.title), ["One", "Two", "Three"]);
});

test("headline ages only render for valid timestamps", () => {
  const now = Date.parse("2026-07-26T08:00:00Z");
  assert.equal(dashboard.formatAge("2026-07-26T07:00:00Z", now), "1h ago");
  assert.equal(dashboard.formatAge("invalid", now), "");
});

test("market movement distinguishes up, down, neutral, and unavailable", () => {
  assert.deepEqual(dashboard.pulseMovement({ change_percent: 1.2, direction: "up" }), {
    change: 1.2,
    direction: "up",
    text: "+1.20%"
  });
  assert.equal(dashboard.pulseMovement({ change_percent: -1, direction: "up" }), null);
  assert.equal(dashboard.pulseMovement({}), null);
  assert.equal(dashboard.pulseMovement({ change_percent: 0 }).text, "0.00%");
});

test("market data is restricted to supported instruments and real values", () => {
  const items = dashboard.safePulseItems({
    items: [
      { id: "sp-500", formatted_value: "6,100", change_percent: 0.4 },
      { id: "unknown", formatted_value: "5", change_percent: 5 },
      { id: "gold", formatted_value: "" }
    ]
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "S&P 500");
});

test("generated history must pass the shared validator for today's date", () => {
  const data = { items: [{ year: 1969, text: "Moon", url: "https://en.wikipedia.org/wiki/Moon" }] };
  const date = new Date(2026, 6, 26);
  let receivedKey;
  const items = dashboard.validateGeneratedHistory(data, date, (value, key) => {
    receivedKey = key;
    return value.items;
  });
  assert.equal(receivedKey, "07-26");
  assert.equal(items.length, 1);
  assert.deepEqual(
    dashboard.validateGeneratedHistory(data, date, () => null),
    []
  );
});

test("generated history retains strict validation if the shared helper is unavailable", () => {
  const valid = {
    schema_version: "1.0",
    date_key: "07-26",
    generated_at: "2026-07-26T15:45:05.298Z",
    selection_method: "deterministic_fallback",
    items: [1, 2, 3].map((number) => ({
      candidate_id: "event-" + number,
      type: "event",
      year: 1900 + number,
      text: "Event " + number,
      article_title: "Event " + number,
      url: "https://en.wikipedia.org/wiki/Event_" + number,
      category: "World history"
    }))
  };
  assert.equal(
    dashboard.validateGeneratedHistory(valid, new Date(2026, 6, 26)).length,
    3
  );
  assert.equal(
    dashboard.validateGeneratedHistory(
      { ...valid, date_key: "07-25" },
      new Date(2026, 6, 26)
    ).length,
    0
  );
});

test("history links are limited to safe English Wikipedia pages", () => {
  const items = dashboard.safeHistoryItems([
    { year: 1945, headline: "Valid", url: "https://en.wikipedia.org/wiki/Test" },
    { year: 2000, headline: "Wrong host", url: "https://example.com/" },
    { year: 2001, headline: "Unsafe", url: "javascript:alert(1)" }
  ]);
  assert.equal(items.length, 1);
  assert.match(dashboard.wikipediaDateUrl(new Date("2026-07-26T12:00:00Z")), /July_26$/);
});

test("weather location validation accepts coordinates without inventing fields", () => {
  assert.equal(dashboard.validCoordinates({ lat: 37.7, lon: -122.4 }), true);
  assert.equal(dashboard.validCoordinates({ lat: 100, lon: 1 }), false);
  const location = dashboard.locationFromWeather(
    { location: { latitude: 37.7, longitude: -122.4, city: "San Francisco" } },
    null
  );
  assert.deepEqual(location, {
    lat: 37.7,
    lon: -122.4,
    label: "San Francisco",
    city: "San Francisco"
  });
});

test("weather uses partial success and request-race protection", () => {
  assert.match(script, /Promise\.allSettled/);
  assert.match(script, /results\[0\]\.status !== "fulfilled"/);
  assert.match(script, /request !== weatherRequest/);
  assert.match(script, /Saved weather · refreshes when online/);
});

test("weather handoff uses shared keys and happens on forecast activation", () => {
  assert.match(script, /kogaStartWeatherLocation/);
  assert.match(script, /weatherCenterLastLocation/);
  assert.match(html, /data-full-forecast/);
  assert.match(script, /fullForecast\.addEventListener\("click"/);
});

test("dashboard modules start independently", () => {
  assert.match(script, /Promise\.resolve\(\)\.then\(loadWeather\)/);
  assert.match(script, /Promise\.resolve\(\)\.then\(loadHeadlines\)/);
  assert.match(script, /Promise\.resolve\(\)\.then\(loadMarkets\)/);
  assert.match(script, /Promise\.resolve\(\)\.then\(loadHistory\)/);
});

test("dynamic content avoids HTML injection and AI calls", () => {
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /openai|chatgpt|responses\.create/i);
  assert.doesNotMatch(script, /console\.|posthog\.capture/i);
});

test("quick links are exactly the four requested destinations", () => {
  const section = html.match(/<nav class="quick-links"[\s\S]*?<\/nav>/)[0];
  assert.equal((section.match(/<a href=/g) || []).length, 4);
  assert.match(section, /wikipedia\.org/);
  assert.match(section, /youtube\.com/);
  assert.match(section, /reddit\.com/);
  assert.match(section, /google\.com\/maps/);
});

test("legacy sponsored content and oversized appearance fieldset are gone", () => {
  assert.doesNotMatch(html, /Sponsored|Sample PDF|Export PDF/i);
  assert.doesNotMatch(html, /<fieldset/i);
  assert.match(html, /<details class="appearance"/);
});

test("iPhone layout handles safe areas and keeps market scrolling local", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /env\(safe-area-inset-top,\s*0px\)/);
  assert.match(css, /env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(css, /\.market-rail[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /overflow-x:\s*hidden/);
});

test("canonical iPhone help and product routes remain discoverable", () => {
  assert.match(html, /href="\/tools\/koga\/ios\/help"/);
  assert.match(html, /href="\/tools\/koga\/ios\/privacy"/);
  assert.match(html, /href="\/tools\/koga\/ios\/support"/);
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const tools = fs.readFileSync(path.join(root, "tools/index.html"), "utf8");
  assert.equal((home.match(/href="\/tools\/koga\/ios\/"/g) || []).length, 1);
  assert.equal((tools.match(/href="\/tools\/koga\/ios\/"/g) || []).length, 0);
  assert.doesNotMatch(html, /apps\.apple\.com|App Store/i);
});
