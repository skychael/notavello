"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  buildWeatherData,
  evaluateWeatherCandidate,
  rankWeatherCandidates,
  safeHttpUrl
} = require("./update-weather");
const { parseFeed } = require("./update-articles");

const NOW = new Date("2026-07-26T16:00:00.000Z");
const CONFIG = {
  lookback_hours: 48,
  continuing_event_hours: 168,
  maximum_items: 3,
  sources: []
};

function source(overrides = {}) {
  return {
    id: "official-weather",
    publisher_name: "Official Weather",
    feed_url: "https://weather.test/feed.xml",
    homepage_url: "https://weather.test/",
    enabled: true,
    priority: 10,
    trusted_images: true,
    ...overrides
  };
}

function entry(overrides = {}) {
  return {
    title: "Hurricane Ada threatens coastal communities",
    link: "https://weather.test/ada",
    published: "2026-07-26T15:00:00.000Z",
    summary: "A major hurricane warning remains active.",
    ...overrides
  };
}

function evaluate(candidate, sourceOverrides = {}, optionOverrides = {}) {
  return evaluateWeatherCandidate(candidate, source(sourceOverrides), {
    now: NOW,
    lookbackHours: 48,
    continuingEventHours: 168,
    ...optionOverrides
  });
}

function rss(items) {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items.map((item) => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <pubDate>${item.published}</pubDate>
      <description><![CDATA[${item.summary || ""}]]></description>
      ${item.image ? `<media:content url="${item.image}" type="image/jpeg" />` : ""}
    </item>`).join("")}</channel></rss>`;
}

function fetchFor(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, text: async () => body });
}

test("qualifying hurricane story is accepted", () => {
  const result = evaluate(entry());
  assert.equal(result.status, "accepted");
  assert.equal(result.article.topic, "Hurricane");
});

test("major flood story is accepted", () => {
  const result = evaluate(entry({
    title: "Major flooding forces evacuations across the river valley",
    link: "https://weather.test/flood",
    summary: "Widespread flooding remains active."
  }));
  assert.equal(result.status, "accepted");
  assert.equal(result.article.topic, "Flooding");
});

test("routine forecast is rejected", () => {
  assert.equal(evaluate(entry({
    title: "Weekend weather forecast calls for afternoon showers",
    summary: "A routine seasonal outlook.",
    link: "https://weather.test/forecast"
  })).status, "not_consequential");
});

test("minor advisory is rejected", () => {
  assert.equal(evaluate(entry({
    title: "Heat advisory issued for Saturday afternoon",
    summary: "Temperatures will be hot.",
    link: "https://weather.test/advisory"
  })).status, "minor_advisory");
});

test("metaphorical political storm is rejected", () => {
  assert.equal(evaluate(entry({
    title: "Candidate faces a political storm after debate",
    summary: "The crisis has flooded social media.",
    link: "https://weather.test/politics"
  })).status, "not_consequential");
});

test("stale resolved event is rejected", () => {
  assert.equal(evaluate(entry({
    title: "Hurricane Ada has dissipated and warning is resolved",
    published: "2026-07-23T12:00:00.000Z"
  })).status, "resolved");
});

test("active continuing major event may be older than 48 hours", () => {
  const result = evaluate(entry({
    title: "Hurricane Ada continues to threaten coastal communities",
    published: "2026-07-23T12:00:00.000Z"
  }));
  assert.equal(result.status, "accepted");
});

test("inactive older major event is stale", () => {
  assert.equal(evaluate(entry({
    title: "Hurricane Ada historical review",
    summary: "",
    published: "2026-07-23T12:00:00.000Z"
  })).status, "stale");
});

test("duplicate named-event coverage is deduplicated", () => {
  const candidates = [
    evaluate(entry({ title: "Hurricane Ada threatens coast", link: "https://weather.test/ada-1" })),
    evaluate(entry({ title: "Hurricane Ada forces evacuations", link: "https://weather.test/ada-2" }))
  ];
  assert.equal(rankWeatherCandidates(candidates, 3).length, 1);
});

test("unsafe article URLs are rejected", () => {
  assert.equal(evaluate(entry({ link: "javascript:alert(1)" })).status, "unsafe_url");
  assert.equal(evaluate(entry({ link: "https://attacker.test/story" })).status, "unsafe_url");
});

