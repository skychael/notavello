"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVideoData,
  deduplicateAndRank,
  evaluateCandidate,
  hasNonEventContentSignal,
  isHardExcluded,
  parseIso8601DurationSeconds
} = require("./update-videos");

const config = require("./config/video-sources.json");
const exclusions = require("./config/exclusions.json");

const NOW = new Date("2026-07-24T18:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - config.lookback_hours * 60 * 60 * 1000);

function channelById(id) {
  const channel = config.approved_channels.find((entry) => entry.id === id);
  assert.ok(channel, `fixture channel not found: ${id}`);
  return channel;
}

function searchItem({ videoId, title, description = "", publishedAt, liveBroadcastContent = "none" }) {
  return {
    id: { videoId },
    snippet: {
      title,
      description,
      publishedAt: publishedAt || NOW.toISOString(),
      liveBroadcastContent
    }
  };
}

function evaluate(channelId, fields, videoDetailsById = new Map()) {
  return evaluateCandidate(
    searchItem(fields),
    channelById(channelId),
    exclusions,
    videoDetailsById,
    CUTOFF,
    NOW
  );
}

function detailsMap(entries) {
  return new Map(Object.entries(entries));
}

// --- Config sanity: the whitelist itself -----------------------------------

test("config: every enabled channel has a canonical UC channel id", () => {
  for (const channel of config.approved_channels) {
    assert.match(channel.channel_id, /^UC[A-Za-z0-9_-]{22}$/, `bad channel id for ${channel.id}`);
  }
});

test("config: at most one video per channel and six total", () => {
  assert.equal(config.max_per_channel, 1);
  assert.equal(config.maximum_items, 6);
});

// --- Ordinary suitable uploads are accepted, with original title/link ------

test("accepts an ordinary event-tied upload and preserves the original title and direct link", () => {
  const evaluation = evaluate("geologyhub", {
    videoId: "U0hvhEl6Ios",
    title: "Major M7.3 Earthquake Strikes Mexico; Geologist Analysis"
  }, detailsMap({ U0hvhEl6Ios: { durationSeconds: 291, wasLivestream: false } }));

  assert.equal(evaluation.status, "accepted");
  assert.equal(evaluation.video.title, "Major M7.3 Earthquake Strikes Mexico; Geologist Analysis");
  assert.equal(evaluation.video.url, "https://www.youtube.com/watch?v=U0hvhEl6Ios");
  assert.equal(evaluation.video.channel_name, "GeologyHub");
});

// --- Basic deterministic rejections -----------------------------------------

test("rejects a malformed video id", () => {
  const evaluation = evaluate("geologyhub", { videoId: "not-11-chars", title: "Whatever" });
  assert.equal(evaluation.status, "malformed");
});

test("rejects when the configured channel id itself is malformed", () => {
  const badChannel = { ...channelById("geologyhub"), channel_id: "not-a-valid-channel-id" };
  const evaluation = evaluateCandidate(
    searchItem({ videoId: "aaaaaaaaaaa", title: "Whatever" }),
    badChannel,
    exclusions,
    new Map(),
    CUTOFF,
    NOW
  );
  assert.equal(evaluation.status, "malformed");
});

test("rejects an upload published outside the configured lookback window", () => {
  const tooOld = new Date(CUTOFF.getTime() - 1000).toISOString();
  const evaluation = evaluate("geologyhub", {
    videoId: "aaaaaaaaaaa",
    title: "Major Earthquake Strikes Region",
    publishedAt: tooOld
  });
  assert.equal(evaluation.status, "outside_lookback");
});

test("rejects existing hard-exclusion categories (e.g. UFO claims)", () => {
  const evaluation = evaluate("geologyhub", {
    videoId: "aaaaaaaaaaa",
    title: "UFO Sighting Near the Volcano Sparks Alien Theories"
  });
  assert.equal(evaluation.status, "excluded");
});

test("rejects upcoming livestream placeholders", () => {
  const evaluation = evaluate("wgow-shipping", {
    videoId: "aaaaaaaaaaa",
    title: "Live Q&A Starting Soon",
    liveBroadcastContent: "upcoming"
  });
  assert.equal(evaluation.status, "livestream_placeholder");
});

test("rejects a currently-live broadcast placeholder", () => {
  const evaluation = evaluate("wgow-shipping", {
    videoId: "aaaaaaaaaaa",
    title: "LIVE: Strait of Hormuz Coverage",
    liveBroadcastContent: "live"
  });
  assert.equal(evaluation.status, "livestream_placeholder");
});

test("rejects videos at or under 60 seconds as shorts", () => {
  const evaluation = evaluate("geologyhub", {
    videoId: "aaaaaaaaaaa",
    title: "Volcano Eruption Update"
  }, detailsMap({ aaaaaaaaaaa: { durationSeconds: 45, wasLivestream: false } }));
  assert.equal(evaluation.status, "short");
});

test("accepts a video just over the shorts threshold", () => {
  const evaluation = evaluate("geologyhub", {
    videoId: "aaaaaaaaaaa",
    title: "Volcano Eruption Update"
  }, detailsMap({ aaaaaaaaaaa: { durationSeconds: 61, wasLivestream: false } }));
  assert.equal(evaluation.status, "accepted");
});

// --- Non-event content categories (announcements, merch, fundraising, ------
// --- retrospectives, tutorials) ---------------------------------------------

test("rejects channel announcements", () => {
  const evaluation = evaluate("force-thirteen", {
    videoId: "aaaaaaaaaaa",
    title: "A Quick Programming Note About Our Upload Schedule"
  });
  assert.equal(evaluation.status, "non_event_content");
});

test("rejects merchandise promotion", () => {
  const evaluation = evaluate("force-thirteen", {
    videoId: "aaaaaaaaaaa",
    title: "New Force Thirteen Merch Is Here - Shop Now"
  });
  assert.equal(evaluation.status, "non_event_content");
});

test("rejects fundraising appeals", () => {
  const evaluation = evaluate("force-thirteen", {
    videoId: "aaaaaaaaaaa",
    title: "Support the Channel: Join Our Patreon Today"
  });
  assert.equal(evaluation.status, "non_event_content");
});

test("rejects retrospectives not tied to a current event (regression: Force Thirteen 'Top 10' countdowns)", () => {
  const rejected = [
    "Top 10 Cyclones that Exploded overnight",
    "Top 10 Cyclone Forecasting busts that shocked everyone",
    "Top 10 Storms that refused to die",
    "Top 10 Forgotten Cyclones that should be Famous",
    "2009 Pacific Typhoon Season Animation V.2"
  ];
  for (const title of rejected) {
    const evaluation = evaluate("force-thirteen", { videoId: "aaaaaaaaaaa", title });
    assert.equal(evaluation.status, "non_event_content", `expected rejection for: ${title}`);
  }
});

test("rejects tutorials", () => {
  const evaluation = evaluate("geologyhub", {
    videoId: "aaaaaaaaaaa",
    title: "Beginner's Guide: How to Read a Seismograph Tutorial"
  });
  assert.equal(evaluation.status, "non_event_content");
});

test("does not reject legitimate short current-storm updates that happen to run only 1-3 minutes", () => {
  const evaluation = evaluate("force-thirteen", {
    videoId: "aaaaaaaaaaa",
    title: "Two Potential Typhoon Threats in the Western Pacific - Update"
  }, detailsMap({ aaaaaaaaaaa: { durationSeconds: 85, wasLivestream: false } }));
  assert.equal(evaluation.status, "accepted");
});

// --- Ranking: at most one per channel, at most six total, dedupe ----------

function makeItem({ id, channelId, priority, publishedAt, isLivestreamReplay = false }) {
  return {
    video_id: id,
    title: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    channel_name: channelId,
    channel_id: channelId,
    published_at: publishedAt,
    source_priority: priority,
    is_livestream_replay: isLivestreamReplay,
    status: "ok"
  };
}

test("enforces at most one video per channel", () => {
  const items = [
    makeItem({ id: "v1", channelId: "chan-a", priority: 10, publishedAt: "2026-07-24T10:00:00.000Z" }),
    makeItem({ id: "v2", channelId: "chan-a", priority: 10, publishedAt: "2026-07-24T09:00:00.000Z" }),
    makeItem({ id: "v3", channelId: "chan-b", priority: 8, publishedAt: "2026-07-24T08:00:00.000Z" })
  ];
  const selected = deduplicateAndRank(items, { maximumItems: 6, maxPerChannel: 1 });
  assert.deepEqual(selected.map((item) => item.video_id), ["v1", "v3"]);
});

test("enforces no more than six videos total", () => {
  const items = Array.from({ length: 8 }, (_, index) =>
    makeItem({
      id: `v${index}`,
      channelId: `chan-${index}`,
      priority: 10 - index,
      publishedAt: "2026-07-24T10:00:00.000Z"
    }));
  const selected = deduplicateAndRank(items, { maximumItems: 6, maxPerChannel: 1 });
  assert.equal(selected.length, 6);
});

test("does not fill all six slots when fewer suitable candidates exist", () => {
  const items = [
    makeItem({ id: "v1", channelId: "chan-a", priority: 10, publishedAt: "2026-07-24T10:00:00.000Z" }),
    makeItem({ id: "v2", channelId: "chan-b", priority: 9, publishedAt: "2026-07-24T09:00:00.000Z" })
  ];
  const selected = deduplicateAndRank(items, { maximumItems: 6, maxPerChannel: 1 });
  assert.equal(selected.length, 2);
});

test("deduplicates by video id and by url", () => {
  const dupeById = makeItem({ id: "v1", channelId: "chan-a", priority: 10, publishedAt: "2026-07-24T10:00:00.000Z" });
  const items = [
    dupeById,
    { ...dupeById, channel_id: "chan-b", channel_name: "chan-b" }
  ];
  const selected = deduplicateAndRank(items, { maximumItems: 6, maxPerChannel: 1 });
  assert.equal(selected.length, 1);
});

test("prefers an ordinary recent upload over a livestream replay from the same channel", () => {
  const items = [
    makeItem({
      id: "replay1", channelId: "chan-a", priority: 10,
      publishedAt: "2026-07-24T12:00:00.000Z", isLivestreamReplay: true
    }),
    makeItem({
      id: "upload1", channelId: "chan-a", priority: 10,
      publishedAt: "2026-07-24T08:00:00.000Z", isLivestreamReplay: false
    })
  ];
  const selected = deduplicateAndRank(items, { maximumItems: 6, maxPerChannel: 1 });
  assert.deepEqual(selected.map((item) => item.video_id), ["upload1"]);
});

// --- Helper unit tests -------------------------------------------------------

test("hasNonEventContentSignal uses word-boundary matching (no false positive on unrelated text)", () => {
  assert.equal(hasNonEventContentSignal("major earthquake strikes the region"), false);
  assert.equal(hasNonEventContentSignal("check out our merch store"), true);
});

test("parseIso8601DurationSeconds parses common YouTube duration formats", () => {
  assert.equal(parseIso8601DurationSeconds("PT45S"), 45);
  assert.equal(parseIso8601DurationSeconds("PT4M51S"), 291);
  assert.equal(parseIso8601DurationSeconds("PT1H2M3S"), 3723);
  assert.equal(parseIso8601DurationSeconds(""), null);
});

test("isHardExcluded is unchanged and still active", () => {
  const text = "ancient tomb discovery archaeology dig";
  assert.equal(isHardExcluded(text, exclusions), true);
});

// --- Full pipeline (mocked YouTube fetch) ------------------------------------

function mockFetchImplFor(itemsByChannelId, durationsByVideoId = {}) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/search")) {
      const channelId = parsed.searchParams.get("channelId");
      const items = (itemsByChannelId[channelId] || []).map((entry) => searchItem(entry));
      return { ok: true, json: async () => ({ items }) };
    }
    if (parsed.pathname.endsWith("/videos")) {
      const ids = (parsed.searchParams.get("id") || "").split(",").filter(Boolean);
      const items = ids.map((id) => {
        const details = durationsByVideoId[id] || { durationSeconds: 300, wasLivestream: false };
        return {
          id,
          contentDetails: { duration: `PT${Math.floor(details.durationSeconds / 60)}M${details.durationSeconds % 60}S` },
          liveStreamingDetails: details.wasLivestream ? { actualEndTime: NOW.toISOString() } : undefined
        };
      });
      return { ok: true, json: async () => ({ items }) };
    }
    throw new Error(`Unexpected URL in test mock: ${url}`);
  };
}

