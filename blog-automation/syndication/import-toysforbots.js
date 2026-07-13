#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const BLOG_DIR = path.join(ROOT, 'pages', 'blog');
const TEMPLATE_PATH = path.join(BLOG_DIR, 'blog-post-template.html');
const SPLITTER_PATH = path.join(ROOT, 'blog-automation', 'split-blog-index.js');
const args = process.argv.slice(2);

function argValue(name, fallback = '') {
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) return args[index + 1];
  const inline = args.find((item) => item.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

const source = argValue('--source', process.env.SYNDICATION_SOURCE_URL || 'https://toysforbots.com/syndication/latest.json').trim();
const required = /^(?:1|true|yes|on)$/i.test(String(process.env.SYNDICATION_REQUIRED || 'false'));

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function decode(value) {
  return String(value || '')
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72).replace(/-+$/g, '');
}

function failOrSkip(message) {
  if (required) throw new Error(message);
  console.warn(`[syndication] ${message} Skipping partner import so Notavello's own publishing run can continue.`);
  process.exit(0);
}

async function loadFeed(location) {
  if (/^https?:\/\//i.test(location)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(location, {
        headers: { accept: 'application/json', 'user-agent': 'notavello-syndication/1.0' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Partner feed returned HTTP ${response.status}.`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, location), 'utf8'));
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'));
  return match ? decode(match[1]) : '';
}

function scanPosts() {
  const posts = [];
  for (const entry of fs.readdirSync(BLOG_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(BLOG_DIR, entry.name, 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    posts.push({ slug: entry.name, file, html, originId: meta(html, 'syndication-origin-id'), originSlug: meta(html, 'syndication-origin-slug') });
  }
  return posts;
}

function absoluteUrl(value, base) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('#') || /^(?:mailto:|tel:|data:)/i.test(raw)) return raw;
  try { return new URL(raw, base).href; } catch { return raw; }
}

function rewritePartnerHtml(html, feed, posts) {
  const localByOriginSlug = new Map(posts.filter((item) => item.originSlug).map((item) => [item.originSlug, item.slug]));
  let output = String(html || '').trim();
  const forbidden = /<(?:script|style|iframe|object|embed|form|input|button|svg|canvas)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*javascript:/i;
  if (forbidden.test(output)) throw new Error('Partner article contains active or unsafe markup.');

  output = output.replace(/\b(href|src)=(['"])(.*?)\2/gi, (match, attribute, quote, rawValue) => {
    let value = rawValue;
    const blogMatch = value.match(/^\/blog\/([a-z0-9-]+)\/?(?:[?#].*)?$/i);
    if (attribute.toLowerCase() === 'href' && blogMatch) {
      const localSlug = localByOriginSlug.get(blogMatch[1]);
      value = localSlug ? `/pages/blog/${localSlug}/` : `https://toysforbots.com${value}`;
    } else {
      value = absoluteUrl(value, String(feed.origin_url || 'https://toysforbots.com/'));
    }
    return `${attribute}=${quote}${escapeHtml(value)}${quote}`;
  });

  output = output.replace(/<a\b([^>]*)>/gi, (match, attributes) => {
    if (/\brel\s*=/.test(attributes)) return match;
    if (/\bhref\s*=\s*["']https?:\/\//i.test(attributes)) return `<a${attributes} rel="noopener noreferrer">`;
    return match;
  });
  return output;
}

function chooseSlug(base, posts, originId) {
  const bySlug = new Map(posts.map((item) => [item.slug, item]));
  if (!bySlug.has(base)) return base;
  if (bySlug.get(base).originId === originId) return base;
  let candidate = `toysforbots-${base}`;
  let counter = 2;
  while (bySlug.has(candidate) && bySlug.get(candidate).originId !== originId) {
    candidate = `toysforbots-${base}-${counter++}`;
  }
  return candidate;
}

function displayDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

function buildHtml(template, feed, slug, bodyHtml) {
  const publishedAt = new Date(feed.published_at).toISOString();
  const dateIso = publishedAt.slice(0, 10);
  let html = template
    .replaceAll('%%POST_TITLE%%', escapeHtml(feed.title))
    .replaceAll('%%META_DESCRIPTION%%', escapeHtml(String(feed.meta_description || feed.excerpt || feed.lede || feed.title).slice(0, 160)))
    .replaceAll('%%SLUG%%', slug)
    .replaceAll('%%DATE_ISO%%', publishedAt)
    .replaceAll('%%DATE_DISPLAY%%', displayDate(publishedAt))
    .replaceAll('%%TAG%%', escapeHtml(feed.category || 'Tech'))
    .replaceAll('%%LEDE%%', escapeHtml(feed.lede || feed.excerpt || feed.meta_description || ''))
    .replaceAll('%%CALLOUT_LABEL%%', '')
    .replaceAll('%%CALLOUT_TEXT%%', '');

  html = html.replace(
    /<div\s+class=["']post-body["']>\s*[\s\S]*?\s*<\/div>\s*\n\s*<div\s+class=["']post-footer["']>/i,
    `<div class="post-body">\n\n${bodyHtml}\n\n  </div>\n\n  <div class="post-footer">`
  );

  const metadata = [
    `<meta property="article:published_time" content="${escapeHtml(publishedAt)}"/>`,
    `<meta property="article:modified_time" content="${escapeHtml(feed.updated_at || publishedAt)}"/>`,
    `<meta name="notavello:published_at" content="${escapeHtml(publishedAt)}"/>`,
    `<meta name="syndication-origin-site" content="toysforbots"/>`,
    `<meta name="syndication-origin-id" content="${escapeHtml(feed.origin_id)}"/>`,
    `<meta name="syndication-origin-slug" content="${escapeHtml(feed.slug)}"/>`,
    `<meta name="syndication-origin-url" content="${escapeHtml(feed.origin_url)}"/>`,
    `<meta name="syndication-source-format" content="${escapeHtml(feed.format || 'toysforbots-syndication-v1')}"/>`
  ].join('\n');
  html = html.replace(/(<meta\s+property=["']og:type["']\s+content=["']article["']\s*\/>)/i, `$1\n${metadata}`);

  html = html.replace(/^<!--[\s\S]*?-->\s*(?=<!DOCTYPE)/i, '');
  html = html.replace(/(<\/html>)[\s\S]*$/i, '$1\n');
  const stray = html.replace(/<!--[\s\S]*?-->/g, '').match(/%%[A-Z0-9_]+%%/);
  if (stray) throw new Error(`Unreplaced template placeholder: ${stray[0]}`);
  return html;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, content, 'utf8');
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

async function main() {
  let feed;
  try { feed = await loadFeed(source); }
  catch (error) { failOrSkip(`Could not load ${source}: ${error.message || error}`); }

  if (feed?.version !== 1 || feed?.origin_site !== 'toysforbots' || !feed?.origin_id) {
    failOrSkip('The partner feed is missing the expected Toys for Bots syndication fields.');
  }
  if (!feed.title || !feed.slug || !feed.published_at || !feed.body_html) {
    failOrSkip('The partner feed is missing title, slug, published_at, or body_html.');
  }

  const posts = scanPosts();
  if (posts.some((item) => item.originId === feed.origin_id)) {
    console.log(`[syndication] Already imported ${feed.origin_id}; nothing to do.`);
    return;
  }

  const baseSlug = slugify(feed.slug);
  if (!baseSlug) failOrSkip('The partner feed supplied an invalid slug.');
  const slug = chooseSlug(baseSlug, posts, feed.origin_id);
  const bodyHtml = rewritePartnerHtml(feed.body_html, feed, posts);
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const html = buildHtml(template, feed, slug, bodyHtml);
  const target = path.join(BLOG_DIR, slug, 'index.html');
  atomicWrite(target, html);

  const split = spawnSync(process.execPath, [SPLITTER_PATH, '--write'], { cwd: ROOT, stdio: 'inherit', shell: false });
  if (split.status !== 0) throw new Error('Blog index rebuild failed after importing the partner post.');

  console.log(`[syndication] Imported ${feed.origin_id} as pages/blog/${slug}/index.html.`);
  console.log('[syndication] No transfer or staging files were retained.');
}

main().catch((error) => {
  if (required) {
    console.error(`[syndication] ${error.stack || error}`);
    process.exit(1);
  }
  console.warn(`[syndication] ${error.message || error} Skipping partner import.`);
});
