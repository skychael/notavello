#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://notavello.com';
const EXCLUDED_DIRS = new Set(['.git', '.github', '.agents', '.claude', 'node_modules', 'admin', 'versions', 'assets-raw']);
const EXTRA_PAGES = new Map([
  ['pages/about.html', '/pages/about'],
  ['pages/contact.html', '/pages/contact'],
  ['pages/faq.html', '/pages/faq'],
  ['pages/pricing.html', '/pages/pricing'],
  ['pages/privacy.html', '/pages/privacy'],
  ['pages/sample.html', '/pages/sample'],
  ['pages/sitemap.html', '/pages/sitemap'],
  ['pages/terms.html', '/pages/terms'],
  ['weather.html', '/weather'],
  ['tools/koga/help.html', '/tools/koga/help'],
  ['tools/koga/privacy.html', '/tools/koga/privacy'],
  ['tools/koga/support.html', '/tools/koga/support'],
]);
const EXTERNALLY_MANAGED_ROUTES = new Set(['/tools/pdf-ocr/']);
const HTML_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

function decode(value = '') {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, key) => {
    if (key[0] === '#') {
      const hex = key[1].toLowerCase() === 'x';
      return String.fromCodePoint(parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return HTML_ENTITIES[key.toLowerCase()] || `&${key};`;
  });
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function stripHtml(html) {
  return decode(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), found);
    } else {
      const file = path.join(dir, entry.name);
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (entry.name === 'index.html' || EXTRA_PAGES.has(rel)) found.push(file);
    }
  }
  return found;
}

function fileUrl(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (EXTRA_PAGES.has(rel)) return EXTRA_PAGES.get(rel);
  const route = '/' + rel.replace(/index\.html$/, '');
  return route === '/' ? '/' : route;
}

function parsePage(file) {
  const html = fs.readFileSync(file, 'utf8');
  const route = fileUrl(file);
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map(m => stripHtml(m[1]));
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0]));
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => a.href);
  const robots = metas.filter(m => (m.name || '').toLowerCase() === 'robots').map(m => m.content || '');
  const descriptions = metas.filter(m => (m.name || '').toLowerCase() === 'description').map(m => m.content || '');
  const canonicals = links.filter(l => (l.rel || '').toLowerCase().split(/\s+/).includes('canonical')).map(l => l.href);
  const published = metas.find(m => (m.property || '').toLowerCase() === 'article:published_time')?.content;
  const modified = metas.find(m => (m.property || '').toLowerCase() === 'article:modified_time')?.content;
  const main = html.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || '';
  return {
    file, rel: path.relative(ROOT, file).replace(/\\/g, '/'), route, html,
    title: titles[0] || '', titles, description: descriptions[0] || '', descriptions,
    robots: robots.join(',').toLowerCase(), canonicals, canonical: canonicals[0] || '',
    anchors, published, modified, body: stripHtml(main),
    isArticle: /^\/pages\/blog\/[^/]+\/$/.test(route) && !/^\/pages\/blog\/(all-posts|page-\d+)\/$/.test(route),
  };
}

function normalizeInternal(href, fromRoute) {
  try {
    const url = new URL(href, ORIGIN + fromRoute);
    if (url.origin !== ORIGIN) return null;
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.search = '';
    return url.pathname;
  } catch (_) { return null; }
}

function robotsAllows(route, robotsText) {
  const lines = robotsText.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
  let applies = false;
  let best = { length: -1, allow: true };
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') { applies = value === '*' || value.toLowerCase() === 'googlebot'; continue; }
    if (!applies || !['allow', 'disallow'].includes(key) || !value) continue;
    const pattern = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$');
    if (new RegExp('^' + pattern).test(route) && value.length > best.length) best = { length: value.length, allow: key === 'allow' };
  }
  return best.allow;
}

function gitDate(page) {
  const metadata = page.modified || page.published;
  if (metadata && !Number.isNaN(Date.parse(metadata))) return new Date(metadata).toISOString().slice(0, 10);
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', page.rel], { cwd: ROOT, encoding: 'utf8' }).trim() || null;
  } catch (_) { return null; }
}

function tokenSet(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
}

function similarity(a, b) {
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  return common / Math.max(1, Math.min(a.size, b.size));
}

function sitemapUrls() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1]));
}

function redirectedRoutes() {
  const file = fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8');
  return new Set(file.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean).map(line => line.split(/\s+/)[0]));
}

