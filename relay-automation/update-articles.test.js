"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildArticleData,
  canonicalizeUrl,
  deriveApprovedHostnames,
  evaluateArticleCandidate,
  getFeedUrls,
  isApprovedLink,
  isHardExcluded,
  isSourceSpecificReject,
  parseFeed,
  rankAndSelect,
  verifyFeeds,
  writeJsonAtomic
} = require("./update-articles");

const config = require("./config/sources.json");
const exclusions = require("./config/exclusions.json");

const NOW = new Date("2026-07-24T18:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - 72 * 60 * 60 * 1000);
const DATA_PATH = path.join(__dirname, "..", "pages", "relay", "article-data.json");

// --- Fixture builders --------------------------------------------------------

function rssItem({ title, link, guid, pubDate, category = "", description = "" }) {
  return `<item>
<title><![CDATA[${title}]]></title>
<link>${link}</link>
<guid>${guid || link}</guid>
<pubDate>${pubDate}</pubDate>
${category ? `<category>${category}</category>` : ""}
<description><![CDATA[${description}]]></description>
</item>`;
}

function rssFeed(items) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title>${items.join("\n")}</channel></rss>`;
}

function atomEntry({ title, link, id, published, summary = "" }) {
  return `<entry>
<title>${title}</title>
<link rel="alternate" href="${link}"/>
<id>${id || link}</id>
<published>${published}</published>
<summary><![CDATA[${summary}]]></summary>
</entry>`;
}

function atomFeed(entries) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Test Atom</title>${entries.join("\n")}</feed>`;
}

function makeSource(overrides = {}) {
  return {
    id: "test-source",
    publisher_name: "Test Publisher",
    feed_url: "https://example-publisher.test/feed/",
    homepage_url: "https://example-publisher.test/",
    enabled: true,
    priority: 8,
    ...overrides
  };
}

function mockFetchImplFor(bodiesByUrl) {
  return async (url) => {
    const entry = bodiesByUrl[url];
    if (!entry) throw new Error(`Unexpected URL in test mock: ${url}`);
    if (entry.httpStatus && entry.httpStatus !== 200) {
      return { ok: false, status: entry.httpStatus, text: async () => "" };
    }
    return { ok: true, status: 200, text: async () => entry.body };
  };
}

function pubDateHoursAgo(hours) {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toUTCString();
}

// --- Config sanity -----------------------------------------------------------

test("config: six automatic sources and three manual-only sources with required fields", () => {
  assert.equal(config.automatic_sources.length, 6);
  assert.equal(config.manual_only_sources.length, 3);
  for (const source of config.automatic_sources) {
    assert.ok(source.id);
    assert.ok(source.publisher_name);
    assert.ok(source.feed_url || (source.feed_urls && source.feed_urls.length > 0));
    assert.ok(source.homepage_url);
    assert.ok(source.priority >= 1 && source.priority <= 10);
    assert.ok(source.content_focus);
    assert.ok(source.exclusion_notes);
    assert.ok(source.verification_status);
  }
  for (const source of config.manual_only_sources) {
    assert.ok(source.id);
    assert.ok(source.publisher_name);
    assert.ok(source.homepage_url);
    assert.equal(source.enabled, false);
    assert.equal(source.mode, "manual-only");
  }
  assert.equal(config.maximum_items, 10);
  assert.equal(config.maximum_items_per_source, 2);
  assert.equal(config.lookback_hours, 72);
});

// --- 1. RSS parsing -----------------------------------------------------------

test("1. parses RSS 2.0 feeds, including CDATA titles and entity-decoded descriptions", () => {
  const xml = rssFeed([
    rssItem({
      title: "FDA Recalls Lettuce Over Listeria Contamination",
      link: "https://example-publisher.test/a",
      pubDate: pubDateHoursAgo(1),
      description: "Testing found &amp; confirmed listeria."
    })
  ]);
  const { format, entries } = parseFeed(xml);
  assert.equal(format, "rss");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "FDA Recalls Lettuce Over Listeria Contamination");
  assert.equal(entries[0].link, "https://example-publisher.test/a");
  assert.equal(entries[0].summary, "Testing found & confirmed listeria.");
});

// --- 2. Atom parsing ------------------------------------------------------------

