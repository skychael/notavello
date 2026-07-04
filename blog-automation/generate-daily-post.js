#!/usr/bin/env node
/*
  Notavello daily blog generator
  --------------------------------
  Run from repo root:
    node blog-automation\generate-daily-post.js --topic "AI browser workspaces"

  Or let it pick its own topic, seeded by what's active on Hacker News today:
    node blog-automation\generate-daily-post.js

  Then it writes:
    pages/blog/<slug>/index.html

  And automatically runs:
    node blog-automation\split-blog-index.js --write
  which rebuilds the paginated blog index AND the title-only All Posts
  archive at pages/blog/all-posts/index.html.

  Required:
    npm install openai
    set OPENAI_API_KEY=your_key

  Optional (Hacker News topic seeding -- no signup, no API key, nothing to
  configure. Uses the public Algolia HN Search API):

    --hn-query "ai agents"   (optional keyword filter; default: HN front page)
    --no-hn                  (skip Hacker News entirely, old behavior)

  IMPORTANT: Hacker News threads are used ONLY as a signal that a topic is
  being actively discussed. The model is explicitly instructed not to treat
  any claim inside an HN title as a verified fact -- it must independently
  confirm real facts via web_search before writing about anything sourced
  from Hacker News. See HN_VERIFICATION_RULE below.
*/

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const OpenAI = require("openai");

const ROOT = process.cwd();
const BLOG_DIR = path.join(ROOT, "pages", "blog");
const INDEX_PATH = path.join(BLOG_DIR, "index.html");
const SPLITTER_PATH = path.join(ROOT, "blog-automation", "split-blog-index.js");

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const exact = args.indexOf(name);
  if (exact !== -1 && args[exact + 1]) return args[exact + 1];
  const prefixed = args.find(a => a.startsWith(name + "="));
  return prefixed ? prefixed.slice(name.length + 1) : fallback;
}

const TOPIC = argValue("--topic", process.env.BLOG_TOPIC || "");
const MODEL = argValue("--model", process.env.OPENAI_MODEL || "gpt-5.5");
const DRY_RUN = args.includes("--dry-run");
const SKIP_SPLIT = args.includes("--skip-split");
const NO_WEB = args.includes("--no-web") || process.env.NO_WEB_SEARCH === "1";

const HN_QUERY = argValue("--hn-query", process.env.HN_QUERY || "");
const NO_HN = args.includes("--no-hn");

