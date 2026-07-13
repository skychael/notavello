#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const BLOG_DIR = path.join(ROOT, 'pages', 'blog');
const OUT_PATH = path.join(ROOT, 'syndication', 'latest.json');

function decode(value) {
  return String(value || '')
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decode(match[1]);
  }
  return '';
}

function first(html, pattern) {
  const match = html.match(pattern);
  return match ? decode(match[1]) : '';
}

function jsonLdValue(html, key) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const parsed = JSON.parse(body);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (item[key]) return String(item[key]);
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
      }
    } catch {}
  }
  return '';
}

function extractBody(html) {
  const match = html.match(/<div\s+class=["']post-body["']>([\s\S]*?)<\/div>\s*<div\s+class=["']post-footer["']>/i);
  return match ? match[1].trim() : '';
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
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

function readOriginalPosts() {
  return fs.readdirSync(BLOG_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith('_') && !/^page-\d+$/.test(entry.name) && entry.name !== 'all-posts')
    .map((entry) => {
      const file = path.join(BLOG_DIR, entry.name, 'index.html');
      if (!fs.existsSync(file)) return null;
      const html = fs.readFileSync(file, 'utf8');
      if (meta(html, 'syndication-origin-site')) return null;
      const published = meta(html, 'article:published_time') || meta(html, 'notavello:published_at') || jsonLdValue(html, 'datePublished');
      const publishedAt = isoDate(published);
      if (!publishedAt) return null;
      return { slug: entry.name, file, html, publishedAt, timestamp: new Date(publishedAt).valueOf() };
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function main() {
  const latest = readOriginalPosts()[0];
  if (!latest) throw new Error('No original Notavello blog post was found for syndication.');

  const title = meta(latest.html, 'og:title') || first(latest.html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const description = meta(latest.html, 'description') || meta(latest.html, 'og:description');
  const category = meta(latest.html, 'article:section') || first(latest.html, /<span[^>]*class=["'][^"']*post-tag[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || 'Tech';
  const lede = first(latest.html, /<p[^>]*class=["'][^"']*post-lede[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  const bodyHtml = extractBody(latest.html);
  if (!title || !description || !lede || !bodyHtml) throw new Error(`Could not extract complete article data from ${latest.file}.`);

  const feed = {
    version: 1,
    format: 'notavello-syndication-v1',
    origin_site: 'notavello',
    origin_id: `notavello:${latest.slug}`,
    origin_url: `https://notavello.com/pages/blog/${latest.slug}/`,
    slug: latest.slug,
    title,
    meta_description: description,
    category,
    excerpt: description,
    lede,
    published_at: latest.publishedAt,
    updated_at: latest.publishedAt,
    body_html: bodyHtml
  };

  atomicWrite(OUT_PATH, `${JSON.stringify(feed, null, 2)}\n`);
  console.log(`[syndication] Exported ${feed.origin_id} to syndication/latest.json.`);
  console.log('[syndication] No transfer or staging files were retained.');
}

main();