test("2. parses Atom feeds, including rel=alternate link selection", () => {
  const xml = atomFeed([
    atomEntry({
      title: "Major Earthquake Strikes Region",
      link: "https://example-publisher.test/b",
      published: NOW.toISOString(),
      summary: "A significant earthquake was recorded."
    })
  ]);
  const { format, entries } = parseFeed(xml);
  assert.equal(format, "atom");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Major Earthquake Strikes Region");
  assert.equal(entries[0].link, "https://example-publisher.test/b");
});

// --- 3. multiple feed URLs for one publisher -----------------------------------

test("3. supports multiple feed URLs for a single publisher and merges results", async () => {
  const source = makeSource({
    id: "multi-feed-pub",
    feed_url: undefined,
    feed_urls: ["https://example-publisher.test/feed-a/", "https://example-publisher.test/feed-b/"]
  });
  const feedA = rssFeed([rssItem({ title: "Grid Outage Hits Region A", link: "https://example-publisher.test/a", pubDate: pubDateHoursAgo(2) })]);
  const feedB = rssFeed([rssItem({ title: "Grid Outage Hits Region B", link: "https://example-publisher.test/b", pubDate: pubDateHoursAgo(3) })]);
  const testConfig = { ...config, automatic_sources: [source], maximum_items: 10, maximum_items_per_source: 2, lookback_hours: 72 };
  const fetchImpl = mockFetchImplFor({
    "https://example-publisher.test/feed-a/": { body: feedA },
    "https://example-publisher.test/feed-b/": { body: feedB }
  });

  const data = await buildArticleData({ config: testConfig, exclusions, previousData: { items: [] }, fetchImpl, now: NOW });
  assert.equal(data.items.length, 2);
  assert.equal(getFeedUrls(source).length, 2);
});

// --- 4. individual source failure -----------------------------------------------

test("4. an individual source failure does not throw and yields zero candidates from that source", async () => {
  const goodSource = makeSource({ id: "good-source", feed_url: "https://good.test/feed/", homepage_url: "https://good.test/" });
  const badSource = makeSource({ id: "bad-source", feed_url: "https://bad.test/feed/" });
  const goodFeed = rssFeed([rssItem({ title: "Ransomware Disrupts Regional Utility", link: "https://good.test/a", pubDate: pubDateHoursAgo(1) })]);
  const testConfig = { ...config, automatic_sources: [goodSource, badSource], maximum_items: 10, maximum_items_per_source: 2, lookback_hours: 72 };
  const fetchImpl = async (url) => {
    if (url === "https://good.test/feed/") return { ok: true, status: 200, text: async () => goodFeed };
    throw new Error("network failure");
  };

  const data = await buildArticleData({ config: testConfig, exclusions, previousData: { items: [] }, fetchImpl, now: NOW });
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].source_id, "good-source");
});

// --- 5. partial-source success ---------------------------------------------------

test("5. status is partial when some sources fail but others succeed with items", async () => {
  const goodSource = makeSource({ id: "good-source", feed_url: "https://good.test/feed/", homepage_url: "https://good.test/" });
  const badSource = makeSource({ id: "bad-source", feed_url: "https://bad.test/feed/" });
  const goodFeed = rssFeed([rssItem({ title: "Ransomware Disrupts Regional Utility", link: "https://good.test/a", pubDate: pubDateHoursAgo(1) })]);
  const testConfig = { ...config, automatic_sources: [goodSource, badSource], maximum_items: 10, maximum_items_per_source: 2, lookback_hours: 72 };
  const fetchImpl = async (url) => {
    if (url === "https://good.test/feed/") return { ok: true, status: 200, text: async () => goodFeed };
    throw new Error("network failure");
  };

  const data = await buildArticleData({ config: testConfig, exclusions, previousData: { items: [] }, fetchImpl, now: NOW });
  assert.equal(data.status, "partial");
});

// --- 6. all-sources-failed last-known-good preservation --------------------------

test("6. preserves previous items and latest_success_at when every source fails", async () => {
  const badSource = makeSource({ id: "bad-source", feed_url: "https://bad.test/feed/" });
  const testConfig = { ...config, automatic_sources: [badSource], maximum_items: 10, maximum_items_per_source: 2, lookback_hours: 72 };
  const fetchImpl = async () => { throw new Error("network failure"); };
  const previousData = {
    items: [{ title: "Old Story", url: "https://good.test/old", publisher: "Old Pub", published_at: "2026-07-20T00:00:00.000Z", source_id: "good-source", status: "ok" }],
    latest_success_at: "2026-07-20T00:00:00.000Z"
  };

  const data = await buildArticleData({ config: testConfig, exclusions, previousData, fetchImpl, now: NOW });
  assert.equal(data.status, "stale");
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].title, "Old Story");
  assert.equal(data.items[0].status, "stale");
  assert.equal(data.latest_success_at, "2026-07-20T00:00:00.000Z");
  assert.equal(data.checked_at, NOW.toISOString());
});

