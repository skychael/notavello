"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { updateRelayArchive, getArchiveDate, buildArchiveIndexHtml, renderDailyArchiveHtml } = require("./update-relay-archive");

async function makeTempRoot() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-archive-"));
  await fs.mkdir(path.join(rootDir, "pages", "relay", "archive", "data"), { recursive: true });
  return rootDir;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("1. UTC date calculation uses the UTC calendar day", () => {
  const date = new Date("2026-07-24T23:30:00.000-04:00");
  assert.equal(getArchiveDate(date), "2026-07-25");
});

test("2. first run creates today's JSON file", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), {
    status: "ok",
    items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }]
  });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), {
    status: "ok",
    items: [{ video_id: "abc12345678", title: "V", url: "https://www.youtube.com/watch?v=abc12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T02:00:00.000Z", status: "ok" }]
  });

  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T23:30:00.000Z") });
  assert.equal(result.archiveDate, "2026-07-24");
  const archivePath = path.join(rootDir, "pages", "relay", "archive", "data", "2026-07-24.json");
  const archive = await readJson(archivePath);
  assert.equal(archive.articles.length, 1);
  assert.equal(archive.videos.length, 1);
  assert.equal(archive.created_at, archive.updated_at);
});

test("3. first run creates today's static HTML file", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });

  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T23:30:00.000Z") });
  const htmlPath = path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html");
  const html = await fs.readFile(htmlPath, "utf8");
  assert.match(html, /Relay Daily Archive/);
  assert.match(html, /archive\/2026-07-24.html/);
});

test("4. later same-day run merges new Articles", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T00:00:00.000Z") });

  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "B", url: "https://example.com/b", publisher: "Pub", published_at: "2026-07-24T02:00:00.000Z", source_id: "src", status: "ok" }] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T02:00:00.000Z") });
  assert.equal(result.archiveData.articles.length, 2);
  assert.equal(result.archiveData.articles[0].title, "B");
});

test("5. later same-day run merges new Videos", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc12345678", title: "V1", url: "https://www.youtube.com/watch?v=abc12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });

  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "def12345678", title: "V2", url: "https://www.youtube.com/watch?v=def12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T02:00:00.000Z", status: "ok" }] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T02:00:00.000Z") });
  assert.equal(result.archiveData.videos.length, 2);
  assert.equal(result.archiveData.videos[0].title, "V2");
});

test("6. duplicate Article URLs are not added", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a?utm=1", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T02:00:00.000Z") });
  assert.equal(result.archiveData.articles.length, 1);
});

test("7. duplicate YouTube videos are not added", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc12345678", title: "V1", url: "https://www.youtube.com/watch?v=abc12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T02:00:00.000Z") });
  assert.equal(result.archiveData.videos.length, 1);
});

test("8. tracking query parameters do not create Article duplicates when canonicalized", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a?utm_source=x", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  assert.equal(result.archiveData.articles[0].url, "https://example.com/a");
});

test("9. an item removed from the front page remains in today's archive", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T02:00:00.000Z") });
  assert.equal(result.archiveData.articles.length, 1);
});

test("10. first_seen_at remains unchanged", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  const first = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const second = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T02:00:00.000Z") });
  assert.equal(second.archiveData.articles[0].first_seen_at, first.archiveData.articles[0].first_seen_at);
});

test("11. created_at remains unchanged", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  const first = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const second = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T02:30:00.000Z") });
  assert.equal(second.archiveData.created_at, first.archiveData.created_at);
});

test("12. previous UTC day JSON is never modified", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T20:00:00.000Z") });
  const previousPath = path.join(rootDir, "pages", "relay", "archive", "data", "2026-07-23.json");
  await writeJson(previousPath, { archive_date: "2026-07-23", articles: [], videos: [], created_at: "2026-07-23T00:00:00.000Z", updated_at: "2026-07-23T00:00:00.000Z" });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T20:00:00.000Z") });
  const current = await readJson(previousPath);
  assert.equal(current.updated_at, "2026-07-23T00:00:00.000Z");
});

test("13. previous UTC day HTML is never modified", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T20:00:00.000Z") });
  const previousHtmlPath = path.join(rootDir, "pages", "relay", "archive", "2026-07-23.html");
  await fs.writeFile(previousHtmlPath, "<html>old</html>", "utf8");
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T20:00:00.000Z") });
  assert.equal(await fs.readFile(previousHtmlPath, "utf8"), "<html>old</html>");
});

test("14. malformed Article JSON is skipped safely", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "not-a-url", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  assert.equal(result.archiveData.articles.length, 0);
});

test("15. malformed Video JSON is skipped safely", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc", title: "V", url: "https://example.com", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  assert.equal(result.archiveData.videos.length, 0);
});

test("16. Article success still archives when Video data fails", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc", title: "V", url: "https://example.com", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  assert.equal(result.archiveData.articles.length, 1);
  assert.equal(result.archiveData.videos.length, 0);
});