function audit() {
  const pages = walk(ROOT).map(parsePage).sort((a, b) => a.route.localeCompare(b.route));
  const byRoute = new Map(pages.map(p => [p.route, p]));
  const robotsText = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  const sitemap = sitemapUrls();
  const sitemapSet = new Set(sitemap);
  const redirects = redirectedRoutes();
  const errors = [];
  const warnings = [];
  const incoming = new Map(pages.map(p => [p.route, new Set()]));
  const sharedLinks = ['_header.html', '_footer.html'].flatMap(file => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return [...html.matchAll(/<a\b[^>]*>/gi)].map(m => attrs(m[0]).href).filter(Boolean);
  });

  function resolveRoute(route) {
    if (byRoute.has(route)) return route;
    if (route === '/login' && fs.existsSync(path.join(ROOT, 'login.html'))) return null;
    if (route.endsWith('/') && byRoute.has(route.slice(0, -1) + '.html')) return route.slice(0, -1) + '.html';
    return null;
  }

  for (const page of pages) {
    const hrefs = [...page.anchors.map(a => a.href), ...sharedLinks];
    for (const href of hrefs) {
      if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      const route = normalizeInternal(href, page.route);
      if (!route) continue;
      const resolved = resolveRoute(route);
      if (resolved) incoming.get(resolved).add(page.route);
      else if (!/\.[a-z0-9]{2,5}$/i.test(route) && route !== '/login' && !EXTERNALLY_MANAGED_ROUTES.has(route)) errors.push({ type: 'broken-internal-link', page: page.route, detail: href });
    }
  }

  const indexable = pages.filter(page => !page.robots.includes('noindex') && !redirects.has(page.route));
  for (const page of indexable) {
    const expected = ORIGIN + page.route;
    if (page.titles.length !== 1 || !page.title) errors.push({ type: 'title-count', page: page.route, detail: String(page.titles.length) });
    if (page.descriptions.length !== 1 || !page.description) errors.push({ type: 'description-count', page: page.route, detail: String(page.descriptions.length) });
    if (page.canonicals.length !== 1 || page.canonical !== expected) errors.push({ type: 'canonical-mismatch', page: page.route, detail: page.canonicals.join(', ') || 'missing' });
    if (!robotsAllows(page.route, robotsText)) errors.push({ type: 'robots-blocked', page: page.route, detail: page.route });
    if (!sitemapSet.has(expected)) errors.push({ type: 'missing-from-sitemap', page: page.route, detail: expected });
  }

  for (const url of sitemap) {
    let parsed;
    try { parsed = new URL(url); } catch (_) { errors.push({ type: 'invalid-sitemap-url', page: url, detail: url }); continue; }
    const page = byRoute.get(parsed.pathname);
    if (parsed.origin !== ORIGIN || parsed.search || parsed.hash) errors.push({ type: 'noncanonical-sitemap-url', page: url, detail: url });
    if (!page) errors.push({ type: 'sitemap-url-without-page', page: url, detail: parsed.pathname });
    else if (page.robots.includes('noindex')) errors.push({ type: 'noindex-in-sitemap', page: page.route, detail: url });
    else if (redirects.has(page.route)) errors.push({ type: 'redirect-in-sitemap', page: page.route, detail: url });
  }

  for (const group of [['duplicate-title', 'title'], ['duplicate-description', 'description']]) {
    const values = new Map();
    for (const page of indexable) {
      const value = page[group[1]].trim().toLowerCase();
      if (!value) continue;
      if (!values.has(value)) values.set(value, []);
      values.get(value).push(page.route);
    }
    for (const routes of values.values()) if (routes.length > 1) errors.push({ type: group[0], page: routes[0], detail: routes.join(', ') });
  }

  const articles = pages.filter(p => p.isArticle && !p.robots.includes('noindex'));
  for (const article of articles) {
    if (!article.robots || !article.robots.includes('index') || article.robots.includes('noindex')) errors.push({ type: 'article-robots', page: article.route, detail: article.robots || 'missing' });
    if (!article.body || article.body.split(/\s+/).length < 150) warnings.push({ type: 'thin-article', page: article.route, detail: `${article.body.split(/\s+/).length} words` });
    if (!(incoming.get(article.route)?.size)) errors.push({ type: 'orphan-article', page: article.route, detail: 'no internal links' });
    if (/<\/html>[\s\S]*\S/i.test(article.html)) errors.push({ type: 'post-document-content', page: article.route, detail: 'content exists after </html>' });
    if (/name=["']notavello:published_at["']/i.test(article.html) && /class=["']post-nav/i.test(article.html)) {
      warnings.push({ type: 'template-pattern', page: article.route, detail: 'generated-post metadata and shared locked layout; editorial review only' });
    }
    const topicText = `${article.title} ${article.description}`.toLowerCase();
    const coreTopic = /\b(ai|artificial intelligence|software|developer|coding|computer|browser|web|internet|github|cloud|robot|app|digital|data|privacy|cyber|display|usb|operating system|iphone|android|google|openai|anthropic|claude|chatgpt|gemini|copilot|perplexity)\b/;
    if (!coreTopic.test(topicText)) warnings.push({ type: 'topic-review', page: article.route, detail: 'title/description lacks a clear AI, software, or computing connection' });
  }

  const sets = articles.map(a => tokenSet(a.body));
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const score = similarity(sets[i], sets[j]);
      if (score >= 0.82) warnings.push({ type: 'similar-articles', page: articles[i].route, detail: `${articles[j].route} (${score.toFixed(2)})` });
    }
  }

  return { generatedAt: new Date().toISOString(), pages, indexable, articles, errors, warnings, incoming, robotsText, sitemap };
}

