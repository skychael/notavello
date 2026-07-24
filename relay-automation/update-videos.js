"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config", "video-sources.json");
const EXCLUSIONS_PATH = path.join(__dirname, "config", "exclusions.json");
const DATA_PATH = path.join(ROOT, "pages", "relay", "video-data.json");
const FETCH_TIMEOUT_MS = 15000;
const YOUTUBE_SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_MAX_DURATION_SECONDS = 60;

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

// Basic, bounded, deterministic content-format exclusions requested by the
// editorial model: channel announcements, merchandise, fundraising,
// retrospectives, and tutorials that are not tied to a current event. This
// is a small fixed list of format/category markers, not a positive
// relevance vocabulary — the approved channel list itself is the relevance
// filter.
const NON_EVENT_CONTENT_TERMS = [
  "channel announcement", "programming note", "housekeeping", "site update",
  "merch", "merchandise", "shop now", "use code", "storefront",
  "patreon", "donate", "donation", "fundraiser", "gofundme",
  "support the channel", "membership perk",
  "top 10", "top ten", "year in review", "retrospective", "looking back",
  "best of", "throwback", "anniversary special", "season animation",
  "tutorial", "how to use", "beginner's guide", "getting started guide"
];

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

function containsPhrase(text, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

function hasNonEventContentSignal(text) {
  return NON_EVENT_CONTENT_TERMS.some((term) => containsPhrase(text, term));
}

function isHardExcluded(text, exclusions) {
  return exclusions.hard_exclusions
    .filter((rule) => rule.enabled)
    .some((rule) => (EXCLUSION_TERMS[rule.id] || [])
      .some((term) => normalizeText(text).includes(normalizeText(term))));
}

function parseIso8601DurationSeconds(duration) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration || "");
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
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

async function fetchVideoDetails(videoIds, apiKey, fetchImpl) {
  const detailsById = new Map();
  if (videoIds.length === 0) return detailsById;
  const query = new URLSearchParams({
    part: "contentDetails,liveStreamingDetails",
    id: videoIds.join(","),
    key: apiKey
  });
  const data = await fetchJson(`${YOUTUBE_VIDEOS_ENDPOINT}?${query}`, fetchImpl);
  for (const item of data.items || []) {
    detailsById.set(item.id, {
      durationSeconds: parseIso8601DurationSeconds(item.contentDetails?.duration),
      wasLivestream: Boolean(item.liveStreamingDetails)
    });
  }
  return detailsById;
}

function evaluateCandidate(searchItem, channel, exclusions, videoDetailsById, cutoff, now) {
  const videoId = searchItem.id?.videoId;
  if (!VIDEO_ID_PATTERN.test(videoId || "")) return { status: "malformed" };
  if (!CHANNEL_ID_PATTERN.test(channel.channel_id || "")) return { status: "malformed" };

  const publishedAt = new Date(searchItem.snippet?.publishedAt);
  if (!Number.isFinite(publishedAt.getTime()) || publishedAt < cutoff || publishedAt > now) {
    return { status: "outside_lookback" };
  }

  const title = decodeHtmlEntities(searchItem.snippet?.title);
  const description = decodeHtmlEntities(searchItem.snippet?.description);
  if (!title) return { status: "malformed" };

  const searchableText = normalizeText(`${title} ${description}`);
  if (isHardExcluded(searchableText, exclusions)) return { status: "excluded" };

  const liveBroadcastContent = searchItem.snippet?.liveBroadcastContent || "none";
  if (liveBroadcastContent !== "none") return { status: "livestream_placeholder" };

  if (hasNonEventContentSignal(searchableText)) return { status: "non_event_content" };

  const details = videoDetailsById.get(videoId);
  if (details?.durationSeconds != null && details.durationSeconds <= SHORTS_MAX_DURATION_SECONDS) {
    return { status: "short" };
  }

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
      source_priority: channel.priority,
      is_livestream_replay: Boolean(details?.wasLivestream),
      status: "ok"
    }
  };
}

function deduplicateAndRank(items, { maximumItems, maxPerChannel }) {
  const seenIds = new Set();
  const seenUrls = new Set();
  const ranked = items
    .sort((left, right) =>
      right.source_priority - left.source_priority
      || Number(left.is_livestream_replay) - Number(right.is_livestream_replay)
      || new Date(right.published_at) - new Date(left.published_at)
      || left.video_id.localeCompare(right.video_id)
    )
    .filter((item) => {
      if (seenIds.has(item.video_id) || seenUrls.has(item.url)) return false;
      seenIds.add(item.video_id);
      seenUrls.add(item.url);
      return true;
    });

  const channelCounts = new Map();
  const selected = [];
  for (const item of ranked) {
    if (selected.length >= maximumItems) break;
    const channelCount = channelCounts.get(item.channel_id) || 0;
    if (channelCount >= maxPerChannel) continue;
    selected.push(item);
    channelCounts.set(item.channel_id, channelCount + 1);
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
      + `rejected_livestream_placeholder=${stats.rejected_livestream_placeholder} `
      + `rejected_non_event_content=${stats.rejected_non_event_content} `
      + `rejected_short=${stats.rejected_short} `
      + `accepted=${stats.accepted}`
    );
  }
  console.log(`Video source diagnostics: rejected_by_channel_cap_or_duplicate=${candidateCount - items.length}`);
  console.log(`Video source diagnostics: final_selected_count=${items.length}`);
  for (const item of items) {
    console.log(`Video source diagnostics: selected channel="${item.channel_name}" title="${item.title}"`);
  }
}

async function buildVideoData({
  config,
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
    if (!CHANNEL_ID_PATTERN.test(channel.channel_id || "")) {
      console.error(`Video source failed: channel=${channel.id} provider=youtube error=malformed channel id`);
      return { channel, searchItems: [], videoDetailsById: new Map(), status: "failed" };
    }
    try {
      const searchItems = await fetchChannelVideos(channel, publishedAfter, apiKey, fetchImpl);
      const videoIds = searchItems
        .map((item) => item.id?.videoId)
        .filter((id) => VIDEO_ID_PATTERN.test(id || ""));
      const videoDetailsById = await fetchVideoDetails(videoIds, apiKey, fetchImpl);
      return { channel, searchItems, videoDetailsById, status: "ok" };
    } catch (error) {
      console.error(
        `Video source failed: channel=${channel.id} provider=youtube error=${sanitizeError(error, apiKey)}`
      );
      return { channel, searchItems: [], videoDetailsById: new Map(), status: "failed" };
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
      rejected_livestream_placeholder: 0,
      rejected_non_event_content: 0,
      rejected_short: 0,
      accepted: 0
    };
    if (result.status === "ok") {
      for (const searchItem of result.searchItems) {
        const evaluation = evaluateCandidate(
          searchItem,
          result.channel,
          exclusions,
          result.videoDetailsById,
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
          case "livestream_placeholder":
            stats.rejected_livestream_placeholder += 1;
            break;
          case "non_event_content":
            stats.rejected_non_event_content += 1;
            break;
          case "short":
            stats.rejected_short += 1;
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

  const items = deduplicateAndRank(candidates, {
    maximumItems: config.maximum_items,
    maxPerChannel: config.max_per_channel ?? 1
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
  const [config, exclusions, previousData] = await Promise.all([
    readJson(CONFIG_PATH),
    readJson(EXCLUSIONS_PATH),
    readJson(DATA_PATH, { items: [] })
  ]);
  const data = await buildVideoData({ config, exclusions, previousData });
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
  hasNonEventContentSignal,
  isHardExcluded,
  parseIso8601DurationSeconds,
  sanitizeError,
  writeJsonAtomic
};