test("buildVideoData: curated whitelist yields at most one video per channel, six total, quality over quantity", async () => {
  const itemsByChannelId = {
    [channelById("geologyhub").channel_id]: [
      { videoId: "geo00000001", title: "Major M7.3 Earthquake Strikes Mexico; Geologist Analysis" },
      { videoId: "geo00000002", title: "Meet My 2 Fluffy Coworkers!" }
    ],
    [channelById("tropical-tidbits").channel_id]: [
      { videoId: "trop0000001", title: "[Tuesday] Tropical Storm Bertha Approaching the Central Gulf Coast" }
    ],
    [channelById("wgow-shipping").channel_id]: [
      { videoId: "wgow0000001", title: "Guardians of the Strait? The New Reality in Hormuz" },
      { videoId: "wgow0000002", title: "LIVE: Hormuz Coverage", liveBroadcastContent: "live" }
    ],
    [channelById("force-thirteen").channel_id]: [
      { videoId: "f13000000001", title: "Top 10 Storms that refused to die" },
      { videoId: "f13000000002", title: "Tropical Storm Noul Making a Close Pass to the Philippines" }
    ],
    [channelById("tamitha-skov").channel_id]: [
      { videoId: "tam00000001", title: "The Sun Peppers Earth in Storms and Flares | Solar Storm Forecast" }
    ]
  };

  const durationsByVideoId = {
    geo00000001: { durationSeconds: 291, wasLivestream: false },
    geo00000002: { durationSeconds: 103, wasLivestream: false },
    trop0000001: { durationSeconds: 621, wasLivestream: false },
    wgow0000001: { durationSeconds: 1248, wasLivestream: false },
    f13000000002: { durationSeconds: 348, wasLivestream: false },
    tam00000001: { durationSeconds: 1134, wasLivestream: false }
  };

  const data = await buildVideoData({
    config,
    exclusions,
    previousData: { items: [] },
    fetchImpl: mockFetchImplFor(itemsByChannelId, durationsByVideoId),
    apiKey: "test-key",
    now: NOW
  });

  assert.equal(data.status, "ok");
  assert.ok(data.items.length <= 6);

  const ids = data.items.map((item) => item.video_id);
  assert.ok(ids.includes("geo00000001"));
  assert.ok(!ids.includes("geo00000002"), "pets video must not appear");
  assert.ok(!ids.includes("wgow0000002"), "live placeholder must not appear");
  assert.ok(!ids.includes("f13000000001"), "retrospective must not appear");

  const perChannel = new Map();
  for (const item of data.items) {
    perChannel.set(item.channel_id, (perChannel.get(item.channel_id) || 0) + 1);
  }
  for (const [channelId, count] of perChannel) {
    assert.equal(count, 1, `channel ${channelId} exceeded the 1-video cap`);
  }

  console.log("Regenerated mocked video-data.json:\n" + JSON.stringify(data, null, 2));
});