function writeReports(result) {
  const dir = path.join(ROOT, 'reports', 'seo');
  fs.mkdirSync(dir, { recursive: true });
  const compact = {
    generatedAt: result.generatedAt,
    totals: { pages: result.pages.length, indexable: result.indexable.length, articles: result.articles.length, sitemap: result.sitemap.length, errors: result.errors.length, warnings: result.warnings.length },
    errors: result.errors,
    warnings: result.warnings,
    pages: result.pages.map(p => ({ route: p.route, file: p.rel, title: p.title, description: p.description, canonical: p.canonical, robots: p.robots, inSitemap: result.sitemap.includes(ORIGIN + p.route), incomingLinks: result.incoming.get(p.route)?.size || 0, lastmod: gitDate(p), bodyWords: p.body.split(/\s+/).filter(Boolean).length })),
  };
  fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(compact, null, 2) + '\n');
  const contentIssues = result.warnings.filter(i => ['thin-article', 'similar-articles', 'template-pattern', 'topic-review'].includes(i.type));
  const lines = ['# SEO content review candidates', '', 'Generated by `npm run seo:audit`. These are heuristic review flags, not instructions to rewrite or remove content.', ''];
  if (!contentIssues.length) lines.push('No articles crossed the current thin/similarity thresholds.');
  for (const issue of contentIssues) lines.push(`- **${issue.type}**: \`${issue.page}\` — ${issue.detail}`);
  lines.push('', 'Editorial checks still required: repetitive structure, programmatic tone, topical disconnect, factual currency, and usefulness relative to competing pages.', '');
  fs.writeFileSync(path.join(dir, 'content-review.md'), lines.join('\n'));
}

async function liveAudit(result, baseUrl) {
  const failures = [];
  const jobs = result.indexable.flatMap(page => ['notavello-seo-audit/1.0', 'Googlebot'].map(userAgent => ({ page, userAgent })));
  async function check({ page, userAgent }) {
      const target = new URL(page.route, baseUrl).href;
      try {
        const response = await fetch(target, { redirect: 'manual', headers: { 'user-agent': userAgent } });
        const html = await response.text();
        const renderedText = stripHtml(html).toLowerCase();
        const titleNeedle = page.title.toLowerCase().slice(0, 60);
        if (response.status !== 200) failures.push({ type: 'live-status', page: target, detail: `${userAgent}: ${response.status}` });
        if (page.isArticle && (!renderedText.includes(titleNeedle) || renderedText.length < 500)) failures.push({ type: 'live-rendering', page: target, detail: `${userAgent}: article content absent/short` });
      } catch (error) { failures.push({ type: 'live-fetch', page: target, detail: error.message }); }
  }
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(check));
  }
  const file = path.join(ROOT, 'reports', 'seo', 'live-audit.json');
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, checked: result.indexable.length * 2, failures }, null, 2) + '\n');
  return failures;
}

async function main() {
  const result = audit();
  writeReports(result);
  let failures = [...result.errors];
  const liveIndex = process.argv.indexOf('--live');
  if (liveIndex !== -1) failures = failures.concat(await liveAudit(result, process.argv[liveIndex + 1] || ORIGIN));
  console.log(`SEO audit: ${result.pages.length} pages, ${result.articles.length} articles, ${result.sitemap.length} sitemap URLs, ${failures.length} errors, ${result.warnings.length} review flags.`);
  for (const failure of failures.slice(0, 50)) console.error(`ERROR ${failure.type}: ${failure.page} (${failure.detail})`);
  if (failures.length > 50) console.error(`...and ${failures.length - 50} more errors; see reports/seo/audit.json`);
  if (process.argv.includes('--check') && failures.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { audit, gitDate, ORIGIN };