test("6b. all-sources-failed with no previous data yields unavailable and empty items", async () => {
  const badSource = makeSource({ id: "bad-source", feed_url: "https://bad.test/feed/" });
  const testConfig = { ...config, automatic_sources: [badSource], maximum_items: 10, maximum_items_per_source: 2, lookback_hours: 72 };
  const fetchImpl = async () => { throw new Error("network failure"); };

  const data = await buildArticleData({ config: testConfig, exclusions, previousData: { items: [] }, fetchImpl, now: NOW });
  assert.equal(data.status, "unavailable");
  assert.deepEqual(data.items, []);
});

// --- 7. successful empty selection ------------------------------------------------

test("7. successful empty selection: sources succeed but nothing suitable is found", async () => {
  const source = makeSource({ id: "quiet-source", feed_url: "https://quiet.test/feed/" });
  const feed = rssFeed([rssItem({ title: "Weekly Newsletter Roundup", link: "https://quiet.test/a", pubDate: pubDateHoursAgo(1) })]);
  const testConfig = { ...config, automatic_sources: [source], maximum_items: 10, maximum_items_per_source: 2, lookback_hours: 72 };
  const fetchImpl = mockFetchImplFor({ "https://quiet.test/feed/": { body: feed } });

  const data = await buildArticleData({ config: testConfig, exclusions, previousData: { items: [] }, fetchImpl, now: NOW });
  assert.equal(data.status, "ok_empty");
  assert.deepEqual(data.items, []);
});

// --- 8. malformed URL rejection ---------------------------------------------------

test("8. rejects a malformed article link", () => {
  const source = makeSource();
  const approved = deriveApprovedHostnames(source.homepage_url);
  const entry = { title: "Real Event Headline", link: "not a url", published: NOW.toISOString() };
  const evaluation = evaluateArticleCandidate(entry, source, exclusions, approved, CUTOFF, NOW);
  assert.equal(evaluation.status, "malformed");
});

test("8b. rejects a link pointing to an unapproved hostname", () => {
  const source = makeSource();
  const approved = deriveApprovedHostnames(source.homepage_url);
  const entry = { title: "Real Event Headline", link: "https://not-the-publisher.test/story", published: NOW.toISOString() };
  const evaluation = evaluateArticleCandidate(entry, source, exclusions, approved, CUTOFF, NOW);
  assert.equal(evaluation.status, "malformed");
});

// --- 9. non-HTTPS rejection --------------------------------------------------------

test("9. rejects a non-HTTPS article link", () => {
  const source = makeSource();
  const approved = deriveApprovedHostnames(source.homepage_url);
  const entry = { title: "Real Event Headline", link: "http://example-publisher.test/a", published: NOW.toISOString() };
  const evaluation = evaluateArticleCandidate(entry, source, exclusions, approved, CUTOFF, NOW);
  assert.equal(evaluation.status, "non_https");
});

// --- 10. duplicate removal ----------------------------------------------------------

test("10. removes duplicate canonical URLs (tracking parameters ignored)", async () => {
  const source = makeSource({ id: "dupe-source", feed_url: "https://dupe.test/feed/" });
  const feed = rssFeed([
    rssItem({ title: "Grid Emergency Declared", link: "https://example-publisher.test/story?utm_source=rss", pubDate: pubDateHoursAgo(1) }),
    rssItem({ title: "Grid Emergency Declared (duplicate)", link: "https://example-publisher.test/story?utm_source=twitter", pubDate: pubDateHoursAgo(1) })
  ]);
  const testConfig = { ...config, automatic_sources: [source], maximum_items: 10, maximum_items_per_source: 2, lookback_hours: 72 };
  const fetchImpl = mockFetchImplFor({ "https://dupe.test/feed/": { body: feed } });

  const data = await buildArticleData({ config: testConfig, exclusions, previousData: { items: [] }, fetchImpl, now: NOW });
  assert.equal(data.items.length, 1);
});

