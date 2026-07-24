"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ARTICLE_DATA_PATH = path.join(ROOT, "pages", "relay", "article-data.json");
const VIDEO_DATA_PATH = path.join(ROOT, "pages", "relay", "video-data.json");
const ARCHIVE_ROOT = path.join(ROOT, "pages", "relay", "archive");
const ARCHIVE_DATA_ROOT = path.join(ARCHIVE_ROOT, "data");

function getArchiveDate(now = new Date()) {
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utcDate.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatArchiveDateLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatArchiveMonthLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function canonicalizeArticleUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const params = new URLSearchParams(parsed.search);
    for (const [key] of Array.from(params.entries())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || ["ref", "fbclid", "gclid", "mc_cid", "mc_eid", "icid"].includes(lower)) {
        params.delete(key);
      }
    }
    const search = params.toString();
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname === "") pathname = "/";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${search ? `?${search}` : ""}`;
  } catch {
    return null;
  }
}

function getVideoKey(item) {
  const videoId = typeof item.video_id === "string" && item.video_id.trim() ? item.video_id.trim() : null;
  if (videoId) return `video:${videoId}`;
  try {
    const parsed = new URL(item.url || "");
    const videoQuery = parsed.searchParams.get("v");
    if (videoQuery) return `video:${videoQuery}`;
  } catch {
    // ignore
  }
  return null;
}

function buildArticleItem(item, firstSeenAt) {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const publisher = typeof item.publisher === "string" ? item.publisher.trim() : "";
  const sourceId = typeof item.source_id === "string" ? item.source_id.trim() : "";
  const canonicalUrl = canonicalizeArticleUrl(item.url);
  const publishedAt = item.published_at && new Date(item.published_at).toString() !== "Invalid Date"
    ? new Date(item.published_at).toISOString()
    : null;
  if (!title || !canonicalUrl || !publisher || !sourceId) return null;
  return {
    title,
    url: canonicalUrl,
    publisher,
    published_at: publishedAt,
    source_id: sourceId,
    first_seen_at: firstSeenAt,
    status: item.status || "ok"
  };
}

function buildVideoItem(item, firstSeenAt) {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const channelName = typeof item.channel_name === "string" ? item.channel_name.trim() : "";
  const url = typeof item.url === "string" ? item.url.trim() : "";
  const videoId = typeof item.video_id === "string" ? item.video_id.trim() : "";
  const publishedAt = item.published_at && new Date(item.published_at).toString() !== "Invalid Date"
    ? new Date(item.published_at).toISOString()
    : null;
  const channelId = typeof item.channel_id === "string" ? item.channel_id.trim() : "";
  if (!title || !url || !channelName) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.youtube.com" || parsed.pathname !== "/watch") return null;
  } catch {
    return null;
  }
  return {
    title,
    url,
    channel_name: channelName,
    channel_id: channelId,
    video_id: videoId,
    published_at: publishedAt,
    first_seen_at: firstSeenAt,
    status: item.status || "ok"
  };
}

function sortArchiveItems(items) {
  return [...items].sort((left, right) => {
    const leftTime = left.published_at ? Date.parse(left.published_at) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.published_at ? Date.parse(right.published_at) : Number.MAX_SAFE_INTEGER;
    const leftSort = Number.isFinite(leftTime) ? leftTime : 0;
    const rightSort = Number.isFinite(rightTime) ? rightTime : 0;
    if (rightSort !== leftSort) return rightSort - leftSort;
    const leftSeen = left.first_seen_at ? Date.parse(left.first_seen_at) : 0;
    const rightSeen = right.first_seen_at ? Date.parse(right.first_seen_at) : 0;
    return rightSeen - leftSeen;
  });
}

function parseArchiveData(data) {
  if (!data || typeof data !== "object") return { articles: [], videos: [] };
  return {
    articles: Array.isArray(data.articles) ? data.articles : [],
    videos: Array.isArray(data.videos) ? data.videos : []
  };
}

function mergeIntoArchive(existingArchive, incomingArticles, incomingVideos, firstSeenAt) {
  const articleMap = new Map();
  for (const item of existingArchive.articles || []) {
    articleMap.set(item.url, item);
  }
  for (const item of incomingArticles) {
    if (!item) continue;
    if (!articleMap.has(item.url)) {
      articleMap.set(item.url, { ...item, first_seen_at: item.first_seen_at || firstSeenAt });
    }
  }
  const videoMap = new Map();
  for (const item of existingArchive.videos || []) {
    const key = getVideoKey(item);
    if (key) videoMap.set(key, item);
  }
  for (const item of incomingVideos) {
    if (!item) continue;
    const key = getVideoKey(item);
    if (!key || videoMap.has(key)) continue;
    videoMap.set(key, { ...item, first_seen_at: item.first_seen_at || firstSeenAt });
  }
  const articles = sortArchiveItems(Array.from(articleMap.values()));
  const videos = sortArchiveItems(Array.from(videoMap.values()));
  return { articles, videos };
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function writeTextAtomic(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function buildArchiveIndexHtml(dailyArchives) {
  const sorted = [...dailyArchives].sort((left, right) => right.archive_date.localeCompare(left.archive_date));
  const groups = new Map();
  for (const entry of sorted) {
    const monthLabel = formatArchiveMonthLabel(entry.archive_date);
    if (!groups.has(monthLabel)) groups.set(monthLabel, []);
    groups.get(monthLabel).push(entry);
  }
  const sections = [];
  for (const [monthLabel, entries] of groups.entries()) {
    const items = entries.map((entry) => {
      const articleCount = Array.isArray(entry.articles) ? entry.articles.length : 0;
      const videoCount = Array.isArray(entry.videos) ? entry.videos.length : 0;
      const articleLabel = articleCount === 1 ? "1 article" : `${articleCount} articles`;
      const videoLabel = videoCount === 1 ? "1 video" : `${videoCount} videos`;
      return `<li><a href="/pages/relay/archive/${entry.archive_date}.html">${entry.archive_date}</a> <span>— ${articleLabel}, ${videoLabel}</span></li>`;
    }).join("");
    sections.push(`<section class="archive-month"><h2>${monthLabel}</h2><ul>${items}</ul></section>`);
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Relay Daily Archive Index | Notavello</title>
<meta name="description" content="Browse the daily Relay archive by UTC date."/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="https://notavello.com/pages/relay/archive/"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="Relay Daily Archive Index | Notavello"/>
<meta property="og:description" content="Browse the daily Relay archive by UTC date."/>
<meta property="og:url" content="https://notavello.com/pages/relay/archive/"/>
<meta property="og:site_name" content="Notavello"/>
<meta property="twitter:card" content="summary_large_image"/>
<meta property="twitter:title" content="Relay Daily Archive Index | Notavello"/>
<meta property="twitter:description" content="Browse the daily Relay archive by UTC date."/>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg: #F0F4FF; --surface: #FFFFFF; --ink: #0F172A; --ink-muted: #64748B; --ink-faint: #94A3B8; --accent: #4F46E5; --border: #E2E8F0; --font-system: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
body { font-family: var(--font-system); background: var(--bg); color: var(--ink); line-height: 1.5; }
.main { max-width: 960px; margin: 0 auto; padding: 40px 20px 72px; }
.relay-header { border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 24px; }
.relay-title { color: var(--accent); font-size: clamp(1.8rem, 4vw, 2.4rem); font-weight: 700; line-height: 1.1; margin-bottom: 8px; }
.relay-intro { color: var(--ink-muted); font-size: 0.95rem; }
.archive-month { border: 1px solid var(--border); background: var(--surface); border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; }
.archive-month h2 { font-size: 1rem; margin-bottom: 10px; }
.archive-month ul { list-style: none; display: grid; gap: 8px; }
.archive-month a { color: var(--ink); font-weight: 600; text-decoration: none; }
.archive-month a:hover { color: var(--accent); text-decoration: underline; }
.archive-month span { color: var(--ink-muted); font-size: 0.9rem; }
@media (max-width: 640px) { .main { padding: 24px 16px 56px; } }
</style>
</head>
<body>
<main class="main">
  <header class="relay-header">
    <h1 class="relay-title">Relay Daily Archive</h1>
    <p class="relay-intro">Browse the daily Relay archive by UTC date.</p>
  </header>
  ${sections.join("")}
  <p class="relay-intro" style="margin-top: 20px;"><a href="/pages/relay/" style="color: var(--accent); text-decoration: none;">Back to current Relay</a></p>
</main>
</body>
</html>
`;
}

