#!/usr/bin/env node
/*
  Notavello daily blog generator
  --------------------------------
  Run from repo root:
    node blog-automation\generate-daily-post.js --topic "AI browser workspaces"

  Then it writes:
    pages/blog/<slug>/index.html

  And automatically runs:
    node blog-automation\split-blog-index.js --write

  Required:
    npm install openai
    set OPENAI_API_KEY=your_key
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

  if (html.includes("%%")) {
    fail("Unreplaced %% placeholder remains in generated HTML.");
  }

  if (!html.includes('Looking for more AI tools?') || !html.includes('href="/tools/"')) {
    fail("Locked footer CTA appears to be missing or changed.");
  }

  const postBodyMatch = html.match(/<div\s+class=["']post-body["']>([\s\S]*?)<\/div>\s*<div\s+class=["']post-footer["']>/i);
  const postBody = postBodyMatch ? postBodyMatch[1] : "";
  if (!/<a\s+[^>]*href=["']\/[^"']+["']/i.test(postBody)) {
    console.warn("\nWARNING: No contextual internal root-relative Notavello link found inside .post-body.");
    console.warn("Review the post before publishing. The template asks for at least one natural internal link when possible.");
  }

  return { slug, title, html };
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

  const topicInstruction = TOPIC
    ? `Write today's post about this topic: ${TOPIC}`
    : "Pick one strong, non-duplicate topic for today's Notavello post. Prefer practical AI/tooling/web/software topics with search intent.";

  const prompt = `
You are writing one production-ready Notavello blog post.

Date:
- ISO: ${dateIso}
- Display: ${dateDisplay}

Topic:
${topicInstruction}

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
- Include at least one contextual internal Notavello link in the article body if it fits naturally.
- Use root-relative Notavello links, for example /tools/ or /exporters/chatgpt/ or /pages/blog/what-is-a-bot/.
- Do not link the same internal target more than once.
- Do not include footnotes.
- External links are allowed only when they genuinely support a claim.
- Do not make up facts, product launches, prices, legal claims, or dates.

Recent existing posts to avoid duplicating:
${existingSummary || "(No existing post cards found.)"}

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
Do not include a full HTML document in JSON. The local script will place the content into the locked template.
`.trim();

  const client = new OpenAI();

  async function request(useWeb) {
    return client.responses.create({
      model: MODEL,
      tools: useWeb ? [{ type: "web_search" }] : undefined,
      input: prompt
    });
  }

  let response;
  try {
    response = await request(!NO_WEB);
  } catch (error) {
    if (!NO_WEB) {
      console.warn("\nWARNING: Web search request failed. Retrying without web_search.");
      console.warn(String(error && error.message ? error.message : error));
      response = await request(false);
    } else {
      throw error;
    }
  }

  const outputText = response.output_text || "";
  const postJson = extractJson(outputText);
  const built = buildPostHtml(template, postJson, dateIso, dateDisplay);

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