test("10b. canonicalizeUrl strips tracking parameters and trailing slashes", () => {
  assert.equal(
    canonicalizeUrl("https://Example-Publisher.test/story/?utm_source=rss&utm_medium=feed&ref=abc"),
    "https://example-publisher.test/story"
  );
});

// --- 11. lookback rejection ----------------------------------------------------------

test("11. rejects an article published outside the lookback window", () => {
  const source = makeSource();
  const approved = deriveApprovedHostnames(source.homepage_url);
  const entry = { title: "Old Story", link: "https://example-publisher.test/old", published: pubDateHoursAgo(200) };
  const evaluation = evaluateArticleCandidate(entry, source, exclusions, approved, CUTOFF, NOW);
  assert.equal(evaluation.status, "outside_lookback");
});

// --- 12. hard exclusions ---------------------------------------------------------------

test("12. applies existing Relay hard exclusions (e.g. UFO claims)", () => {
  const source = makeSource();
  const approved = deriveApprovedHostnames(source.homepage_url);
  const entry = { title: "UFO Sighting Sparks Alien Theories", link: "https://example-publisher.test/ufo", published: NOW.toISOString() };
  const evaluation = evaluateArticleCandidate(entry, source, exclusions, approved, CUTOFF, NOW);
  assert.equal(evaluation.status, "excluded");
});

// --- 13-18: source-specific unsuitable content ------------------------------------------

function unsuitableTitleCheck(title, description = "") {
  const source = makeSource();
  const approved = deriveApprovedHostnames(source.homepage_url);
  const entry = { title, link: "https://example-publisher.test/x", published: NOW.toISOString(), summary: description };
  return evaluateArticleCandidate(entry, source, exclusions, approved, CUTOFF, NOW);
}

test("13. rejects opinion pieces", () => {
  assert.equal(unsuitableTitleCheck("Opinion: Why the Industry Must Change").status, "unsuitable_content");
});

test("14. rejects podcast posts", () => {
  assert.equal(unsuitableTitleCheck("Podcast: Talking Cyber Trends This Week").status, "unsuitable_content");
});

test("15. rejects newsletter roundups", () => {
  assert.equal(unsuitableTitleCheck("This Week's Newsletter Roundup").status, "unsuitable_content");
});

test("16. rejects sponsored content", () => {
  assert.equal(unsuitableTitleCheck("Sponsored Content: A Look at New Tools").status, "unsuitable_content");
});

test("17. rejects webinar and event-promotion posts", () => {
  assert.equal(unsuitableTitleCheck("Join Our Free Webinar on Threat Trends").status, "unsuitable_content");
  assert.equal(unsuitableTitleCheck("Register Now For Our Annual Conference Registration").status, "unsuitable_content");
});

test("18. rejects evergreen explainers", () => {
  assert.equal(unsuitableTitleCheck("Explainer: How Ransomware Works").status, "unsuitable_content");
});