test("invalid timestamps are rejected", () => {
  assert.equal(evaluate(entry({ published: "not-a-date" })).status, "invalid_timestamp");
});

test("trusted optional image is accepted from a parsed feed", () => {
  const [parsed] = parseFeed(rss([{ ...entry(), image: "https://weather.test/ada.jpg" }])).entries;
  const result = evaluate(parsed);
  assert.equal(result.article.image_url, "https://weather.test/ada.jpg");
});

test("unsafe or untrusted images are rejected", () => {
  assert.equal(evaluate(entry({ image: "data:image/png;base64,AA==" })).article.image_url, undefined);
  assert.equal(evaluate(entry({ image: "https://weather.test/image.jpg" }), { trusted_images: false }).article.image_url, undefined);
  assert.equal(safeHttpUrl("blob:https://weather.test/id"), "");
});

test("selection writes no more than three stories", () => {
  const candidates = Array.from({ length: 5 }, (_, index) => evaluate(entry({
    title: `Major flooding forces evacuation in region ${index}`,
    link: `https://weather.test/flood-${index}`,
    published: new Date(NOW - index * 60000).toISOString(),
    summary: `Widespread flooding remains active in region ${index}.`
  })));
  assert.equal(rankWeatherCandidates(candidates, 3).length, 3);
});

test("ordering is stable by consequence, freshness, reliability, and URL", () => {
  const flood = evaluate(entry({
    title: "Major flooding forces evacuations",
    link: "https://weather.test/flood",
    published: "2026-07-26T14:00:00.000Z",
    summary: "Widespread flooding remains active."
  }), { priority: 5 });
  const hurricane = evaluate(entry({
    title: "Hurricane Ada remains active",
    link: "https://weather.test/hurricane",
    published: "2026-07-26T13:00:00.000Z"
  }), { priority: 5 });
  const selected = rankWeatherCandidates([flood, hurricane], 3);
  assert.deepEqual(selected.map((item) => item.topic), ["Hurricane", "Flooding"]);
  assert.deepEqual(rankWeatherCandidates([hurricane, flood], 3), selected);
});

test("all-source failure preserves prior valid data without writing", async () => {
  const previousData = {
    schema_version: "1.0",
    generated_at: "2026-07-26T10:00:00.000Z",
    latest_success_at: "2026-07-26T10:00:00.000Z",
    status: "ok",
    items: [{ id: "old", title: "Old", url: "https://weather.test/old", publisher: "P", published_at: "2026-07-26T09:00:00.000Z", topic: "Weather", status: "ok" }]
  };
  const result = await buildWeatherData({
    config: { ...CONFIG, sources: [source()] },
    previousData,
    fetchImpl: async () => { throw new Error("network failed"); },
    now: NOW
  });
  assert.equal(result.shouldWrite, false);
  assert.equal(result.data, previousData);
});

test("successful no-story check writes a valid empty feed", async () => {
  const result = await buildWeatherData({
    config: { ...CONFIG, sources: [source()] },
    fetchImpl: fetchFor(rss([entry({
      title: "Routine local forecast",
      summary: "Sunny tomorrow.",
      link: "https://weather.test/routine"
    })])),
    now: NOW
  });
  assert.equal(result.shouldWrite, true);
  assert.equal(result.data.status, "ok_empty");
  assert.deepEqual(result.data.items, []);
  assert.equal(result.data.latest_success_at, NOW.toISOString());
});

test("workflow schedule and manual paths both execute weather generation", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "update-relay-articles.yml"), "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node relay-automation\/update-weather\.js/);
  assert.match(workflow, /git add -- .*pages\/relay\/weather-data\.json/);
  assert.doesNotMatch(workflow, /update-relay-weather/);
});

test("weather source config contains only verified machine-readable endpoints", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "weather-sources.json"), "utf8"));
  assert.equal(config.maximum_items, 3);
  assert.ok(config.sources.length >= 4);
  config.sources.forEach((item) => {
    assert.equal(item.verification_status, "verified");
    assert.match(item.feed_url, /^https:\/\//);
    assert.ok(item.publisher_name);
  });
});
