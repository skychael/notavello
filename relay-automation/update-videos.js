"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config", "video-sources.json");
const TOPICS_PATH = path.join(__dirname, "config", "topics.json");
const EXCLUSIONS_PATH = path.join(__dirname, "config", "exclusions.json");
const DATA_PATH = path.join(ROOT, "pages", "relay", "video-data.json");
const FETCH_TIMEOUT_MS = 15000;
const YOUTUBE_SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";

const EXCLUSION_TERMS = {
  "ufo-alien-claims": ["ufo", "ufos", "alien", "aliens", "extraterrestrial"],
  "archaeology-ancient-discoveries": [
    "archaeology", "archaeological", "ancient discovery", "ancient artifact",
    "ancient tomb", "ancient ruins"
  ],
  "celebrity-entertainment": [
    "celebrity", "movie", "movies", "film", "television", "music video",
    "award show", "box office"
  ],
  "sports-results": [
    "final score", "game highlights", "match highlights", "standings",
    "playoffs", "championship game"
  ],
  "pornographic-material": ["porn", "pornographic", "sexually explicit"],
  "obvious-spam": ["click here now", "get rich quick", "guaranteed income"],
  "affiliate-only-pages": ["affiliate link", "buy now with code"]
};

const EVENT_SIGNAL_TERMS = [
  "warning", "advisory", "alert", "emergency", "disruption", "hazard",
  "investigation", "outage", "shortage", "closure", "shutdown", "recall",
  "contamination", "contaminated", "vulnerability", "breach",
  "cyber incident", "cyberattack", "ransomware", "data breach",
  "active exploitation", "exploited vulnerability", "severe weather",
  "hurricane", "tropical storm", "tornado", "wildfire", "flooding",
  "flash flood", "flood advisory", "flood warning", "earthquake",
  "magnitude", "eruption", "volcano", "drought", "extreme heat",
  "heat wave", "infrastructure failure", "power outage", "power shutoff",
  "grid emergency", "energy emergency", "fuel shortage", "crop failure",
  "livestock disease", "plant disease", "food recall", "outbreak",
  "health emergency", "public health alert", "port closure", "port delay",
  "shipping disruption", "vessel collision", "collision", "grounding",
  "rail derailment", "derailment", "government advisory", "evacuation",
  "emergency declaration", "state of emergency", "explosion", "collapse",
  "boil water advisory", "water system", "service interruption"
];

const STOP_WORDS = new Set([
  "about", "action", "affected", "affecting", "against", "broad", "change",
  "clear", "conditions", "coverage", "developing", "effect", "government",
  "impact", "including", "major", "other", "potential", "reports", "selected",
  "services", "stories", "system", "systems", "their", "these", "through",
  "warning", "wider", "with"
]);

function decodeHtmlEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: "\"" };
  return String(value || "").replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const radix = entity[1].toLowerCase() === "x" ? 16 : 10;
        const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
        return String.fromCodePoint(Number.parseInt(digits, radix));
      }
      return named[entity.toLowerCase()] || match;
    }
  );
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseMatches(text, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  if (text.includes(normalizedPhrase)) return true;
  const words = normalizedPhrase
    .split(" ")
    .filter((word) => word.length >= 5 && !STOP_WORDS.has(word));
  return words.length >= 2 && words.filter((word) => text.includes(word)).length >= 2;
}

function matchedTopics(text, channel, topics) {
  const allowed = new Set(channel.topics);
  return topics
    .filter((topic) => topic.enabled && allowed.has(topic.id))
    .filter((topic) => {
      const signals = [
        topic.name,
        ...topic.include_terms,
        ...topic.priority_signals
      ];
      return signals.some((signal) => phraseMatches(text, signal));
    })
    .map((topic) => topic.id);
}

function hasEventSignal(text, terms = EVENT_SIGNAL_TERMS) {
  const padded = ` ${text} `;
  return terms.some((term) => padded.includes(` ${normalizeText(term)} `));
}

function isHardExcluded(text, exclusions) {
  return exclusions.hard_exclusions
    .filter((rule) => rule.enabled)
    .some((rule) => (EXCLUSION_TERMS[rule.id] || [])
      .some((term) => normalizeText(text).includes(normalizeText(term))));
}

function sanitizeError(error, apiKey) {
  let message = error?.message || "Unknown YouTube error";
  if (apiKey) message = message.split(apiKey).join("[REDACTED]");
  message = message
    .replace(/key=([^&\s]+)/gi, "key=[REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[request URL redacted]");
  return error?.httpStatus ? `HTTP ${error.httpStatus}: ${message}` : message;
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "Notavello Relay Videos/1.0" },
      signal: controller.signal
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body.error?.message || body.message || "";
      } catch {
        detail = "";
      }
      const error = new Error(detail || "YouTube request failed");
      error.httpStatus = response.status;
      throw error;
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchChannelVideos(channel, publishedAfter, apiKey, fetchImpl) {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set");
  const query = new URLSearchParams({
    part: "snippet",
    channelId: channel.channel_id,
    type: "video",
    order: "date",
    publishedAfter,
    maxResults: "25",
    key: apiKey
  });
  const data = await fetchJson(`${YOUTUBE_SEARCH_ENDPOINT}?${query}`, fetchImpl);
  return data.items || [];
}