test("18b. rejects the exact real Relay article titles requested for editorial filtering", () => {
  const source = makeSource({ id: "food-safety-news", publisher_name: "Food Safety News", feed_url: "https://www.foodsafetynews.com/feed/", homepage_url: "https://www.foodsafetynews.com/" });
  const approved = deriveApprovedHostnames(source.homepage_url);
  const foodSafetyEntry = { title: "Visit FSN at IAFP in New Orleans", link: "https://www.foodsafetynews.com/2026/07/visit-fsn-at-iafp-in-new-orleans", published: NOW.toISOString() };
  assert.equal(evaluateArticleCandidate(foodSafetyEntry, source, exclusions, approved, CUTOFF, NOW).status, "unsuitable_content");

  const statSource = makeSource({ id: "stat", publisher_name: "STAT", feed_url: "https://www.statnews.com/feed/", homepage_url: "https://www.statnews.com/" });
  const statApproved = deriveApprovedHostnames(statSource.homepage_url);
  const statEntry = { title: "FDA advisory panel narrowly rejects compounding of one peptide, backs two others", link: "https://www.statnews.com/2026/07/24/fda-peptide-compounding-panel-backs-epitalon-rejects-emideltide", published: NOW.toISOString() };
  assert.equal(evaluateArticleCandidate(statEntry, statSource, exclusions, statApproved, CUTOFF, NOW).status, "unsuitable_content");

  const staffingEntry = { title: "STAT+: Up and down the ladder: The latest comings and goings", link: "https://www.statnews.com/pharmalot/2026/07/24/up-and-down-the-ladder-rigel-sanofi-pharma-jobs", published: NOW.toISOString() };
  assert.equal(evaluateArticleCandidate(staffingEntry, statSource, exclusions, statApproved, CUTOFF, NOW).status, "unsuitable_content");

  const securitySource = makeSource({ id: "securityweek", publisher_name: "SecurityWeek", feed_url: "https://www.securityweek.com/feed/", homepage_url: "https://www.securityweek.com/" });
  const securityApproved = deriveApprovedHostnames(securitySource.homepage_url);
  const securityEntry = { title: "In Other News: Dolphin X AI-Powered Malware, Car Anti-Theft Device Hack, 400 Linux Kernel Flaws", link: "https://www.securityweek.com/in-other-news-dolphin-x-ai-powered-malware-car-anti-theft-device-hack-400-linux-kernel-flaws", published: NOW.toISOString() };
  assert.equal(evaluateArticleCandidate(securityEntry, securitySource, exclusions, securityApproved, CUTOFF, NOW).status, "unsuitable_content");

  const reactionEntry = { title: "Industry Reactions to OpenAI Models Hacking Hugging Face: Feedback Friday", link: "https://www.securityweek.com/industry-reactions-to-openai-models-hacking-hugging-face-feedback-friday", published: NOW.toISOString() };
  assert.equal(evaluateArticleCandidate(reactionEntry, securitySource, exclusions, securityApproved, CUTOFF, NOW).status, "unsuitable_content");
});

test("does not reject a genuine concrete event mentioning a press conference", () => {
  // Regression guard: bare "conference" was deliberately excluded from the
  // reject list because it would misfire on real news like this.
  const result = unsuitableTitleCheck("Officials Hold Press Conference on Ransomware Attack Response");
  assert.equal(result.status, "accepted");
});

// --- 19. two-items-per-publisher cap -----------------------------------------------------

test("19. caps selection at two items per publisher", () => {
  const items = [
    { title: "a", url: "https://x.test/a", publisher: "P", published_at: "2026-07-24T10:00:00.000Z", source_id: "pub-a", status: "ok" },
    { title: "b", url: "https://x.test/b", publisher: "P", published_at: "2026-07-24T09:00:00.000Z", source_id: "pub-a", status: "ok" },
    { title: "c", url: "https://x.test/c", publisher: "P", published_at: "2026-07-24T08:00:00.000Z", source_id: "pub-a", status: "ok" }
  ];
  const selected = rankAndSelect(items, { maximumItems: 10, maximumItemsPerSource: 2, sourcePriorityById: new Map([["pub-a", 8]]) });
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((item) => item.url), ["https://x.test/a", "https://x.test/b"]);
});

// --- 20. ten-item limit -----------------------------------------------------------------

test("20. never selects more than ten items total", () => {
  const priorityById = new Map();
  const items = Array.from({ length: 12 }, (_, index) => {
    const sourceId = `pub-${index}`;
    priorityById.set(sourceId, 10 - index);
    return { title: `t${index}`, url: `https://x.test/${index}`, publisher: "P", published_at: "2026-07-24T10:00:00.000Z", source_id: sourceId, status: "ok" };
  });
  const selected = rankAndSelect(items, { maximumItems: 10, maximumItemsPerSource: 2, sourcePriorityById: priorityById });
  assert.equal(selected.length, 10);
});

// --- 21. fewer than ten items is valid ----------------------------------------------------

test("21. fewer than ten items is a valid result; slots are not force-filled", () => {
  const items = [
    { title: "a", url: "https://x.test/a", publisher: "P", published_at: "2026-07-24T10:00:00.000Z", source_id: "pub-a", status: "ok" },
    { title: "b", url: "https://x.test/b", publisher: "Q", published_at: "2026-07-24T09:00:00.000Z", source_id: "pub-b", status: "ok" }
  ];
  const selected = rankAndSelect(items, { maximumItems: 10, maximumItemsPerSource: 2, sourcePriorityById: new Map([["pub-a", 8], ["pub-b", 7]]) });
  assert.equal(selected.length, 2);
});

// --- 22. exact headline preservation --------------------------------------------------------