test("17. Video success still archives when Article data fails", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "not-a-url", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc12345678", title: "V", url: "https://www.youtube.com/watch?v=abc12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  assert.equal(result.archiveData.videos.length, 1);
  assert.equal(result.archiveData.articles.length, 0);
});

test("18. malformed individual items are rejected", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc12345678", title: "V", url: "https://www.youtube.com/watch?v=abc12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  assert.equal(result.archiveData.articles.length, 0);
  assert.equal(result.archiveData.videos.length, 1);
});

test("19. HTML escaping prevents title or publisher markup injection", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "<script>alert(1)</script>", url: "https://example.com/a", publisher: "</a><b>Pub</b>", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html"), "utf8");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;\/a&gt;&lt;b&gt;Pub&lt;\/b&gt;/);
});

test("20. daily HTML contains static Article links", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html"), "utf8");
  assert.match(html, /https:\/\/example\.com\/a/);
});

test("21. daily HTML contains static Video links", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc12345678", title: "V", url: "https://www.youtube.com/watch?v=abc12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html"), "utf8");
  assert.match(html, /https:\/\/www\.youtube\.com\/watch\?v=abc12345678/);
});

test("22. daily HTML does not depend on JavaScript", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html"), "utf8");
  assert.equal(html.includes("<script"), false);
});

test("23. daily canonical metadata is correct", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/notavello\.com\/pages\/relay\/archive\/2026-07-24\.html"/);
});

test("24. datePublished and dateModified metadata are correct", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  const result = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html"), "utf8");
  assert.match(html, /<meta name="datePublished" content="2026-07-24T01:00:00\.000Z"/);
  assert.match(html, /<meta name="dateModified" content="2026-07-24T01:00:00\.000Z"/);
  assert.equal(result.archiveData.updated_at, result.archiveData.created_at);
});

test("25. archive index is newest first", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-25T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "index.html"), "utf8");
  const firstIndex = html.indexOf("2026-07-25");
  const secondIndex = html.indexOf("2026-07-24");
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex);
});

test("26. archive index groups dates by month and year", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  await updateRelayArchive({ rootDir, now: new Date("2026-08-01T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "index.html"), "utf8");
  assert.match(html, /August 2026/);
  assert.match(html, /July 2026/);
});

test("27. archive index displays correct Article and Video counts", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [{ video_id: "abc12345678", title: "V", url: "https://www.youtube.com/watch?v=abc12345678", channel_name: "Channel", channel_id: "UC12345678901234567890", published_at: "2026-07-24T01:00:00.000Z", status: "ok" }] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "index.html"), "utf8");
  assert.match(html, /1 article/);
  assert.match(html, /1 video/);
});

test("28. current Relay links to the archive index", async () => {
  const rootDir = await makeTempRoot();
  const relayPagePath = path.join(rootDir, "pages", "relay", "index.html");
  await fs.mkdir(path.dirname(relayPagePath), { recursive: true });
  await fs.writeFile(relayPagePath, "<html><body><h1>Relay</h1></body></html>", "utf8");
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(relayPagePath, "utf8");
  assert.match(html, /Daily archive/);
  assert.match(html, /\/pages\/relay\/archive\//);
});

test("29. workflow runs the archive generator", async () => {
  const workflow = await fs.readFile(path.join(__dirname, "..", ".github", "workflows", "update-relay-articles.yml"), "utf8");
  assert.match(workflow, /node relay-automation\/update-relay-archive\.js/);
});

test("30. workflow runs the archive tests", async () => {
  const workflow = await fs.readFile(path.join(__dirname, "..", ".github", "workflows", "update-relay-articles.yml"), "utf8");
  assert.match(workflow, /update-relay-archive\.test\.js/);
});

test("31. workflow stages only intended paths", async () => {
  const workflow = await fs.readFile(path.join(__dirname, "..", ".github", "workflows", "update-relay-articles.yml"), "utf8");
  assert.match(
    workflow,
    /git add -- pages\/relay\/article-data\.json pages\/relay\/weather-data\.json pages\/relay\/archive\/ sitemap\.xml/
  );
});

test("32. unchanged repeated runs are idempotent", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [{ title: "A", url: "https://example.com/a", publisher: "Pub", published_at: "2026-07-24T01:00:00.000Z", source_id: "src", status: "ok" }] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  const first = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const second = await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  assert.equal(second.archiveData.updated_at, first.archiveData.updated_at);
});

test("33. generated CSS contains no fixed-width mobile overflow", async () => {
  const rootDir = await makeTempRoot();
  await writeJson(path.join(rootDir, "pages", "relay", "article-data.json"), { status: "ok", items: [] });
  await writeJson(path.join(rootDir, "pages", "relay", "video-data.json"), { status: "ok", items: [] });
  await updateRelayArchive({ rootDir, now: new Date("2026-07-24T01:00:00.000Z") });
  const html = await fs.readFile(path.join(rootDir, "pages", "relay", "archive", "2026-07-24.html"), "utf8");
  assert.doesNotMatch(html, /width:\s*320px/i);
  assert.doesNotMatch(html, /min-width:\s*320px/i);
});