function relevantTopicIds(searchableText, channel, topics, titleHasEventSignal) {
  const matched = matchedTopics(searchableText, channel, topics);
  if (matched.length > 0) return matched;
  if (!titleHasEventSignal) return [];
  // An official-agency title can carry a genuine, strongly event-specific
  // signal without repeating topics.json's exact curated wording. In that
  // case, trust the channel's own pre-approved topic scope as supporting
  // context rather than rejecting the video outright.
  const enabledIds = new Set(topics.filter((topic) => topic.enabled).map((topic) => topic.id));
  return channel.topics.filter((id) => enabledIds.has(id));
}

function evaluateCandidate(searchItem, channel, topics, exclusions, cutoff, now) {
  const videoId = searchItem.id?.videoId;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) return { status: "malformed" };

  const publishedAt = new Date(searchItem.snippet?.publishedAt);
  if (!Number.isFinite(publishedAt.getTime()) || publishedAt < cutoff || publishedAt > now) {
    return { status: "outside_lookback" };
  }

  const title = decodeHtmlEntities(searchItem.snippet?.title);
  const description = decodeHtmlEntities(searchItem.snippet?.description);
  if (!title) return { status: "malformed" };

  const titleText = normalizeText(title);
  const searchableText = normalizeText(`${title} ${description}`);
  if (isHardExcluded(searchableText, exclusions)) return { status: "excluded" };

  // The title is weighted more strongly than the description: a video is
  // only accepted when the TITLE itself carries the event signal, so
  // boilerplate that appears only in the description can never qualify it.
  const titleHasEventSignal = hasEventSignal(titleText);
  const topicIds = relevantTopicIds(searchableText, channel, topics, titleHasEventSignal);
  if (topicIds.length === 0) return { status: "no_topic" };
  if (!titleHasEventSignal) return { status: "no_event" };

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.youtube.com" || parsed.pathname !== "/watch") return { status: "malformed" };
  } catch {
    return { status: "malformed" };
  }

  return {
    status: "accepted",
    video: {
      video_id: videoId,
      title,
      url,
      channel_name: channel.channel_name,
      channel_id: channel.channel_id,
      published_at: publishedAt.toISOString(),
      matched_topic_ids: topicIds,
      source_priority: channel.priority,
      status: "ok"
    }
  };
}

function normalizeVideo(searchItem, channel, topics, exclusions, cutoff, now) {
  return evaluateCandidate(searchItem, channel, topics, exclusions, cutoff, now).video || null;
}

function primaryTopicId(item, topicWeightById) {
  let bestId = null;
  let bestWeight = -Infinity;
  for (const id of item.matched_topic_ids) {
    const weight = topicWeightById.get(id) ?? 0;
    if (weight > bestWeight) {
      bestWeight = weight;
      bestId = id;
    }
  }
  return bestId;
}

function deduplicateAndRank(items, { maximumItems, maxPerChannel, maxPerTopic, topicWeightById }) {
  const seenIds = new Set();
  const seenUrls = new Set();
  const ranked = items
    .sort((left, right) =>
      right.source_priority - left.source_priority
      || new Date(right.published_at) - new Date(left.published_at)
      || right.matched_topic_ids.length - left.matched_topic_ids.length
      || left.video_id.localeCompare(right.video_id)
    )
    .filter((item) => {
      if (seenIds.has(item.video_id) || seenUrls.has(item.url)) return false;
      seenIds.add(item.video_id);
      seenUrls.add(item.url);
      return true;
    });

  const channelCounts = new Map();
  const topicCounts = new Map();
  const selected = [];
  for (const item of ranked) {
    if (selected.length >= maximumItems) break;
    const channelCount = channelCounts.get(item.channel_id) || 0;
    if (channelCount >= maxPerChannel) continue;
    const topicId = primaryTopicId(item, topicWeightById);
    const topicCount = topicCounts.get(topicId) || 0;
    if (topicCount >= maxPerTopic) continue;
    selected.push(item);
    channelCounts.set(item.channel_id, channelCount + 1);
    topicCounts.set(topicId, topicCount + 1);
  }
  return selected;
}