test("22. preserves the exact original headline text, punctuation, and casing", () => {
  const source = makeSource();
  const approved = deriveApprovedHostnames(source.homepage_url);
  const title = "US, Allies Warn of Russian Cyberattacks Targeting Critical Infrastructure Routers";
  const entry = { title, link: "https://example-publisher.test/exact", published: NOW.toISOString() };
  const evaluation = evaluateArticleCandidate(entry, source, exclusions, approved, CUTOFF, NOW);
  assert.equal(evaluation.status, "accepted");
  assert.equal(evaluation.article.title, title);
});

// --- 23. atomic output behavior ---------------------------------------------------------------

test("23. writeJsonAtomic writes the final file and leaves no temp file behind", async () => {
  const scratchDir = path.join(require("os").tmpdir(), "relay-articles-test");
  await fs.mkdir(scratchDir, { recursive: true });
  const targetPath = path.join(scratchDir, "atomic-test.json");
  await writeJsonAtomic(targetPath, { hello: "world" });

  const written = JSON.parse(await fs.readFile(targetPath, "utf8"));
  assert.deepEqual(written, { hello: "world" });

  const siblingFiles = await fs.readdir(scratchDir);
  const leftoverTmp = siblingFiles.some((name) => name.includes(".tmp"));
  assert.equal(leftoverTmp, false);

  await fs.rm(scratchDir, { recursive: true, force: true });
});

// --- 24-27: page-side fetch behavior (static analysis of index.html) --------------------------

const INDEX_HTML_PATH = path.join(__dirname, "..", "pages", "relay", "index.html");

test("24. the page makes exactly one same-origin article-data fetch request", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const matches = html.match(/fetch\(\s*articleDataUrl/g) || [];
  assert.equal(matches.length, 1);
  assert.match(html, /const articleDataUrl = "\/pages\/relay\/article-data\.json"/);
});

test("25. the page never fetches a publisher feed directly from the browser", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  // Static fallback <a href> links legitimately reference publisher
  // hostnames; the point of this test is that no fetch() call does.
  const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const publisherHostnames = config.automatic_sources.map((source) => new URL(source.homepage_url).hostname);
  for (const script of scriptBlocks) {
    const fetchCalls = script.match(/fetch\([^)]*\)/g) || [];
    for (const call of fetchCalls) {
      for (const hostname of publisherHostnames) {
        assert.ok(!call.includes(hostname), `a fetch() call must not target publisher hostname ${hostname}: ${call}`);
      }
      assert.ok(!/fetch\(\s*["'`]https?:\/\//.test(call), `fetch() must not target an absolute external URL: ${call}`);
    }
  }
});

test("26. the six static article links remain in the markup as an error fallback", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const staticItemCount = (html.match(/class="headline-item"/g) || []).length;
  assert.ok(staticItemCount >= 6, "expected the six static fallback headline items to remain in the markup");
});

test("27. static markup includes the required empty-state elements", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  assert.match(html, /data-articles-empty/);
  assert.match(html, /No new selected articles\./);
});

// --- 27a-f: explicit status handling for the page-side article script -------------------------
//
// These tests actually execute the extracted article-data <script> against a
// fake document and a mocked fetch, rather than just pattern-matching the
// source text, so the five required status-handling rules are verified as
// real runtime behavior.

const STATIC_MARKER = "STATIC_FALLBACK_MARKER";

function extractArticleScript(html) {
  const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const target = scriptBlocks.find((block) => block.includes("articleDataUrl"));
  assert.ok(target, "expected to find the article-data script block in index.html");
  return target.replace(/^<script>/, "").replace(/<\/script>$/, "");
}

function makeFakeElement({ withStaticMarker = false } = {}) {
  const element = {
    hidden: false,
    className: "",
    href: "",
    target: "",
    rel: "",
    children: withStaticMarker ? ["static-fallback-child"] : [],
    append(...nodes) {
      // Mirror real DOM behavior: appending a DocumentFragment moves its
      // children rather than the fragment node itself.
      for (const node of nodes) {
        if (node && node.__isFragment) {
          this.children.push(...node.children);
        } else {
          this.children.push(node);
        }
      }
    }
  };
  let text = withStaticMarker ? STATIC_MARKER : "";
  Object.defineProperty(element, "textContent", {
    get() { return text; },
    set(value) {
      text = value;
      // Mirror real DOM behavior: setting textContent removes all children.
      this.children = [];
    }
  });
  return element;
}

