"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVideoData,
  deduplicateAndRank,
  evaluateCandidate,
  hasEventSignal,
  matchedTopics,
  normalizeVideo,
  primaryTopicId,
  relevantTopicIds
} = require("./update-videos");

const config = require("./config/video-sources.json");
const topics = require("./config/topics.json");
const exclusions = require("./config/exclusions.json");

const NOW = new Date("2026-07-24T18:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - config.lookback_hours * 60 * 60 * 1000);

function normalizeTextForTest(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function channelById(id) {
  const channel = config.approved_channels.find((entry) => entry.id === id);
  assert.ok(channel, `fixture channel not found: ${id}`);
  return channel;
}

function searchItem({ videoId, title, description = "", publishedAt }) {
  return {
    id: { videoId },
    snippet: { title, description, publishedAt: publishedAt || NOW.toISOString() }
  };
}

function normalize(channelId, fields) {
  return normalizeVideo(
    searchItem(fields),
    channelById(channelId),
    topics.topics,
    exclusions,
    CUTOFF,
    NOW
  );
}

function evaluate(channelId, fields) {
  return evaluateCandidate(
    searchItem(fields),
    channelById(channelId),
    topics.topics,
    exclusions,
    CUTOFF,
    NOW
  );
}

// --- Regression: production examples that must be rejected ---------------

test("rejects generic freight-market commentary with no concrete event", () => {
  const boilerplate = "Subscribe to FreightWaves for the latest supply chain and trucking industry news.";
  const rejected = [
    { videoId: "8SjBFyxUHzM", title: "Staging a Freight Crash Could Soon Cost You 20 Years in Prison" },
    { videoId: "6UBYvjJ60gM", title: "Freight Rates: Are they rising because of DEMAND or CAPACITY?" },
    { videoId: "EVVgBnFTzwg", title: "J.B. Hunt on Freight Recession & Rate Hikes: What's Next?" },
    { videoId: "opIdIhas30A", title: "Is This Trucking Market Different? Why Capacity Won't Flood Back In" },
    { videoId: "XjiCYzm-6QU", title: "Zebra's \"Physical AI\" Transforms Supply Chain Operations" }
  ];

  for (const fixture of rejected) {
    const result = normalize("freightwaves", { ...fixture, description: boilerplate });
    assert.equal(result, null, `expected rejection for: ${fixture.title}`);
  }
});

// --- Regression: examples that must be accepted ---------------------------

test("accepts a CISA warning about active exploitation of infrastructure routers", () => {
  const video = normalize("cisa", {
    videoId: "aaaaaaaaaaa",
    title: "CISA Warning: Active Exploitation of Infrastructure Routers Detected"
  });
  assert.ok(video, "expected video to be accepted");
  assert.deepEqual(video.matched_topic_ids, ["cybersecurity-communications"]);
});

test("accepts an FDA food recall / contamination warning", () => {
  const video = normalize("fda", {
    videoId: "bbbbbbbbbbb",
    title: "FDA Issues Food Recall Over Contamination Warning"
  });
  assert.ok(video, "expected video to be accepted");
  assert.deepEqual(video.matched_topic_ids, ["food-agriculture"]);
});

test("accepts a NOAA hurricane / severe-weather advisory", () => {
  const video = normalize("national-hurricane-center", {
    videoId: "ccccccccccc",
    title: "NOAA Hurricane Center Issues Severe Weather Advisory"
  });
  assert.ok(video, "expected video to be accepted");
  assert.deepEqual(video.matched_topic_ids, ["severe-weather-hazards"]);
});

test("accepts a USGS earthquake / water-system update", () => {
  const video = normalize("usgs", {
    videoId: "ddddddddddd",
    title: "USGS Reports Earthquake Near Volcano, Water System Update Issued"
  });
  assert.ok(video, "expected video to be accepted");
  assert.ok(video.matched_topic_ids.includes("severe-weather-hazards"));
});

test("accepts an energy-grid outage / utility emergency", () => {
  const video = normalize("canary-media", {
    videoId: "eeeeeeeeeee",
    title: "Energy Grid Outage Triggers Utility Emergency in Three States"
  });
  assert.ok(video, "expected video to be accepted");
  assert.ok(video.matched_topic_ids.includes("infrastructure-utilities"));
});

test("accepts a port closure / major shipping disruption", () => {
  const video = normalize("freightwaves", {
    videoId: "fffffffffff",
    title: "Port Closure Snarls Shipping as Officials Warn of Cargo Interruption"
  });
  assert.ok(video, "expected video to be accepted");
  assert.deepEqual(video.matched_topic_ids, ["shipping-supply-chains"]);
});

// --- Regression: the exact conditions that produced the live empty run ----

test("accepts a USGS magnitude-notation earthquake title with no topics.json vocabulary match (channel-topic fallback)", () => {
  // Real USGS auto-titles look like "M 4.5 - 10 km SSW of Ridgecrest, CA" -
  // no literal "earthquake" and no topics.json phrase, which is exactly what
  // produced zero USGS candidates in the live run.
  const evaluation = evaluate("usgs", {
    videoId: "usgsmag0001",
    title: "M 4.5 - 10 km SSW of Ridgecrest, CA"
  });
  assert.notEqual(evaluation.status, "accepted",
    "bare magnitude notation with no event wording and no topic match should not be silently accepted");

  const withAdvisory = evaluate("usgs", {
    videoId: "usgsmag0002",
    title: "USGS Alert: M 6.1 Earthquake Advisory Issued for Region"
  });
  assert.equal(withAdvisory.status, "accepted");
});

test("accepts a CISA advisory whose title doesn't repeat topics.json's exact wording, via the channel's own configured topics", () => {
  const text = normalizeTextForTest("CISA Releases Advisory on Critical Vulnerability in Widely Used Software");
  assert.deepEqual(matchedTopics(text, channelById("cisa"), topics.topics), [],
    "sanity check: topics.json vocabulary alone does not match this realistic title");

  const evaluation = evaluate("cisa", {
    videoId: "cisaadv0001",
    title: "CISA Releases Advisory on Critical Vulnerability in Widely Used Software"
  });
  assert.equal(evaluation.status, "accepted");
  assert.deepEqual(
    evaluation.video.matched_topic_ids.slice().sort(),
    channelById("cisa").topics.slice().sort(),
    "should fall back to the channel's configured topics as supporting context"
  );
});

test("relevantTopicIds falls back to the channel's configured topics only when the title has an event signal", () => {
  const text = normalizeTextForTest("Some unrelated commentary with no topics.json vocabulary match");
  assert.deepEqual(relevantTopicIds(text, channelById("cisa"), topics.topics, false), [],
    "must not fall back without a genuine title event signal");
  assert.deepEqual(
    relevantTopicIds(text, channelById("cisa"), topics.topics, true).slice().sort(),
    channelById("cisa").topics.slice().sort()
  );
});

// --- Title-weighting: description-only boilerplate must not qualify -------

test("rejects a video whose only event-relevant wording is in the description, not the title", () => {
  const evaluation = evaluate("freightwaves", {
    videoId: "descrOnly01",
    title: "Weekly Freight Market Recap",
    description: "This week's market recap. Officials issued a port closure and shipping disruption warning."
  });
  assert.equal(evaluation.status, "no_event",
    "an event signal appearing only in the description must not qualify the video");
});

test("accepts a video when the event signal is in the title, regardless of a bland description", () => {
  const evaluation = evaluate("freightwaves", {
    videoId: "titleOnly01",
    title: "Port Closure Triggers Major Shipping Disruption",
    description: "Weekly freight market recap and commentary."
  });
  assert.equal(evaluation.status, "accepted");
});

// --- Generic-term gate --------------------------------------------------

test("generic terms alone (market, rates, demand, capacity, operations, logistics, supply chain, economy, growth, AI) never satisfy the event gate", () => {
  const genericOnlyText = "market rates demand capacity operations logistics supply chain economy growth ai";
  assert.equal(hasEventSignal(genericOnlyText), false);
});

test("word-boundary matching avoids false positives (e.g. 'flood' inside unrelated phrasing, 'closure' inside 'disclosure')", () => {
  assert.equal(hasEventSignal("capacity won't flood back in"), false);
  assert.equal(hasEventSignal("regulatory disclosure requirements"), false);
  assert.equal(hasEventSignal("flash flood warning issued for the region"), true);
});

// --- Source and topic diversity caps -------------------------------------

function makeItem({ id, channelId, priority, topicIds, publishedAt }) {
  return {
    video_id: id,
    title: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    channel_name: channelId,
    channel_id: channelId,
    published_at: publishedAt,
    matched_topic_ids: topicIds,
    source_priority: priority,
    status: "ok"
  };
}

test("enforces a maximum of 2 videos per channel even when priority would otherwise fill more slots", () => {
  const topicWeightById = new Map([["topic-a", 10], ["topic-b", 9], ["topic-c", 8], ["topic-d", 7]]);
  const items = [
    makeItem({ id: "v1", channelId: "chan-high", priority: 10, topicIds: ["topic-a"], publishedAt: "2026-07-24T10:00:00.000Z" }),
    makeItem({ id: "v2", channelId: "chan-high", priority: 10, topicIds: ["topic-b"], publishedAt: "2026-07-24T09:00:00.000Z" }),
    makeItem({ id: "v3", channelId: "chan-high", priority: 10, topicIds: ["topic-c"], publishedAt: "2026-07-24T08:00:00.000Z" }),
    makeItem({ id: "v4", channelId: "chan-low", priority: 5, topicIds: ["topic-d"], publishedAt: "2026-07-24T07:00:00.000Z" })
  ];

  const selected = deduplicateAndRank(items, {
    maximumItems: 12,
    maxPerChannel: 2,
    maxPerTopic: 2,
    topicWeightById
  });

  assert.deepEqual(selected.map((item) => item.video_id), ["v1", "v2", "v4"]);
  assert.equal(selected.filter((item) => item.channel_id === "chan-high").length, 2);
});

test("enforces a maximum of 2 videos per primary topic across different channels", () => {
  const topicWeightById = new Map([["topic-a", 10]]);
  const items = [
    makeItem({ id: "v1", channelId: "chan-1", priority: 10, topicIds: ["topic-a"], publishedAt: "2026-07-24T10:00:00.000Z" }),
    makeItem({ id: "v2", channelId: "chan-2", priority: 9, topicIds: ["topic-a"], publishedAt: "2026-07-24T09:00:00.000Z" }),
    makeItem({ id: "v3", channelId: "chan-3", priority: 8, topicIds: ["topic-a"], publishedAt: "2026-07-24T08:00:00.000Z" })
  ];

  const selected = deduplicateAndRank(items, {
    maximumItems: 12,
    maxPerChannel: 2,
    maxPerTopic: 2,
    topicWeightById
  });

  assert.deepEqual(selected.map((item) => item.video_id), ["v1", "v2"]);
});

test("primaryTopicId picks the highest-weight matched topic", () => {
  const topicWeightById = new Map([["low", 3], ["high", 9]]);
  const item = makeItem({ id: "v1", channelId: "chan-1", priority: 10, topicIds: ["low", "high"], publishedAt: NOW.toISOString() });
  assert.equal(primaryTopicId(item, topicWeightById), "high");
});

// --- Quality over quantity -------------------------------------------------

test("fewer than 12 items is a valid result when few candidates are genuinely relevant", () => {
  const topicWeightById = new Map([["topic-a", 10]]);
  const items = [
    makeItem({ id: "v1", channelId: "chan-1", priority: 10, topicIds: ["topic-a"], publishedAt: NOW.toISOString() }),
    makeItem({ id: "v2", channelId: "chan-2", priority: 9, topicIds: ["topic-a"], publishedAt: NOW.toISOString() })
  ];
  const selected = deduplicateAndRank(items, { maximumItems: 12, maxPerChannel: 2, maxPerTopic: 2, topicWeightById });
  assert.equal(selected.length, 2);
});

// --- Full pipeline (mocked YouTube fetch) ----------------------------------

function mockFetchImplFor(itemsByChannelId) {
  return async (url) => {
    const parsed = new URL(url);
    const channelId = parsed.searchParams.get("channelId");
    const items = (itemsByChannelId[channelId] || []).map((entry) => searchItem(entry));
    return {
      ok: true,
      json: async () => ({ items })
    };
  };
}

test("buildVideoData: mixed realistic feed yields a diverse, event-relevant, capped selection", async () => {
  const itemsByChannelId = {
    [channelById("cisa").channel_id]: [
      { videoId: "cisa0000001", title: "CISA Advisory: Active Exploitation of VPN Gateway Vulnerability" },
      { videoId: "cisa0000002", title: "CISA Warning: Ransomware Campaign Targets Water Utilities" },
      { videoId: "cisa0000003", title: "CISA Investigation Update on Recent Cyber Incident" }
    ],
    [channelById("national-hurricane-center").channel_id]: [
      { videoId: "noaa0000001", title: "NOAA Hurricane Center Issues Severe Weather Advisory" }
    ],
    [channelById("usgs").channel_id]: [
      { videoId: "usgs0000001", title: "USGS Reports Earthquake Near Water System Infrastructure" }
    ],
    [channelById("fda").channel_id]: [
      { videoId: "fda00000001", title: "FDA Announces Food Recall Over Contamination Warning" }
    ],
    [channelById("freightwaves").channel_id]: [
      {
        videoId: "fw000000001",
        title: "Staging a Freight Crash Could Soon Cost You 20 Years in Prison",
        description: "Subscribe to FreightWaves for the latest supply chain and trucking industry news."
      },
      {
        videoId: "fw000000002",
        title: "Freight Rates: Are they rising because of DEMAND or CAPACITY?",
        description: "Subscribe to FreightWaves for the latest supply chain and trucking industry news."
      },
      { videoId: "fw000000003", title: "Port Closure Snarls Shipping as Officials Warn of Cargo Interruption" }
    ],
    [channelById("canary-media").channel_id]: [
      { videoId: "canary00001", title: "Energy Grid Outage Triggers Utility Emergency in Three States" }
    ],
    [channelById("securityweek").channel_id]: [
      { videoId: "secweek0001", title: "Ransomware Attack Disrupts Manufacturing Plant Operations" }
    ],
    [channelById("nifa-usda").channel_id]: []
  };

  const data = await buildVideoData({
    config,
    topics,
    exclusions,
    previousData: { items: [] },
    fetchImpl: mockFetchImplFor(itemsByChannelId),
    apiKey: "test-key",
    now: NOW
  });

  assert.equal(data.status, "ok");
  assert.ok(data.items.length < 12, "expected fewer than 12 items given limited genuinely relevant candidates");
  assert.ok(data.items.length >= 3, "expected at least a few relevant items across channels");

  // The two generic FreightWaves commentary videos must not appear.
  const ids = data.items.map((item) => item.video_id);
  assert.ok(!ids.includes("fw000000001"));
  assert.ok(!ids.includes("fw000000002"));

  // Source diversity: no channel exceeds 2 selected videos.
  const perChannel = new Map();
  for (const item of data.items) {
    perChannel.set(item.channel_id, (perChannel.get(item.channel_id) || 0) + 1);
  }
  for (const [channelId, count] of perChannel) {
    assert.ok(count <= 2, `channel ${channelId} exceeded the 2-video cap (${count})`);
  }

  // Multiple channels represented, not just FreightWaves.
  assert.ok(perChannel.size >= 4, "expected videos from multiple distinct channels");
  assert.ok(!(perChannel.size === 1 && perChannel.has(channelById("freightwaves").channel_id)),
    "must not collapse to FreightWaves-only, as in the current production bug");

  console.log("Regenerated mocked video-data.json:\n" + JSON.stringify(data, null, 2));
});

test("matchedTopics still respects channel-scoped topic allowlists (unchanged behavior)", () => {
  const text = "food recall over contamination warning";
  const cisaTopics = matchedTopics(text, channelById("cisa"), topics.topics);
  assert.deepEqual(cisaTopics, []);
});

test("buildVideoData: zero genuinely relevant candidates is a valid, successful, empty selection (not a failure)", async () => {
  const itemsByChannelId = {};
  for (const channel of config.approved_channels) {
    itemsByChannelId[channel.channel_id] = [
      { videoId: "irrelevant01", title: "Weekly Freight Market Recap and Rate Commentary" }
    ];
  }

  const data = await buildVideoData({
    config,
    topics,
    exclusions,
    previousData: { items: [] },
    fetchImpl: mockFetchImplFor(itemsByChannelId),
    apiKey: "test-key",
    now: NOW
  });

  assert.deepEqual(data.items, []);
  assert.equal(data.status, "ok",
    "a successful run that found nothing genuinely relevant must report ok, not a failure status");
  assert.ok(data.latest_success_at, "a successful empty run should still record latest_success_at");
});