function logDiagnostics(diagnostics, candidateCount, items) {
  for (const stats of diagnostics) {
    console.log(
      `Video source diagnostics: channel=${stats.channel_name} `
      + `candidates=${stats.candidates_returned} `
      + `rejected_malformed_or_outside_lookback=${stats.rejected_malformed_or_outside_lookback} `
      + `rejected_exclusions=${stats.rejected_exclusions} `
      + `rejected_no_topic=${stats.rejected_no_topic} `
      + `rejected_no_event=${stats.rejected_no_event} `
      + `accepted=${stats.accepted}`
    );
  }
  console.log(`Video source diagnostics: rejected_by_channel_or_topic_caps=${candidateCount - items.length}`);
  console.log(`Video source diagnostics: final_selected_count=${items.length}`);
  for (const item of items) {
    console.log(`Video source diagnostics: selected channel="${item.channel_name}" title="${item.title}"`);
  }
}

async function buildVideoData({
  config,
  topics,
  exclusions,
  previousData,
  fetchImpl = fetch,
  apiKey = process.env.YOUTUBE_API_KEY,
  now = new Date()
}) {
  const enabledChannels = config.approved_channels.filter((channel) => channel.enabled);
  const cutoff = new Date(now.getTime() - config.lookback_hours * 60 * 60 * 1000);
  const publishedAfter = cutoff.toISOString();

  const results = await Promise.all(enabledChannels.map(async (channel) => {
    try {
      const searchItems = await fetchChannelVideos(
        channel,
        publishedAfter,
        apiKey,
        fetchImpl
      );
      return { channel, searchItems, status: "ok" };
    } catch (error) {
      console.error(
        `Video source failed: channel=${channel.id} provider=youtube error=${sanitizeError(error, apiKey)}`
      );
      return { channel, searchItems: [], status: "failed" };
    }
  }));

  const candidates = [];
  const diagnostics = [];
  for (const result of results) {
    const stats = {
      channel_name: result.channel.channel_name,
      candidates_returned: result.searchItems.length,
      rejected_malformed_or_outside_lookback: 0,
      rejected_exclusions: 0,
      rejected_no_topic: 0,
      rejected_no_event: 0,
      accepted: 0
    };
    if (result.status === "ok") {
      for (const searchItem of result.searchItems) {
        const evaluation = evaluateCandidate(
          searchItem,
          result.channel,
          topics.topics,
          exclusions,
          cutoff,
          now
        );
        switch (evaluation.status) {
          case "malformed":
          case "outside_lookback":
            stats.rejected_malformed_or_outside_lookback += 1;
            break;
          case "excluded":
            stats.rejected_exclusions += 1;
            break;
          case "no_topic":
            stats.rejected_no_topic += 1;
            break;
          case "no_event":
            stats.rejected_no_event += 1;
            break;
          case "accepted":
            stats.accepted += 1;
            candidates.push(evaluation.video);
            break;
        }
      }
    } else {
      for (const previous of previousData?.items || []) {
        if (previous.channel_id === result.channel.channel_id) {
          candidates.push({ ...previous, status: "stale" });
        }
      }
    }
    diagnostics.push(stats);
  }

  const topicWeightById = new Map(topics.topics.map((topic) => [topic.id, topic.weight]));
  const items = deduplicateAndRank(candidates, {
    maximumItems: config.maximum_items,
    maxPerChannel: config.max_per_channel ?? 2,
    maxPerTopic: config.max_per_topic ?? 2,
    topicWeightById
  });
  logDiagnostics(diagnostics, candidates.length, items);

  const successfulChannels = results.filter((result) => result.status === "ok").length;
  const staleItems = items.filter((item) => item.status === "stale").length;
  return {
    schema_version: "1.0",
    checked_at: now.toISOString(),
    latest_success_at: successfulChannels > 0
      ? now.toISOString()
      : previousData?.latest_success_at || null,
    status: successfulChannels === enabledChannels.length
      ? "ok"
      : successfulChannels > 0
        ? "partial"
        : staleItems > 0
          ? "stale"
          : "unavailable",
    items
  };
}

async function writeJsonAtomic(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function run() {
  console.log(process.env.YOUTUBE_API_KEY
    ? "YOUTUBE_API_KEY is present"
    : "YOUTUBE_API_KEY is missing");
  const [config, topics, exclusions, previousData] = await Promise.all([
    readJson(CONFIG_PATH),
    readJson(TOPICS_PATH),
    readJson(EXCLUSIONS_PATH),
    readJson(DATA_PATH, { items: [] })
  ]);
  const data = await buildVideoData({ config, topics, exclusions, previousData });
  await writeJsonAtomic(DATA_PATH, data);
  console.log(`Videos updated: status=${data.status} items=${data.items.length}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Video update failed: ${sanitizeError(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildVideoData,
  decodeHtmlEntities,
  deduplicateAndRank,
  evaluateCandidate,
  hasEventSignal,
  isHardExcluded,
  matchedTopics,
  normalizeVideo,
  primaryTopicId,
  relevantTopicIds,
  sanitizeError,
  writeJsonAtomic
};