async function flushMicrotasksAndTimers() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runArticleScript(scriptSource, { fetchImpl }) {
  const list = makeFakeElement({ withStaticMarker: true });
  const emptyMessage = makeFakeElement({ withStaticMarker: true });

  const fakeDocument = {
    querySelector(selector) {
      if (selector === "[data-article-list]") return list;
      if (selector === "[data-articles-empty]") return emptyMessage;
      return null;
    },
    createElement() {
      return makeFakeElement();
    },
    createDocumentFragment() {
      const fragment = makeFakeElement();
      fragment.children = [];
      fragment.__isFragment = true;
      return fragment;
    }
  };

  const runner = new Function("document", "fetch", scriptSource);
  runner(fakeDocument, fetchImpl);
  await flushMicrotasksAndTimers();

  return { list, emptyMessage };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body });
}

function malformedJsonResponse() {
  return async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token in JSON"); } });
}

test("27a. complete failure (status unavailable) with empty items keeps the static fallback links", async () => {
  // update-articles.js writes "unavailable" for a complete failure with no
  // previous data to fall back on — there is no separate "complete
  // failure" status string, so this is that exact case.
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list, emptyMessage } = await runArticleScript(script, {
    fetchImpl: jsonResponse({ status: "unavailable", items: [] })
  });
  assert.equal(list.hidden, false);
  assert.equal(list.textContent, STATIC_MARKER, "static list content must be left untouched");
  assert.equal(emptyMessage.hidden, false, "empty message must remain hidden (unchanged from default)");
});

test("27h. an unrecognized or missing status with empty items keeps the static fallback links (allowlist, not a denylist on 'unavailable' alone)", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);

  const unrecognized = await runArticleScript(script, {
    fetchImpl: jsonResponse({ status: "some_future_status", items: [] })
  });
  assert.equal(unrecognized.list.hidden, false);
  assert.equal(unrecognized.list.textContent, STATIC_MARKER);
  assert.equal(unrecognized.emptyMessage.hidden, false);

  const missing = await runArticleScript(script, {
    fetchImpl: jsonResponse({ items: [] })
  });
  assert.equal(missing.list.hidden, false);
  assert.equal(missing.list.textContent, STATIC_MARKER);
  assert.equal(missing.emptyMessage.hidden, false);
});

test("27i. partial-success status with empty items hides the static links and shows the empty message", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list, emptyMessage } = await runArticleScript(script, {
    fetchImpl: jsonResponse({ status: "partial", items: [] })
  });
  assert.equal(list.hidden, true);
  assert.notEqual(list.textContent, STATIC_MARKER);
  assert.equal(emptyMessage.hidden, false);
});

test("27b. a successful empty-selection status hides the static links and shows the empty message", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list, emptyMessage } = await runArticleScript(script, {
    fetchImpl: jsonResponse({ status: "ok_empty", items: [] })
  });
  assert.equal(list.hidden, true);
  assert.notEqual(list.textContent, STATIC_MARKER, "static list content must be cleared");
  assert.equal(emptyMessage.hidden, false);
});

test("27c. a successful populated status renders the collected items", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list, emptyMessage } = await runArticleScript(script, {
    fetchImpl: jsonResponse({
      status: "ok",
      items: [
        { title: "Grid Emergency Declared", url: "https://example.test/a", publisher: "Example Pub", published_at: "2026-07-24T18:00:00.000Z", source_id: "example", status: "ok" }
      ]
    })
  });
  assert.equal(list.hidden, false);
  assert.equal(list.children.length, 1);
  const [row] = list.children;
  const [link] = row.children;
  assert.equal(link.href, "https://example.test/a");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(emptyMessage.hidden, false, "empty message must stay hidden when items render");
});

test("27d. stale status with preserved items renders those items", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list } = await runArticleScript(script, {
    fetchImpl: jsonResponse({
      status: "stale",
      items: [
        { title: "Preserved Story From Last Success", url: "https://example.test/old", publisher: "Example Pub", published_at: "2026-07-20T00:00:00.000Z", source_id: "example", status: "stale" }
      ]
    })
  });
  assert.equal(list.hidden, false);
  assert.equal(list.children.length, 1);
  const [row] = list.children;
  const [link] = row.children;
  assert.equal(link.href, "https://example.test/old");
});

test("27e. malformed JSON keeps the static fallback links", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list, emptyMessage } = await runArticleScript(script, { fetchImpl: malformedJsonResponse() });
  assert.equal(list.hidden, false);
  assert.equal(list.textContent, STATIC_MARKER);
  assert.equal(emptyMessage.hidden, false);
});

