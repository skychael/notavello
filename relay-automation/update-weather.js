"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const {
  canonicalizeUrl,
  deriveApprovedHostnames,
  isApprovedLink,
  parseFeed,
  sanitizeError,
  writeJsonAtomic
} = require("./update-articles");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config", "weather-sources.json");
const DATA_PATH = path.join(ROOT, "pages", "relay", "weather-data.json");
const FETCH_TIMEOUT_MS = 15000;

const WEATHER_TOPICS = [
  { topic: "Hurricane", severity: 100, continuing: true, pattern: /\b(hurricane|tropical storm|typhoon|cyclone)\b/i },
  { topic: "Flooding", severity: 95, continuing: true, pattern: /\b(flash[- ]flood emergency|major flooding|catastrophic flooding|widespread flooding|atmospheric river)\b/i },
  { topic: "Severe weather", severity: 92, continuing: false, pattern: /\b(tornado outbreak|severe thunderstorm outbreak|severe storm outbreak|damaging hail|major lightning event|damaging winds?|major weather warning)\b/i },
  { topic: "Wildfire", severity: 90, continuing: true, pattern: /\b(wildfire|wildfire smoke|fire weather emergency)\b/i },
  { topic: "Heat", severity: 88, continuing: true, pattern: /\b(extreme heat|heat emergency|heat wave)\b/i },
  { topic: "Snow", severity: 88, continuing: true, pattern: /\b(blizzard|major snowstorm)\b/i },
  { topic: "Air quality", severity: 86, continuing: true, pattern: /\b(hazardous air quality|air quality emergency)\b/i },
  { topic: "Drought", severity: 82, continuing: true, pattern: /\bdrought emergency\b/i }
];

const ACTIVE_CONTINUING_PATTERN = /\b(active|continues?|ongoing|emergency|warning|threatens?|impacts?|landfall|evacuation|uncontained|outbreak)\b/i;
const RESOLVED_PATTERN = /\b(resolved|expired|cancelled|canceled|dissipated|post-tropical|remnants? no longer)\b/i;
const MINOR_ADVISORY_PATTERN = /\b(heat advisory|wind advisory|winter weather advisory|flood advisory|small craft advisory)\b/i;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function classifyWeather(text) {
  return WEATHER_TOPICS.find((rule) => rule.pattern.test(text)) || null;
}