function renderDailyArchiveHtml(archiveDate, archiveData, { currentRelayUrl = "/pages/relay/", archiveIndexUrl = "/pages/relay/archive/" } = {}) {
  const articleItems = (archiveData.articles || []).map((item) => {
    const title = escapeHtml(item.title);
    const publisher = escapeHtml(item.publisher);
    const time = item.published_at ? `<time datetime="${item.published_at}">${new Date(item.published_at).toUTCString()}</time>` : "";
    return `<li class="item-card"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${title}</a><div class="meta">${publisher}${time ? ` · ${time}` : ""}</div></li>`;
  }).join("");
  const videoItems = (archiveData.videos || []).map((item) => {
    const title = escapeHtml(item.title);
    const channel = escapeHtml(item.channel_name || "Unknown channel");
    const time = item.published_at ? `<time datetime="${item.published_at}">${new Date(item.published_at).toUTCString()}</time>` : "";
    return `<li class="item-card"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${title}</a><div class="meta">${channel}${time ? ` · ${time}` : ""}</div></li>`;
  }).join("");
  const label = formatArchiveDateLabel(archiveDate);
  const description = `Selected Relay articles and videos preserved for UTC ${archiveDate} (${archiveData.articles?.length || 0} articles, ${archiveData.videos?.length || 0} videos).`;
  const updatedAt = archiveData.updated_at || archiveData.created_at || `${archiveDate}T00:00:00.000Z`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Relay Daily Archive — ${label}</title>
<meta name="description" content="${escapeHtml(description)}"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="https://notavello.com/pages/relay/archive/${archiveDate}.html"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="Relay Daily Archive — ${label}"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
<meta property="og:url" content="https://notavello.com/pages/relay/archive/${archiveDate}.html"/>
<meta property="og:site_name" content="Notavello"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="Relay Daily Archive — ${label}"/>
<meta name="twitter:description" content="${escapeHtml(description)}"/>
<meta name="datePublished" content="${escapeHtml(archiveData.created_at || updatedAt)}"/>
<meta name="dateModified" content="${escapeHtml(updatedAt)}"/>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg: #F0F4FF; --surface: #FFFFFF; --ink: #0F172A; --ink-muted: #64748B; --ink-faint: #94A3B8; --accent: #4F46E5; --border: #E2E8F0; --font-system: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; --font-rounded: ui-rounded, "SF Pro Rounded", sans-serif; }
body { font-family: var(--font-system); background: var(--bg); color: var(--ink); line-height: 1.5; }
.main { max-width: 960px; margin: 0 auto; padding: 40px 20px 72px; }
.relay-header { border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 24px; }
.relay-title { color: var(--accent); font-family: var(--font-rounded); font-size: clamp(1.8rem, 4vw, 2.4rem); font-weight: 700; line-height: 1.1; margin-bottom: 8px; }
.relay-intro { color: var(--ink-muted); font-size: 0.95rem; }
.section { border: 1px solid var(--border); background: var(--surface); border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; }
.section-title { font-size: 1rem; font-weight: 700; margin-bottom: 12px; }
.item-list { list-style: none; display: grid; gap: 10px; }
.item-card { border-bottom: 1px solid var(--border); padding-bottom: 10px; }
.item-card:last-child { border-bottom: 0; padding-bottom: 0; }
.item-card a { color: var(--ink); font-weight: 600; text-decoration: none; }
.item-card a:hover { color: var(--accent); text-decoration: underline; }
.meta { color: var(--ink-muted); font-size: 0.8rem; margin-top: 4px; overflow-wrap: anywhere; }
@media (max-width: 640px) { .main { padding: 24px 16px 56px; } }
</style>
</head>
<body>
<main class="main">
  <header class="relay-header">
    <h1 class="relay-title">Relay</h1>
    <p class="relay-intro">This page preserves the links selected by Relay for UTC ${archiveDate}. It is a static daily snapshot for reference and discovery.</p>
    <p class="relay-intro" style="margin-top: 8px;">UTC archive date: <strong>${archiveDate}</strong></p>
  </header>
  <p class="relay-intro" style="margin-bottom: 18px;"><a href="${currentRelayUrl}" style="color: var(--accent); text-decoration: none;">Current Relay</a> · <a href="${archiveIndexUrl}" style="color: var(--accent); text-decoration: none;">Archive index</a></p>
  <section class="section" aria-labelledby="articles-title">
    <h2 class="section-title" id="articles-title">Articles</h2>
    <ul class="item-list">${articleItems || '<li class="item-card"><div class="meta">No articles archived for this UTC day.</div></li>'}</ul>
  </section>
  <section class="section" aria-labelledby="videos-title">
    <h2 class="section-title" id="videos-title">Videos</h2>
    <ul class="item-list">${videoItems || '<li class="item-card"><div class="meta">No videos archived for this UTC day.</div></li>'}</ul>
  </section>
</main>
</body>
</html>
`;
}

async function ensureArchivePaths(rootDir = ROOT) {
  const archiveRoot = path.join(rootDir, "pages", "relay", "archive");
  const dataRoot = path.join(archiveRoot, "data");
  await fs.mkdir(dataRoot, { recursive: true });
  return { archiveRoot, dataRoot };
}

async function getDailyArchiveFiles(rootDir = ROOT) {
  const dataRoot = path.join(rootDir, "pages", "relay", "archive", "data");
  try {
    const entries = await fs.readdir(dataRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function updateRelayArchive({ rootDir = ROOT, now = new Date() } = {}) {
  const archiveDate = getArchiveDate(now);
  const articlePath = path.join(rootDir, "pages", "relay", "article-data.json");
  const videoPath = path.join(rootDir, "pages", "relay", "video-data.json");
  const archiveJsonPath = path.join(rootDir, "pages", "relay", "archive", "data", `${archiveDate}.json`);
  const archiveHtmlPath = path.join(rootDir, "pages", "relay", "archive", `${archiveDate}.html`);
  const archiveIndexPath = path.join(rootDir, "pages", "relay", "archive", "index.html");
  const relayIndexPath = path.join(rootDir, "pages", "relay", "index.html");
  const { archiveRoot, dataRoot } = await ensureArchivePaths(rootDir);
  const articleData = await readJson(articlePath, { items: [] });
  const videoData = await readJson(videoPath, { items: [] });

  const currentArchiveData = await readJson(archiveJsonPath, null);
  const existingArchive = currentArchiveData || { archive_date: archiveDate, articles: [], videos: [], created_at: null, updated_at: null };
  const firstSeenAt = existingArchive.created_at || now.toISOString();
  const incomingArticles = (Array.isArray(articleData.items) ? articleData.items : [])
    .map((item) => buildArticleItem(item, firstSeenAt))
    .filter(Boolean);
  const incomingVideos = (Array.isArray(videoData.items) ? videoData.items : [])
    .map((item) => buildVideoItem(item, firstSeenAt))
    .filter(Boolean);

  const merged = mergeIntoArchive(existingArchive, incomingArticles, incomingVideos, firstSeenAt);
  const archivePayload = {
    schema_version: 1,
    archive_date: archiveDate,
    created_at: existingArchive.created_at || now.toISOString(),
    updated_at: existingArchive.created_at && JSON.stringify(existingArchive) === JSON.stringify({ archive_date: archiveDate, articles: merged.articles, videos: merged.videos, created_at: existingArchive.created_at, updated_at: existingArchive.updated_at })
      ? existingArchive.updated_at || existingArchive.created_at
      : now.toISOString(),
    articles: merged.articles,
    videos: merged.videos
  };

  if (currentArchiveData === null || archivePayload.updated_at === now.toISOString()) {
    await writeJsonAtomic(archiveJsonPath, archivePayload);
  }

  const dailyHtml = renderDailyArchiveHtml(archiveDate, archivePayload, { currentRelayUrl: "/pages/relay/", archiveIndexUrl: "/pages/relay/archive/" });
  await writeTextAtomic(archiveHtmlPath, dailyHtml);

  const dailyFiles = await getDailyArchiveFiles(rootDir);
  const archiveEntries = [];
  for (const fileName of dailyFiles) {
    const date = path.basename(fileName, ".json");
    const jsonPath = path.join(dataRoot, fileName);
    const data = await readJson(jsonPath, { articles: [], videos: [] });
    archiveEntries.push({ archive_date: date, articles: data.articles || [], videos: data.videos || [] });
  }
  const indexHtml = buildArchiveIndexHtml(archiveEntries);
  await writeTextAtomic(archiveIndexPath, indexHtml);

  if (archiveRoot) {
    const relayHtml = await fs.readFile(relayIndexPath, "utf8").catch(() => "<html><body><h1>Relay</h1></body></html>");
    const archiveLinkHtml = '<p class="relay-intro"><a href="/pages/relay/archive/" style="color: var(--accent); text-decoration: none;">Daily archive</a></p>';
    const archiveLinkPattern = /<p class="relay-intro"><a href="\/pages\/relay\/archive\/"[^>]*>Daily archive<\/a><\/p>/g;
    let updatedRelayHtml = relayHtml.replace(archiveLinkPattern, "").replace(/\n{3,}/g, "\n\n");
    if (updatedRelayHtml.includes("</header>")) {
      updatedRelayHtml = updatedRelayHtml.replace("</header>", `</header>\n    ${archiveLinkHtml}`);
    } else if (updatedRelayHtml.includes("</body>")) {
      updatedRelayHtml = updatedRelayHtml.replace("</body>", `  ${archiveLinkHtml}\n</body>`);
    } else {
      updatedRelayHtml = `${updatedRelayHtml}\n${archiveLinkHtml}`;
    }
    await fs.writeFile(relayIndexPath, updatedRelayHtml, "utf8");
  }

  return { archiveDate, archiveData: archivePayload, archivePath: archiveJsonPath, htmlPath: archiveHtmlPath, indexPath: archiveIndexPath };
}

if (require.main === module) {
  updateRelayArchive().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildArchiveIndexHtml,
  getArchiveDate,
  renderDailyArchiveHtml,
  updateRelayArchive
};