test("27f. a failed fetch keeps the static fallback links", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list, emptyMessage } = await runArticleScript(script, {
    fetchImpl: async () => { throw new Error("network failure"); }
  });
  assert.equal(list.hidden, false);
  assert.equal(list.textContent, STATIC_MARKER);
  assert.equal(emptyMessage.hidden, false);
});

test("27g. a non-ok HTTP response keeps the static fallback links", async () => {
  const html = await fs.readFile(INDEX_HTML_PATH, "utf8");
  const script = extractArticleScript(html);
  const { list, emptyMessage } = await runArticleScript(script, {
    fetchImpl: jsonResponse({ status: "ok", items: [] }, { ok: false, status: 500 })
  });
  assert.equal(list.hidden, false);
  assert.equal(list.textContent, STATIC_MARKER);
  assert.equal(emptyMessage.hidden, false);
});

// --- 28. --verify-feeds does not write article-data.json ---------------------------------------

test("28. verifyFeeds never writes article-data.json", async () => {
  const before = await fs.readFile(DATA_PATH, "utf8");

  const source = makeSource({ id: "verify-source", feed_url: "https://verify.test/feed/" });
  const testConfig = { automatic_sources: [source] };
  const feed = rssFeed([rssItem({ title: "Sample Item", link: "https://example-publisher.test/a", pubDate: pubDateHoursAgo(1) })]);
  const fetchImpl = mockFetchImplFor({ "https://verify.test/feed/": { body: feed } });

  const results = await verifyFeeds({ config: testConfig, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "valid");

  const after = await fs.readFile(DATA_PATH, "utf8");
  assert.equal(before, after, "article-data.json must be byte-for-byte unchanged after --verify-feeds");
});

test("28b. verifyFeeds reports the required fields and flags an unapproved-hostname feed as invalid", async () => {
  const source = makeSource({ id: "bad-hostname-source", feed_url: "https://verify2.test/feed/", homepage_url: "https://example-publisher.test/" });
  const feed = rssFeed([rssItem({ title: "Sample Item", link: "https://someone-else.test/a", pubDate: pubDateHoursAgo(1) })]);
  const fetchImpl = mockFetchImplFor({ "https://verify2.test/feed/": { body: feed } });

  const results = await verifyFeeds({ config: { automatic_sources: [source] }, fetchImpl });
  assert.equal(results.length, 1);
  const [result] = results;
  assert.equal(result.id, "bad-hostname-source");
  assert.equal(result.enabled, true);
  assert.equal(result.status, "hostname_mismatch");
  assert.ok(Object.prototype.hasOwnProperty.call(result, "httpStatus"));
  assert.ok(Object.prototype.hasOwnProperty.call(result, "format"));
  assert.ok(Object.prototype.hasOwnProperty.call(result, "entryCount"));
  assert.ok(result.reason);
});

test("28c. verifyFeeds leaves a source with no configured feed URL disabled and reported, without a request", async () => {
  const source = makeSource({ id: "no-feed-source", feed_url: undefined, enabled: false });
  const fetchImpl = async () => { throw new Error("should not be called"); };
  const results = await verifyFeeds({ config: { automatic_sources: [source] }, fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "no_feed_configured");
  assert.equal(results[0].enabled, false);
});

// --- Additional helper coverage --------------------------------------------------------------

test("isApprovedLink / deriveApprovedHostnames accept both apex and www variants", () => {
  const approved = deriveApprovedHostnames("https://www.example-publisher.test/");
  assert.ok(isApprovedLink("https://www.example-publisher.test/a", approved));
  assert.ok(isApprovedLink("https://example-publisher.test/a", approved));
  assert.ok(!isApprovedLink("https://other.test/a", approved));
});

test("isSourceSpecificReject applies publisher-specific terms only to that publisher", () => {
  assert.equal(isSourceSpecificReject("food-safety-news", "our favorite chili recipe for the season"), true);
  assert.equal(isSourceSpecificReject("securityweek", "our favorite chili recipe for the season"), false);
});

test("isHardExcluded matches the shared Relay exclusion list unchanged", () => {
  assert.equal(isHardExcluded("archaeology dig uncovers ancient tomb", exclusions), true);
  assert.equal(isHardExcluded("grid emergency declared in three counties", exclusions), false);
});