function stableId(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function eventKey(title, topic) {
  const normalized = normalizeText(title);
  const namedStorm = /\b(?:hurricane|tropical storm|typhoon|cyclone)\s+([a-z][a-z0-9-]+)/i.exec(title);
  if (namedStorm) return `named-storm:${namedStorm[1].toLowerCase()}`;
  return `${topic.toLowerCase()}:${normalized
    .replace(/\b(update|updated|warning|emergency|issued|continues|active|major)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()}`;
}

function evaluateWeatherCandidate(entry, source, { now, lookbackHours, continuingEventHours }) {
  const title = String(entry?.title || "").trim();
  const publisher = String(source?.publisher_name || "").trim();
  if (!title || !publisher || !entry?.link) return { status: "malformed" };

  const approvedHostnames = deriveApprovedHostnames(source.homepage_url);
  if (!safeHttpUrl(entry.link) || !isApprovedLink(entry.link, approvedHostnames)) return { status: "unsafe_url" };

  const published = new Date(entry.published);
  if (!Number.isFinite(published.getTime()) || published > now) return { status: "invalid_timestamp" };

  const text = `${title} ${entry.summary || ""} ${entry.category || ""}`;
  if (RESOLVED_PATTERN.test(text)) return { status: "resolved" };
  if (MINOR_ADVISORY_PATTERN.test(text)) return { status: "minor_advisory" };

  const classification = classifyWeather(text);
  if (!classification) return { status: "not_consequential" };

  const ageHours = (now - published) / 3600000;
  if (ageHours > lookbackHours) {
    const continuing = classification.continuing
      && ageHours <= continuingEventHours
      && ACTIVE_CONTINUING_PATTERN.test(text);
    if (!continuing) return { status: "stale" };
  }

  const canonicalUrl = canonicalizeUrl(entry.link);
  const article = {
    id: stableId(canonicalUrl),
    title,
    url: canonicalUrl,
    publisher,
    published_at: published.toISOString(),
    topic: classification.topic,
    status: "ok"
  };

  const imageUrl = source.trusted_images ? safeHttpUrl(entry.image) : "";
  if (imageUrl) article.image_url = imageUrl;

  const consequenceBonus = /\b(emergency|outbreak|catastrophic|evacuation|landfall)\b/i.test(text) ? 8 : 0;
  return {
    status: "accepted",
    article,
    rank: {
      severity: classification.severity + consequenceBonus,
      sourcePriority: Number(source.priority || 0),
      eventKey: eventKey(text, classification.topic)
    }
  };
}

async function fetchFeed(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "Notavello Relay Weather/1.0",
        "Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error("Weather feed request failed");
      error.httpStatus = response.status;
      throw error;
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function collectWeatherSource(source, config, now, fetchImpl) {
  const xml = await fetchFeed(source.feed_url, fetchImpl);
  const parsed = parseFeed(xml);
  if (!parsed.format) throw new Error("Weather feed was not RSS or Atom");

  const accepted = [];
  const counts = {};
  for (const entry of parsed.entries) {
    const result = evaluateWeatherCandidate(entry, source, {
      now,
      lookbackHours: config.lookback_hours,
      continuingEventHours: config.continuing_event_hours
    });
    counts[result.status] = (counts[result.status] || 0) + 1;
    if (result.status === "accepted") accepted.push(result);
  }
  console.log(`Weather source: source=${source.id} candidates=${parsed.entries.length} accepted=${accepted.length}`);
  return { accepted, counts };
}

function rankWeatherCandidates(candidates, maximumItems = 3) {
  const sorted = [...candidates].sort((left, right) =>
    right.rank.severity - left.rank.severity
    || new Date(right.article.published_at) - new Date(left.article.published_at)
    || right.rank.sourcePriority - left.rank.sourcePriority
    || left.article.url.localeCompare(right.article.url)
  );
  const seenUrls = new Set();
  const seenTitles = new Set();
  const seenEvents = new Set();
  const selected = [];
  for (const candidate of sorted) {
    const normalizedTitle = normalizeText(candidate.article.title);
    if (seenUrls.has(candidate.article.url)
      || seenTitles.has(normalizedTitle)
      || seenEvents.has(candidate.rank.eventKey)) continue;
    seenUrls.add(candidate.article.url);
    seenTitles.add(normalizedTitle);
    seenEvents.add(candidate.rank.eventKey);
    selected.push(candidate.article);
    if (selected.length >= maximumItems) break;
  }
  return selected;
}

function isValidPreviousWeatherData(value) {
  return Boolean(value && value.schema_version === "1.0"
    && typeof value.latest_success_at === "string"
    && Array.isArray(value.items)
    && value.items.length <= 3);
}

async function buildWeatherData({
  config,
  previousData = null,
  fetchImpl = fetch,
  now = new Date()
}) {
  const sources = config.sources.filter((source) => source.enabled);
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const result = await collectWeatherSource(source, config, now, fetchImpl);
      return { source, status: "ok", ...result };
    } catch (error) {
      console.error(`Weather source failed: source=${source.id} error=${sanitizeError(error)}`);
      return { source, status: "failed", accepted: [], counts: {} };
    }
  }));

  const successful = results.filter((result) => result.status === "ok");
  if (sources.length > 0 && successful.length === 0 && isValidPreviousWeatherData(previousData)) {
    return { shouldWrite: false, preserved: true, data: previousData };
  }

  const items = rankWeatherCandidates(
    successful.flatMap((result) => result.accepted),
    config.maximum_items
  );
  const failedCount = results.length - successful.length;
  const status = successful.length === 0
    ? "unavailable"
    : failedCount > 0
      ? "partial"
      : items.length
        ? "ok"
        : "ok_empty";
  const generatedAt = now.toISOString();
  return {
    shouldWrite: true,
    preserved: false,
    data: {
      schema_version: "1.0",
      generated_at: generatedAt,
      latest_success_at: successful.length ? generatedAt : previousData?.latest_success_at || null,
      status,
      items
    }
  };
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
  const [config, previousData] = await Promise.all([
    readJson(CONFIG_PATH),
    readJson(DATA_PATH, null)
  ]);
  const result = await buildWeatherData({ config, previousData });
  if (!result.shouldWrite) {
    console.log("Weather feed unchanged: every source failed; preserved previous valid data.");
    return;
  }
  await writeJsonAtomic(DATA_PATH, result.data);
  console.log(`Weather feed updated: status=${result.data.status} items=${result.data.items.length}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Weather feed update failed: ${sanitizeError(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildWeatherData,
  classifyWeather,
  evaluateWeatherCandidate,
  eventKey,
  isValidPreviousWeatherData,
  normalizeText,
  rankWeatherCandidates,
  safeHttpUrl,
  stableId
};
