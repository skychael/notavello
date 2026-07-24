"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config", "sources.json");
const EXCLUSIONS_PATH = path.join(__dirname, "config", "exclusions.json");
const DATA_PATH = path.join(ROOT, "pages", "relay", "article-data.json");
const FETCH_TIMEOUT_MS = 15000;

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

// Small, bounded, deterministic content-format exclusions shared across
// every publisher: opinion, podcasts, webinars, sponsored content,
// tutorials, funding/acquisition/appointment business news, product
// launches, retrospectives, and conference/deal promotion. This is not a
// positive relevance vocabulary — the curated publisher list is the
// relevance filter.
const UNIVERSAL_REJECT_TERMS = [
  "opinion", "op-ed", "first opinion",
  "podcast", "webinar", "newsletter", "sponsored content", "advertorial",
  "explainer", "evergreen explainer", "everything you need to know", "guide to",
  "general guidance", "general advice", "generic advice",
  "tutorial", "how to", "buying guide", "beginner's guide",
  "funding round", "series a funding", "series b funding", "raises $",
  "acquires", "completes acquisition", "announces acquisition",
  "appoints new", "names new chief", "hires new chief",
  "product launch", "unveils new product", "announces new product", "product promotion",
  "year in review", "looking back at", "anniversary special", "retrospective",
  "register now for", "call for speakers", "call for papers", "conference registration", "event promotion",
  "% off", "discount code", "giveaway", "deal:"
];

// Small per-publisher supplements for the few reject categories not already
// covered by the universal list above.
const PUBLISHER_SPECIFIC_REJECT_TERMS = {
  "the-watchers": ["stargazing", "night sky this week", "meteor shower viewing guide", "best telescopes"],
  "food-safety-news": ["recipe", "recipes"],
  "securityweek": [],
  "stat": ["wellness", "self-care", "investor news", "quarterly earnings", "earnings report"],
  "canary-media": ["profile:", "q&a with"],
  "bleepingcomputer": ["download", "forum post", "top 10 tools"]
};

const TRACKING_PARAM_NAMES = new Set(["ref", "fbclid", "gclid", "mc_cid", "mc_eid", "icid"]);

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
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

function isHardExcluded(text, exclusions) {
  return exclusions.hard_exclusions
    .filter((rule) => rule.enabled)
    .some((rule) => (EXCLUSION_TERMS[rule.id] || [])
      .some((term) => normalizeText(text).includes(normalizeText(term))));
}

function isSourceSpecificReject(sourceId, text) {
  const terms = [...UNIVERSAL_REJECT_TERMS, ...(PUBLISHER_SPECIFIC_REJECT_TERMS[sourceId] || [])];
  return terms.some((term) => containsPhrase(text, term));
}

function sanitizeError(error) {
  let message = error?.message || "Unknown feed error";
  message = message.replace(/https?:\/\/\S+/gi, "[request URL redacted]");
  return error?.httpStatus ? `HTTP ${error.httpStatus}: ${message}` : message;
}