function fail(message) {
  console.error("\nERROR: " + message);
  process.exit(1);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function findTemplate() {
  const candidates = [
    path.join(ROOT, "blog-automation", "blog-post-template.html"),
    path.join(ROOT, "blog-post-template.html"),
    path.join(BLOG_DIR, "blog-post-template.html"),
    path.join(ROOT, "pages", "blog-post-template.html")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  fail(
    "Could not find blog-post-template.html. Put it at blog-automation\\blog-post-template.html " +
    "or set up one of the expected paths in generate-daily-post.js."
  );
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayParts() {
  const now = new Date();
  const dateIso = now.toISOString().slice(0, 10);
  const dateDisplay = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(now);
  return { dateIso, dateDisplay };
}

function extractExistingPostSummary(indexHtml) {
  const cards = indexHtml.match(/<a\s+class=["']post-card["'][\s\S]*?<\/a>/gi) || [];
  return cards.slice(0, 50).map(card => {
    const href = (card.match(/href=["']([^"']+)["']/i) || [])[1] || "";
    const title = stripTags((card.match(/<div\s+class=["']post-card-title["']>([\s\S]*?)<\/div>/i) || [])[1] || "");
    const desc = stripTags((card.match(/<div\s+class=["']post-card-desc["']>([\s\S]*?)<\/div>/i) || [])[1] || "");
    const tag = stripTags((card.match(/<span\s+class=["']post-tag["']>([\s\S]*?)<\/span>/i) || [])[1] || "");
    return `- ${title} | ${tag} | ${href} | ${desc}`;
  }).join("\n");
}

// --- Hacker News topic seeding --------------------------------------------
// No auth, no signup, no keys -- the public Algolia HN Search API. Pulls
// today's front page (or a keyword-filtered search) to use ONLY as a signal
// of what's being actively discussed -- never as a source of facts. Any
// failure here (network error, bad response) is non-fatal: the script falls
// back to the old self-directed topic selection instead of stopping.

async function fetchHnTopicSeeds() {
  if (NO_HN) return "";

  try {
    const url = HN_QUERY
      ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(HN_QUERY)}&tags=story&hitsPerPage=15`
      : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15`;

    const res = await fetch(url, {
      headers: { "User-Agent": "notavello-blog-automation/1.0 (script for notavello.com)" }
    });

    if (!res.ok) {
      console.warn(`WARNING: Could not fetch Hacker News (HTTP ${res.status}). Continuing without HN topic seeds.`);
      return "";
    }

    const data = await res.json();
    const hits = (data && data.hits) || [];
    const lines = hits
      .filter(h => h && h.title)
      .map(h => `- [HN, ${h.points ?? "?"} points, ${h.num_comments ?? "?"} comments] ${h.title}`);

    return lines.join("\n");
  } catch (error) {
    console.warn("WARNING: Hacker News fetch failed. Continuing without HN topic seeds.");
    console.warn(String(error && error.message ? error.message : error));
    return "";
  }
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }

  fail("The model did not return valid JSON. Raw output:\n" + raw.slice(0, 2000));
}

function normalizeSectionHtml(html) {
  const value = String(html || "").trim();
  if (!value) return "";
  if (/<p\b|<ul\b|<ol\b|<table\b|<div\b/i.test(value)) return value;
  return `<p>${escapeHtml(value)}</p>`;
}

function buildPostHtml(template, post, dateIso, dateDisplay) {
  const slug = slugify(post.slug || post.post_title || post.title);
  const title = String(post.post_title || post.title || "").trim();
  const meta = String(post.meta_description || "").replace(/"/g, "").trim().slice(0, 150);
  const tag = String(post.tag || "Tech").trim();
  const lede = String(post.lede || "").trim();

  if (!slug) fail("Generated post is missing a slug.");
  if (!title) fail("Generated post is missing a title.");
  if (!meta) fail("Generated post is missing a meta description.");
  if (!lede) fail("Generated post is missing a lede.");

  const sections = Array.isArray(post.sections) ? post.sections : [];
  if (sections.length < 3) fail("Generated post needs at least 3 sections.");

  const calloutLabel = String(post.callout_label || "The bottom line:").trim();
  const calloutText = String(post.callout_text || "").trim();

  let body = "";
  sections.forEach((section, index) => {
    const heading = String(section.heading || "").trim();
    const html = normalizeSectionHtml(section.html || section.body || "");
    if (!heading || !html) return;

    body += `    <h2>${escapeHtml(heading)}</h2>\n`;
    body += `    ${html}\n\n`;

    if (index === 0 && calloutText) {
      body += `    <div class="callout">\n`;
      body += `      <strong>${escapeHtml(calloutLabel)}</strong> ${escapeHtml(calloutText)}\n`;
      body += `    </div>\n\n`;
    }
  });

  let html = template
    .replaceAll("%%POST_TITLE%%", escapeHtml(title))
    .replaceAll("%%META_DESCRIPTION%%", escapeHtml(meta))
    .replaceAll("%%SLUG%%", slug)
    .replaceAll("%%DATE_ISO%%", dateIso)
    .replaceAll("%%DATE_DISPLAY%%", dateDisplay)
    .replaceAll("%%TAG%%", escapeHtml(tag))
    .replaceAll("%%LEDE%%", escapeHtml(lede))
    .replaceAll("%%CALLOUT_LABEL%%", escapeHtml(calloutLabel))
    .replaceAll("%%CALLOUT_TEXT%%", escapeHtml(calloutText));

  html = html.replace(
    /<div\s+class=["']post-body["']>\s*[\s\S]*?\s*<\/div>\s*\n\s*<div\s+class=["']post-footer["']>/i,
    `<div class="post-body">\n\n${body}  </div>\n\n  <div class="post-footer">`
  );

  // Strip dev-only content that must never ship in a published post:
  // 1) the leading "ALL %% PLACEHOLDERS MUST BE REPLACED" warning comment
  // 2) everything after the closing </html> tag (the "NOTE TO FUTURE CLAUDES"
  //    workflow instructions block, meant only for whoever edits the template
  //    by hand -- never for a generated, published post).
  html = html.replace(/^<!--[\s\S]*?-->\s*(?=<!DOCTYPE)/i, "");
  html = html.replace(/(<\/html>)[\s\S]*$/i, "$1\n");

  const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const strayPlaceholder = htmlWithoutComments.match(/%%[A-Z0-9_]+%%/);
  if (strayPlaceholder) {
    const idx = htmlWithoutComments.indexOf(strayPlaceholder[0]);
    const context = htmlWithoutComments.slice(Math.max(0, idx - 80), idx + 80);
    console.error("\nDEBUG: Found stray placeholder here:\n---\n" + context + "\n---");
    fail(`Unreplaced placeholder remains in generated HTML: ${strayPlaceholder[0]}`);
  }

  if (!html.includes('Looking for more AI tools?') || !html.includes('href="/"')) {
    const footerIdx = html.search(/<div\s+class=["']post-footer["']>/i);
    const footerContext = footerIdx === -1
      ? "(Could not even find <div class=\"post-footer\"> in the output.)"
      : html.slice(footerIdx, footerIdx + 500);
    console.error("\nDEBUG: Footer area found in generated HTML:\n---\n" + footerContext + "\n---");
    fail("Locked footer CTA appears to be missing or changed.");
  }

  return { slug, title, html };
}

function buildInternalTargets() {
  const staticTargets = [
    "/", "/tools/", "/app/",
    "/exporters/chatgpt/", "/exporters/claude/", "/exporters/gemini/",
    "/exporters/grok/", "/exporters/copilot/", "/exporters/perplexity/", "/exporters/other/",
    "/pages/pricing/", "/pages/sample/", "/pages/faq/", "/pages/about/", "/pages/blog/"
  ];
  let blogTargets = [];
  try {
    blogTargets = fs.readdirSync(BLOG_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("page-"))
      .filter(d => fs.existsSync(path.join(BLOG_DIR, d.name, "index.html")))
      .map(d => `/pages/blog/${d.name}/`);
  } catch (_) { /* whitelist still works with static targets only */ }
  return { set: new Set([...staticTargets, ...blogTargets]), list: [...staticTargets, ...blogTargets] };
}

function auditPostLinks(html, allowedInternal) {
  const postBodyMatch = html.match(/<div\s+class=["']post-body["']>([\s\S]*?)<\/div>\s*<div\s+class=["']post-footer["']>/i);
  const postBody = postBodyMatch ? postBodyMatch[1] : "";
  const hrefs = [...postBody.matchAll(/<a\s+[^>]*href=["']([^"']+)["']/gi)].map(m => m[1]);

  const internal = hrefs.filter(h => h.startsWith("/"));
  const external = hrefs.filter(h => /^https?:\/\//i.test(h) && !/^https?:\/\/(www\.)?notavello\.com/i.test(h));
  const badInternal = internal.filter(h => {
    const normalized = h.endsWith("/") ? h : h + "/";
    return !allowedInternal.has(normalized) && !allowedInternal.has(h);
  });

  const problems = [];
  if (internal.length === 0) problems.push("MISSING: no internal Notavello link (root-relative href) in the article body.");
  if (external.length === 0) problems.push("MISSING: no external https:// source link in the article body.");
  if (badInternal.length > 0) problems.push(`BROKEN: internal link(s) point to pages that do not exist: ${badInternal.join(", ")}. Only use targets from the allowed list.`);
  return { ok: problems.length === 0, problems };
}

async function generatePost() {
  if (!process.env.OPENAI_API_KEY) {
    fail("OPENAI_API_KEY is not set.");
  }
  if (!fs.existsSync(BLOG_DIR)) fail("Missing pages\\blog folder. Run from the Notavello repo root.");
  if (!fs.existsSync(INDEX_PATH)) fail("Missing pages\\blog\\index.html.");
  if (!fs.existsSync(SPLITTER_PATH)) fail("Missing blog-automation\\split-blog-index.js.");

  const templatePath = findTemplate();
  const template = readText(templatePath);
  const indexHtml = readText(INDEX_PATH);
  const existingSummary = extractExistingPostSummary(indexHtml);
  const { dateIso, dateDisplay } = todayParts();

  const hnSeeds = await fetchHnTopicSeeds();

  const targets = buildInternalTargets();
  const internalTargets = targets.list.join("\n");

  if (hnSeeds && NO_WEB) {
    console.warn(
      "\nWARNING: Hacker News topic seeding is on but --no-web disables the model's " +
      "ability to verify any claim it draws from those threads. Either drop " +
      "--no-web or pass --no-hn so a topic isn't sourced from HN with " +
      "no way to fact-check it."
    );
  }

  const topicInstruction = TOPIC
    ? `Write today's post about this topic: ${TOPIC}`
    : hnSeeds
      ? "Pick one strong, non-duplicate topic for today's Notavello post. Use today's Hacker News activity below as a signal of what people are actively discussing right now -- prefer a topic grounded in that activity if a good one fits. Prefer practical AI/tooling/web/software topics with search intent."
      : "Pick one strong, non-duplicate topic for today's Notavello post. Prefer practical AI/tooling/web/software topics with search intent.";

  const hnBlock = hnSeeds
    ? `
Today's Hacker News activity (topic signal ONLY):
${hnSeeds}

HN_VERIFICATION_RULE: The list above tells you what the tech community is
actively discussing right now -- nothing more. Do not treat any title, number,
or claim in that list as true. If you draw a topic from it, you must
independently confirm the real underlying facts using web search before
writing anything. If you cannot verify a claim implied by an HN post, do not
repeat it -- either drop that angle or state plainly that it is an unverified
claim being discussed online.
`
    : "";

  const prompt = `
You are writing one production-ready Notavello blog post.

Date:
- ISO: ${dateIso}
- Display: ${dateDisplay}

Topic:
${topicInstruction}
${hnBlock}
Use this Notavello voice:
- confident, plain-English, occasionally dry
- not corporate
- address the reader as "you" when natural
- always write about AI in the third person
- never write as if the AI assistant is narrating
- 800-1800 words
- useful, specific headers
- no generic filler

SEO and site rules:
- Return a lowercase hyphenated slug.
- Meta description max 150 characters, no quotes.
- Use one tag from: AI Tools, AI Comparison, AI Trends, AI Markets, Developer Tools, Privacy, Energy, Insurance, Tech.
- Do not include footnotes.
- Do not make up facts, product launches, prices, legal claims, or dates.
- If any part of today's topic was sourced from Hacker News activity above, you must have independently verified the real facts via web search before stating them -- never present unverified forum claims as established fact.

Recent existing posts to avoid duplicating:
${existingSummary || "(No existing post cards found.)"}

LINK REQUIREMENTS -- MANDATORY. The local script machine-checks these and REJECTS the post if any fail. A rejected post is regenerated, wasting the run. These are not stylistic suggestions:
1. The article body MUST contain at least one internal Notavello link (root-relative <a href="...">).
2. The article body MUST contain at least one external link (full https:// URL) to a reputable source that supports a specific claim you make.
3. Internal links may ONLY point to targets on this list -- any other internal URL is rejected as a broken link:
${internalTargets}
4. Do not link the same internal target more than once. Anchor text must read naturally in the sentence.

Return ONLY valid JSON with this exact shape:
{
  "slug": "lowercase-hyphenated-slug",
  "post_title": "Title Case Blog Title",
  "meta_description": "150 char max meta description",
  "tag": "AI Tools",
  "lede": "One or two sentence hook.",
  "callout_label": "The bottom line:",
  "callout_text": "One to three punchy sentences.",
  "teaser": "One or two sentence index-card teaser.",
  "sections": [
    {
      "heading": "Specific h2 heading",
      "html": "<p>One or more paragraphs. Inline links are okay.</p>"
    }
  ]
}

The sections array must contain 4 to 7 sections.
Each section.html must be valid HTML fragments using <p>, <ul>, <li>, <strong>, <a>, or simple tables only.
Across all sections combined, the LINK REQUIREMENTS above must be satisfied: at least one internal link from the allowed list AND at least one external https:// source link. Posts without both are rejected.
Do not include a full HTML document in JSON. The local script will place the content into the locked template.
`.trim();

  const client = new OpenAI();

  async function request(useWeb, inputPrompt) {
    return client.responses.create({
      model: MODEL,
      tools: useWeb ? [{ type: "web_search" }] : undefined,
      input: inputPrompt
    });
  }

  const MAX_ATTEMPTS = 3;
  let built = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let attemptPrompt = prompt;
    if (attempt > 1 && built && built.audit) {
      attemptPrompt = prompt + `

PREVIOUS ATTEMPT WAS REJECTED by the link validator for these reasons:
${built.audit.problems.map(p => "- " + p).join("\n")}
Fix every listed problem. The LINK REQUIREMENTS above are machine-enforced.`;
    }

    let response;
    try {
      response = await request(!NO_WEB, attemptPrompt);
    } catch (error) {
      if (!NO_WEB) {
        console.warn("\nWARNING: Web search request failed. Retrying without web_search.");
        console.warn(String(error && error.message ? error.message : error));
        response = await request(false, attemptPrompt);
      } else {
        throw error;
      }
    }

    const outputText = response.output_text || "";
    const postJson = extractJson(outputText);
    const candidate = buildPostHtml(template, postJson, dateIso, dateDisplay);
    const audit = auditPostLinks(candidate.html, targets.set);
    built = { ...candidate, audit };

    if (audit.ok) break;

    console.warn(`\nAttempt ${attempt}/${MAX_ATTEMPTS} rejected by link validator:`);
    audit.problems.forEach(p => console.warn("  - " + p));
    if (attempt === MAX_ATTEMPTS) {
      fail("All attempts failed the mandatory link requirements. No post was published.");
    }
    console.warn("Regenerating with corrective feedback...");
  }

  const postDir = path.join(BLOG_DIR, built.slug);
  const outPath = path.join(postDir, "index.html");

  if (fs.existsSync(outPath)) {
    fail(`Post already exists: pages\\blog\\${built.slug}\\index.html`);
  }

  console.log("\nGenerated post:");
  console.log(`  Title: ${built.title}`);
  console.log(`  Slug:  ${built.slug}`);
  console.log(`  URL:   https://notavello.com/pages/blog/${built.slug}/`);

  if (DRY_RUN) {
    console.log("\nDry run only. No files written.");
    console.log("\nPreview first 1200 chars:\n");
    console.log(built.html.slice(0, 1200));
    return;
  }

  writeText(outPath, built.html);
  console.log(`\nWrote: pages\\blog\\${built.slug}\\index.html`);

  if (!SKIP_SPLIT) {
    console.log("\nRunning blog index splitter...");
    const result = spawnSync(process.execPath, [SPLITTER_PATH, "--write"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: false
    });

    if (result.status !== 0) {
      fail("split-blog-index.js failed. The post file was written, but index pagination may not be updated.");
    }
  } else {
    console.log("\nSkipped splitter. Run manually:");
    console.log("  node blog-automation\\split-blog-index.js --write");
  }

  console.log("\nDone.");
  console.log(`Review: pages\\blog\\${built.slug}\\index.html`);
  console.log(`Live URL after deploy: https://notavello.com/pages/blog/${built.slug}/`);
}

generatePost().catch(error => {
  console.error(error);
  process.exit(1);
});