test("buildVideoData: zero suitable candidates is a valid, successful, empty selection", async () => {
  const itemsByChannelId = {};
  for (const channel of config.approved_channels) {
    itemsByChannelId[channel.channel_id] = [
      { videoId: "irrelevant1", title: "Top 10 Retrospective Countdown Special" }
    ];
  }

  const data = await buildVideoData({
    config,
    exclusions,
    previousData: { items: [] },
    fetchImpl: mockFetchImplFor(itemsByChannelId),
    apiKey: "test-key",
    now: NOW
  });

  assert.deepEqual(data.items, []);
  assert.equal(data.status, "ok");
});

test("buildVideoData: disabled manual-review-hold channels (Ryan Hall Y'all, Max Velocity) are not fetched", async () => {
  const rhy = config.approved_channels.find((c) => c.id === "ryan-hall-yall");
  const mvw = config.approved_channels.find((c) => c.id === "max-velocity-weather");
  assert.ok(rhy && !rhy.enabled);
  assert.ok(mvw && !mvw.enabled);

  const requestedChannelIds = new Set();
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/search")) {
      requestedChannelIds.add(parsed.searchParams.get("channelId"));
      return { ok: true, json: async () => ({ items: [] }) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };

  const data = await buildVideoData({
    config,
    exclusions,
    previousData: { items: [] },
    fetchImpl,
    apiKey: "test-key",
    now: NOW
  });

  assert.equal(data.status, "ok");
  assert.ok(!requestedChannelIds.has(rhy.channel_id), "disabled channel must not be fetched");
  assert.ok(!requestedChannelIds.has(mvw.channel_id), "disabled channel must not be fetched");
});