async function fetchWithTimeout(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      headers: { "User-Agent": "Notavello Relay Articles/1.0" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFeedText(url, fetchImpl) {
  const response = await fetchWithTimeout(url, fetchImpl);
  if (!response.ok) {
    const error = new Error("Feed request failed");
    error.httpStatus = response.status;
    throw error;
  }
  return response.text();
}

// --- Minimal, dependency-free RSS/Atom parsing ------------------------------

function extractBlocks(xml, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const blocks = [];
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function extractTagText(block, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = pattern.exec(block);
  if (!match) return null;
  const cdataMatch = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1]);
  const raw = cdataMatch ? cdataMatch[1] : match[1];
  const decoded = decodeHtmlEntities(raw).trim();
  return decoded || null;
}

function extractAtomLink(block) {
  const linkPattern = /<link\b([^>]*?)\/?>/gi;
  let match;
  let fallback = null;
  while ((match = linkPattern.exec(block)) !== null) {
    const attrs = match[1];
    const hrefMatch = /href=["']([^"']+)["']/i.exec(attrs);
    if (!hrefMatch) continue;
    const relMatch = /rel=["']([^"']+)["']/i.exec(attrs);
    const rel = relMatch ? relMatch[1] : "alternate";
    const href = decodeHtmlEntities(hrefMatch[1]).trim();
    if (rel === "alternate") return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function detectFeedFormat(xml) {
  if (/<feed[\s>]/i.test(xml)) return "atom";
  if (/<rss[\s>]/i.test(xml) || /<rdf:rdf[\s>]/i.test(xml)) return "rss";
  return null;
}

function parseFeed(xmlText) {
  const format = detectFeedFormat(xmlText);
  if (!format) return { format: null, entries: [] };

  if (format === "atom") {
    const entries = extractBlocks(xmlText, "entry").map((block) => ({
      title: extractTagText(block, "title"),
      link: extractAtomLink(block),
      id: extractTagText(block, "id"),
      published: extractTagText(block, "published") || extractTagText(block, "updated"),
      category: extractTagText(block, "category"),
      author: extractTagText(block, "name"),
      summary: stripHtml(extractTagText(block, "summary") || extractTagText(block, "content") || "")
    }));
    return { format, entries };
  }

  const entries = extractBlocks(xmlText, "item").map((block) => ({
    title: extractTagText(block, "title"),
    link: extractTagText(block, "link"),
    id: extractTagText(block, "guid"),
    published: extractTagText(block, "pubDate"),
    category: extractTagText(block, "category"),
    author: extractTagText(block, "author") || extractTagText(block, "dc:creator"),
    summary: stripHtml(extractTagText(block, "description") || "")
  }));
  return { format, entries };
}

// --- Canonical URL handling --------------------------------------------------

function canonicalizeUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const params = new URLSearchParams(parsed.search);
  for (const key of Array.from(params.keys())) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAM_NAMES.has(lower)) params.delete(key);
  }
  const search = params.toString();
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === "") pathname = "/";
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${search ? `?${search}` : ""}`;
}

function deriveApprovedHostnames(homepageUrl) {
  const hostnames = new Set();
  try {
    const hostname = new URL(homepageUrl).hostname.toLowerCase();
    hostnames.add(hostname);
    hostnames.add(hostname.startsWith("www.") ? hostname.slice(4) : `www.${hostname}`);
  } catch {
    // No usable homepage URL: leave the approved-hostname set empty so
    // every link fails the hostname check rather than silently passing.
  }
  return hostnames;
}

function isApprovedLink(link, approvedHostnames) {
  try {
    return approvedHostnames.has(new URL(link).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function getFeedUrls(source) {
  if (Array.isArray(source.feed_urls) && source.feed_urls.length > 0) return source.feed_urls;
  if (source.feed_url) return [source.feed_url];
  return [];
}

// --- Candidate evaluation -----------------------------------------------------

function evaluateArticleCandidate(entry, source, exclusions, approvedHostnames, cutoff, now) {
  const title = decodeHtmlEntities(entry.title || "").trim();
  if (!title) return { status: "malformed" };
  if (!entry.link) return { status: "malformed" };

  let parsedUrl;
  try {
    parsedUrl = new URL(entry.link);
  } catch {
    return { status: "malformed" };
  }
  if (parsedUrl.protocol !== "https:") return { status: "non_https" };
  if (!isApprovedLink(entry.link, approvedHostnames)) return { status: "malformed" };

  const publishedAt = entry.published ? new Date(entry.published) : null;
  if (!publishedAt || !Number.isFinite(publishedAt.getTime())) return { status: "malformed" };
  if (publishedAt < cutoff || publishedAt > now) return { status: "outside_lookback" };

  const searchableText = normalizeText(`${title} ${entry.summary || ""} ${entry.category || ""}`);
  if (isHardExcluded(searchableText, exclusions)) return { status: "excluded" };
  if (isSourceSpecificReject(source.id, searchableText)) return { status: "unsuitable_content" };

  return {
    status: "accepted",
    article: {
      title,
      url: canonicalizeUrl(entry.link),
      publisher: source.publisher_name,
      published_at: publishedAt.toISOString(),
      source_id: source.id,
      status: "ok"
    }
  };
}

function emptySourceStats(source) {
  return {
    publisher_name: source.publisher_name,
    entries_returned: 0,
    rejected_outside_lookback: 0,
    rejected_malformed: 0,
    rejected_duplicate: 0,
    rejected_hard_exclusions: 0,
    rejected_unsuitable_content: 0,
    accepted: 0
  };
}

async function collectSourceCandidates(source, exclusions, cutoff, now, fetchImpl) {
  const feedUrls = getFeedUrls(source);
  const approvedHostnames = deriveApprovedHostnames(source.homepage_url);
  const stats = emptySourceStats(source);
  const seenUrls = new Set();
  const accepted = [];

  for (const feedUrl of feedUrls) {
    const xmlText = await fetchFeedText(feedUrl, fetchImpl);
    const { entries } = parseFeed(xmlText);
    stats.entries_returned += entries.length;
    for (const entry of entries) {
      const evaluation = evaluateArticleCandidate(entry, source, exclusions, approvedHostnames, cutoff, now);
      switch (evaluation.status) {
        case "malformed":
        case "non_https":
          stats.rejected_malformed += 1;
          break;
        case "outside_lookback":
          stats.rejected_outside_lookback += 1;
          break;
        case "excluded":
          stats.rejected_hard_exclusions += 1;
          break;
        case "unsuitable_content":
          stats.rejected_unsuitable_content += 1;
          break;
        case "accepted":
          if (seenUrls.has(evaluation.article.url)) {
            stats.rejected_duplicate += 1;
          } else {
            seenUrls.add(evaluation.article.url);
            accepted.push(evaluation.article);
            stats.accepted += 1;
          }
          break;
      }
    }
  }

  return { stats, accepted };
}

// --- Ranking and selection ----------------------------------------------------

function rankAndSelect(candidates, { maximumItems, maximumItemsPerSource, sourcePriorityById }) {
  const seenUrls = new Set();
  const ranked = candidates
    .sort((left, right) =>
      (sourcePriorityById.get(right.source_id) ?? 0) - (sourcePriorityById.get(left.source_id) ?? 0)
      || new Date(right.published_at) - new Date(left.published_at)
      || left.url.localeCompare(right.url)
    )
    .filter((item) => {
      if (seenUrls.has(item.url)) return false;
      seenUrls.add(item.url);
      return true;
    });

  const perSourceCounts = new Map();
  const selected = [];
  for (const item of ranked) {
    if (selected.length >= maximumItems) break;
    const count = perSourceCounts.get(item.source_id) || 0;
    if (count >= maximumItemsPerSource) continue;
    selected.push(item);
    perSourceCounts.set(item.source_id, count + 1);
  }
  return selected;
}

function logArticleDiagnostics(statsList, candidateCount, items) {
  for (const stats of statsList) {
    console.log(
      `Article source diagnostics: publisher=${stats.publisher_name} `
      + `entries_returned=${stats.entries_returned} `
      + `rejected_outside_lookback=${stats.rejected_outside_lookback} `
      + `rejected_malformed=${stats.rejected_malformed} `
      + `rejected_duplicate=${stats.rejected_duplicate} `
      + `rejected_hard_exclusions=${stats.rejected_hard_exclusions} `
      + `rejected_unsuitable_content=${stats.rejected_unsuitable_content} `
      + `accepted=${stats.accepted}`
    );
  }
  console.log(`Article source diagnostics: rejected_by_publisher_cap=${candidateCount - items.length}`);
  console.log(`Article source diagnostics: final_selected_count=${items.length}`);
  for (const item of items) {
    console.log(`Article source diagnostics: selected publisher="${item.publisher}" title="${item.title}"`);
  }
}

// --- Main collection pipeline --------------------------------------------------

async function buildArticleData({
  config,
  exclusions,
  previousData,
  fetchImpl = fetch,
  now = new Date()
}) {
  const enabledSources = config.automatic_sources.filter((source) => source.enabled);
  const cutoff = new Date(now.getTime() - config.lookback_hours * 60 * 60 * 1000);

  const results = await Promise.all(enabledSources.map(async (source) => {
    try {
      const { stats, accepted } = await collectSourceCandidates(source, exclusions, cutoff, now, fetchImpl);
      return { source, stats, accepted, status: "ok" };
    } catch (error) {
      console.error(`Article source failed: source=${source.id} error=${sanitizeError(error)}`);
      return { source, stats: emptySourceStats(source), accepted: [], status: "failed" };
    }
  }));

  const candidates = results.flatMap((result) => result.accepted);
  const sourcePriorityById = new Map(config.automatic_sources.map((source) => [source.id, source.priority]));
  const items = rankAndSelect(candidates, {
    maximumItems: config.maximum_items,
    maximumItemsPerSource: config.maximum_items_per_source,
    sourcePriorityById
  });
  logArticleDiagnostics(results.map((result) => result.stats), candidates.length, items);

  const successfulSources = results.filter((result) => result.status === "ok");
  const failedSources = results.filter((result) => result.status === "failed");
  const allFailed = enabledSources.length > 0 && successfulSources.length === 0;

  let status;
  let finalItems;
  let latestSuccessAt;

  if (allFailed) {
    const hasPrevious = Array.isArray(previousData?.items) && previousData.items.length > 0;
    if (hasPrevious) {
      status = "stale";
      finalItems = previousData.items.map((item) => ({ ...item, status: "stale" }));
      latestSuccessAt = previousData.latest_success_at || null;
    } else {
      status = "unavailable";
      finalItems = [];
      latestSuccessAt = previousData?.latest_success_at || null;
    }
  } else {
    finalItems = items;
    latestSuccessAt = now.toISOString();
    status = finalItems.length === 0
      ? "ok_empty"
      : failedSources.length > 0
        ? "partial"
        : "ok";
  }

  return {
    schema_version: "1.0",
    checked_at: now.toISOString(),
    latest_success_at: latestSuccessAt,
    status,
    items: finalItems
  };
}

// --- Feed verification mode -----------------------------------------------------

async function verifyFeeds({ config, fetchImpl = fetch }) {
  const results = [];
  for (const source of config.automatic_sources) {
    const feedUrls = getFeedUrls(source);
    if (feedUrls.length === 0) {
      results.push({
        id: source.id,
        enabled: source.enabled,
        status: "no_feed_configured",
        httpStatus: null,
        format: null,
        entryCount: null,
        reason: "no configured feed URL"
      });
      continue;
    }

    const approvedHostnames = deriveApprovedHostnames(source.homepage_url);
    for (const feedUrl of feedUrls) {
      const result = { id: source.id, enabled: source.enabled, httpStatus: null, format: null, entryCount: null, reason: null };
      try {
        const response = await fetchWithTimeout(feedUrl, fetchImpl);
        result.httpStatus = response.status;
        if (!response.ok) {
          result.status = "http_error";
          result.reason = `HTTP ${response.status}`;
          results.push(result);
          continue;
        }
        const xmlText = await response.text();
        const { format, entries } = parseFeed(xmlText);
        result.format = format;
        result.entryCount = entries.length;
        if (!format) {
          result.status = "parse_error";
          result.reason = "response did not parse as RSS or Atom";
        } else if (entries.length === 0) {
          result.status = "empty_feed";
          result.reason = "feed parsed but contained zero entries";
        } else {
          const unapproved = entries.filter((entry) => !entry.link || !isApprovedLink(entry.link, approvedHostnames));
          if (unapproved.length > 0) {
            result.status = "hostname_mismatch";
            result.reason = `${unapproved.length} of ${entries.length} entries used a link outside the approved hostnames`;
          } else {
            result.status = "valid";
          }
        }
      } catch (error) {
        result.status = "request_failed";
        result.reason = sanitizeError(error);
      }
      results.push(result);
    }
  }
  return results;
}

function printVerifyFeedsReport(results) {
  for (const result of results) {
    console.log(
      `source=${result.id} `
      + `enabled=${result.enabled} `
      + `status=${result.status} `
      + `http_status=${result.httpStatus ?? "n/a"} `
      + `format=${result.format ?? "n/a"} `
      + `entries=${result.entryCount ?? "n/a"} `
      + `reason=${result.reason ?? "n/a"}`
    );
  }
}

// --- I/O -------------------------------------------------------------------

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
  const verifyMode = process.argv.includes("--verify-feeds");
  const config = await readJson(CONFIG_PATH);

  if (verifyMode) {
    const results = await verifyFeeds({ config });
    printVerifyFeedsReport(results);
    const hasInvalidEnabledFeed = results.some((result) => result.enabled && result.status !== "valid");
    process.exitCode = hasInvalidEnabledFeed ? 1 : 0;
    return;
  }

  const [exclusions, previousData] = await Promise.all([
    readJson(EXCLUSIONS_PATH),
    readJson(DATA_PATH, { items: [] })
  ]);
  const data = await buildArticleData({ config, exclusions, previousData });
  await writeJsonAtomic(DATA_PATH, data);
  console.log(`Articles updated: status=${data.status} items=${data.items.length}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Article update failed: ${sanitizeError(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildArticleData,
  canonicalizeUrl,
  decodeHtmlEntities,
  deriveApprovedHostnames,
  evaluateArticleCandidate,
  getFeedUrls,
  isApprovedLink,
  isHardExcluded,
  isSourceSpecificReject,
  normalizeText,
  parseFeed,
  rankAndSelect,
  sanitizeError,
  verifyFeeds,
  writeJsonAtomic
};
