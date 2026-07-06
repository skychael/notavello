#!/usr/bin/env node
/*
  Notavello safe blog splitter v6
  --------------------------------
  Goal:
  - Preserve the existing Notavello blog design from pages/blog/index.html
  - Scan actual post folders in pages/blog/
  - Reuse existing card HTML when possible
  - Generate missing cards from each post's index.html metadata
  - Split the list into pages/blog/index.html, pages/blog/page-2/index.html, etc.
  - Regenerate the title-only All Posts archive list in
    pages/blog/all-posts/index.html (list contents only -- the page shell,
    styles, and nav in that file are hand-editable and never touched)

  No local backups are made: git history is the safety net. If a run goes
  wrong, restore with git (e.g. git checkout -- pages/blog/) before committing.

  Safe first run:
    node blog-automation\split-blog-index.js --dry-run

  Write files:
    node blog-automation\split-blog-index.js --write
*/

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const BLOG_DIR = path.join(ROOT, 'pages', 'blog');
const BLOG_INDEX = path.join(BLOG_DIR, 'index.html');
const ALL_POSTS_PATH = path.join(BLOG_DIR, 'all-posts', 'index.html');
const PER_PAGE = 18;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || !args.has('--write');
const WRITE = args.has('--write');

function fail(message) {
  console.error('\nERROR: ' + message);
  process.exit(1);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function decodeBasicHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value) {
  return decodeBasicHtml(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function getAttribute(tagHtml, attrName) {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const match = tagHtml.match(pattern);
  return match ? decodeBasicHtml(match[2].trim()) : '';
}

function getMeta(html, nameOrProperty) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of metaTags) {
    const name = getAttribute(tag, 'name');
    const property = getAttribute(tag, 'property');
    if (name.toLowerCase() === nameOrProperty.toLowerCase() || property.toLowerCase() === nameOrProperty.toLowerCase()) {
      return getAttribute(tag, 'content');
    }
  }

  return '';
}

function getFirstMatch(html, regex) {
  const match = html.match(regex);
  return match ? stripTags(match[1]) : '';
}

function slugFromHref(href) {
  const clean = href.replace(/https?:\/\/[^/]+/i, '').split('#')[0].split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function parseDateToTime(dateText) {
  if (!dateText) return 0;
  const cleaned = decodeBasicHtml(dateText).replace(/\s+/g, ' ').trim();
  const time = Date.parse(cleaned);
  if (!Number.isNaN(time)) return time;

  const monthNames = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  const m = cleaned.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/);
  if (m) {
    const month = monthNames[m[1].toLowerCase()];
    if (month !== undefined) return Date.UTC(Number(m[3]), month, Number(m[2]));
  }
  return 0;
}

function hasTimeComponent(dateText) {
  const value = decodeBasicHtml(dateText || '').trim();
  if (!value) return false;
  // ISO datetimes contain T10:17 or a space before HH:MM. Human visible dates
  // like "July 6, 2026" intentionally do not count as precise timestamps.
  return /(?:T|\s)\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/.test(value);
}

function getDateKey(time) {
  if (!time) return '';
  return new Date(time).toISOString().slice(0, 10);
}

function getJsonLdValue(html, key) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script
      .replace(/^<script\b[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === 'object' && item[key]) return String(item[key]);
        if (item && item['@graph'] && Array.isArray(item['@graph'])) {
          const graphMatch = item['@graph'].find(node => node && typeof node === 'object' && node[key]);
          if (graphMatch) return String(graphMatch[key]);
        }
      }
    } catch (_) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fallback = body.match(new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']+)["']`, 'i'));
      if (fallback) return fallback[1];
    }
  }
  return '';
}

function formatDate(input) {
  if (!input) return '';
  const time = parseDateToTime(input);
  if (!time) return input;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(time));
}

function readExistingBlogIndexPages(firstPageHtml) {
  const pages = [firstPageHtml];

  for (let page = 2; page < 1000; page++) {
    const pagePath = path.join(BLOG_DIR, `page-${page}`, 'index.html');
    if (!fs.existsSync(pagePath)) break;
    pages.push(readText(pagePath));
  }

  return pages;
}

function extractExistingCards(indexPagesHtml) {
  const cards = new Map();
  const cardRegex = /<a\s+class=["']post-card["'][\s\S]*?<\/a>/gi;
  const pages = Array.isArray(indexPagesHtml) ? indexPagesHtml : [indexPagesHtml];
  let order = 0;

  for (const pageHtml of pages) {
    const matches = pageHtml.match(cardRegex) || [];
    for (const html of matches) {
      const hrefMatch = html.match(/href=["']([^"']+)["']/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      const slug = slugFromHref(href);
      if (!slug) continue;
      const title = getFirstMatch(html, /<div\s+class=["']post-card-title["']>([\s\S]*?)<\/div>/i);
      const desc = getFirstMatch(html, /<div\s+class=["']post-card-desc["']>([\s\S]*?)<\/div>/i);
      const tag = getFirstMatch(html, /<span\s+class=["']post-tag["']>([\s\S]*?)<\/span>/i);
      const date = getFirstMatch(html, /<span\s+class=["']post-date["']>([\s\S]*?)<\/span>/i);
      const openingTag = (html.match(/<a\b[^>]*>/i) || [''])[0];
      const publishedAt = getAttribute(openingTag, 'data-published-at');
      const timeSource = publishedAt || date;
      cards.set(slug, {
        slug,
        href,
        title,
        desc,
        tag,
        date,
        publishedAt,
        time: parseDateToTime(timeSource),
        hasPreciseTime: hasTimeComponent(timeSource),
        existingOrder: order,
        html: html.trim()
      });
      order += 1;
    }
  }

  return cards;
}

function extractPostMetadata(slug, postHtml, postIndexPath, existing) {
  const href = `/pages/blog/${slug}/`;

  let title =
    getMeta(postHtml, 'og:title') ||
    getMeta(postHtml, 'twitter:title') ||
    getFirstMatch(postHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    getFirstMatch(postHtml, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    slug.replace(/-/g, ' ');

  title = title
    .replace(/\s*[|—-]\s*Notavello\s*$/i, '')
    .replace(/^The Export\s*[|—-]\s*/i, '')
    .trim();

  let desc =
    getMeta(postHtml, 'description') ||
    getMeta(postHtml, 'og:description') ||
    getMeta(postHtml, 'twitter:description') ||
    getFirstMatch(postHtml, /<p[^>]*class=["'][^"']*(?:post-desc|article-desc|blog-desc|subtitle|dek)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
    getFirstMatch(postHtml, /<p[^>]*>([\s\S]*?)<\/p>/i) ||
    '';

  if (desc.length > 260) desc = desc.slice(0, 257).trim() + '...';

  let tag =
    getMeta(postHtml, 'article:section') ||
    getFirstMatch(postHtml, /<span[^>]*class=["'][^"']*(?:post-tag|tag|category)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    getFirstMatch(postHtml, /<a[^>]*class=["'][^"']*(?:post-tag|tag|category)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
    (existing && existing.tag) ||
    'Tech';

  const rawDate =
    getMeta(postHtml, 'notavello:published_at') ||
    getMeta(postHtml, 'article:published_time') ||
    getMeta(postHtml, 'date') ||
    getMeta(postHtml, 'publish_date') ||
    getJsonLdValue(postHtml, 'datePublished') ||
    getFirstMatch(postHtml, /<time[^>]*(?:datetime=["']([^"']+)["'])[^>]*>/i) ||
    getFirstMatch(postHtml, /<time[^>]*>([\s\S]*?)<\/time>/i) ||
    getFirstMatch(postHtml, /<span[^>]*class=["'][^"']*(?:post-date|date|published)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    findDateText(postHtml) ||
    (existing && (existing.publishedAt || existing.date)) ||
    '';

  const date = formatDate(rawDate);
  const time = parseDateToTime(rawDate) || (existing && existing.time) || 0;
  const hasPreciseTime = hasTimeComponent(rawDate) || Boolean(existing && existing.hasPreciseTime);
  const existingOrder = Number.isInteger(existing && existing.existingOrder) ? existing.existingOrder : Number.MAX_SAFE_INTEGER;

  return { slug, href, title, desc, tag, date, publishedAt: rawDate, time, hasPreciseTime, existingOrder };
}

function findDateText(html) {
  const text = stripTags(html);
  const match = text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/);
  return match ? match[0] : '';
}

function makeCardHtml(post) {
  const publishedAttr = post.publishedAt ? ` data-published-at="${escapeHtml(post.publishedAt)}"` : '';
  return `<a class="post-card" href="${escapeHtml(post.href)}"${publishedAttr}>
<div class="post-card-meta">
<span class="post-tag">${escapeHtml(post.tag || 'Tech')}</span>
<span class="post-date">${escapeHtml(post.date || '')}</span>
</div>
<div class="post-card-title">${escapeHtml(post.title)}</div>
<div class="post-card-desc">${escapeHtml(post.desc || '')}</div>
<span class="post-card-read">Read article →</span>
</a>`;
}

function shouldIgnoreDir(name) {
  const lower = name.toLowerCase();
  if (lower.startsWith('_')) return true;
  if (lower.startsWith('draft-')) return true;
  if (lower === 'drafts') return true;
  if (lower === 'topics') return true;
  if (lower === 'archive') return true;
  if (lower === 'all-posts') return true;
  if (lower === 'assets') return true;
  if (lower === 'css') return true;
  if (lower === 'js') return true;
  if (/^page-\d+$/.test(lower)) return true;
  return false;
}

function scanPostFolders(existingCards) {
  const entries = fs.readdirSync(BLOG_DIR, { withFileTypes: true });
  const posts = [];
  const ignored = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (shouldIgnoreDir(slug)) {
      ignored.push(slug);
      continue;
    }

    const postIndex = path.join(BLOG_DIR, slug, 'index.html');
    if (!fs.existsSync(postIndex)) {
      ignored.push(slug + ' (no index.html)');
      continue;
    }

    const existing = existingCards.get(slug);
    const postHtml = readText(postIndex);
    const meta = extractPostMetadata(slug, postHtml, postIndex, existing);
    posts.push({ ...meta, html: existing ? existing.html : makeCardHtml(meta), usedExistingCard: Boolean(existing) });
  }

  posts.sort((a, b) => {
    // Primary sort: newest real publish timestamp first. Generated posts now
    // include this timestamp in their HTML, so future same-day posts rise to
    // the top instead of sorting by title.
    if (b.time !== a.time) return b.time - a.time;

    // If both posts are date-only entries from the existing index, keep their
    // current relative order. This avoids reshuffling old same-day posts when
    // git checkout/pull changes filesystem modified times.
    if (a.existingOrder !== b.existingOrder) return a.existingOrder - b.existingOrder;

    // Final deterministic fallback for brand-new legacy/malformed posts only.
    return a.title.localeCompare(b.title);
  });

  return { posts, ignored };
}

function findMatchingPostListClose(indexHtml, openEnd) {
  // Start immediately after <div class="post-list">.
  // Count nested <div> tags so card internals do not confuse us.
  let depth = 1;
  const divTag = /<\/?div\b[^>]*>/gi;
  divTag.lastIndex = openEnd;

  let match;
  while ((match = divTag.exec(indexHtml)) !== null) {
    const tag = match[0].toLowerCase();
    if (tag.startsWith('</div')) {
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }

  return -1;
}

function getPostListParts(indexHtml) {
  const startMatch = indexHtml.match(/<div\s+class=["']post-list["']\s*>/i);
  if (!startMatch || startMatch.index === undefined) {
    fail('Could not find <div class="post-list"> in pages/blog/index.html');
  }

  const openEnd = startMatch.index + startMatch[0].length;
  const before = indexHtml.slice(0, openEnd);

  const closeIndex = findMatchingPostListClose(indexHtml, openEnd);
  if (closeIndex !== -1) {
    const after = indexHtml.slice(closeIndex);
    return { before, after };
  }

  // Last-resort safety path: some existing index files are valid enough for a
  // browser to display, but are missing the final closing tags. In that case,
  // keep the real Notavello head/style/header and create a clean ending.
  console.log('\nWARNING: Could not find a closing </div> for .post-list. v6 will add clean closing tags.');
  return { before, after: '\n</div>\n</main>\n</body>\n</html>\n' };
}

function injectPaginationCss(html) {
  if (html.includes('.blog-pagination')) return html;
  const css = `
.blog-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
.blog-pagination a, .blog-pagination span { font-size: 0.78rem; font-weight: 600; text-decoration: none; border: 1px solid var(--border); background: var(--surface); color: var(--ink-muted); border-radius: 999px; padding: 9px 14px; }
.blog-pagination a:hover { color: var(--accent); border-color: rgba(79,70,229,0.30); background: var(--accent-light); }
.blog-pagination .current-page { color: var(--accent); background: var(--accent-light); border-color: rgba(79,70,229,0.22); }
`;
  return html.replace('</style>', css + '</style>');
}

function paginationHtml(page, totalPages) {
  if (totalPages <= 1) return '';
  const newer = page > 1
    ? `<a href="${page === 2 ? '/pages/blog/' : `/pages/blog/page-${page - 1}/`}">← Newer posts</a>`
    : `<span aria-hidden="true">&nbsp;</span>`;
  const older = page < totalPages
    ? `<a href="/pages/blog/page-${page + 1}/">Older posts →</a>`
    : `<span aria-hidden="true">&nbsp;</span>`;

  return `<nav class="blog-pagination" aria-label="Blog pages">
${newer}
<span class="current-page">Page ${page} of ${totalPages}</span>
${older}
</nav>`;
}

// --- All Posts archive (title-only list at /pages/blog/all-posts/) ---------
// The all-posts/index.html file is the SHELL: its head, styles, nav, and
// footer are Mike's to edit freely and are never touched here. This script
// owns ONLY the contents of <ul class="all-posts-list"> and regenerates that
// list (every post, newest first, short dates) on each --write run.

function shortDate(post) {
  if (post.time) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(post.time));
  }
  return post.date || '';
}

function buildAllPostsHtml(posts) {
  if (!fs.existsSync(ALL_POSTS_PATH)) {
    console.log('\nNOTE: pages/blog/all-posts/index.html not found. Skipping the All Posts archive.');
    console.log('      Create that page once and this script will keep its list updated automatically.');
    return null;
  }

  const shell = readText(ALL_POSTS_PATH);

  // Anchor on the opening tag followed by a line break so a mention of the
  // tag inside an HTML comment can never match (that exact false match once
  // destroyed a page head during manual editing -- do not loosen this).
  const listRegex = /(<ul\s+class=["']all-posts-list["']\s*>)\s*?\n[\s\S]*?(\n\s*<\/ul>)/i;
  if (!listRegex.test(shell)) {
    console.log('\nWARNING: Could not find the all-posts list <ul> in all-posts/index.html. Archive NOT updated.');
    return null;
  }

  const items = posts.map(p =>
    `    <li><a href="${escapeHtml(p.href)}"><span>${escapeHtml(p.title)}</span><span class="all-posts-date">${escapeHtml(shortDate(p))}</span></a></li>`
  ).join('\n');

  // Replacer FUNCTION, not a replacement string: post titles can contain
  // dollar amounts ("$2 an hour", "$135 debut"), and in a replacement string
  // "$1"/"$2" are backreferences that silently inject the captured tags into
  // the output. A function's return value is always literal.
  return shell.replace(listRegex, (m, open, close) => `${open}\n${items}${close}`);
}

function updatePageMeta(html, page, totalPages) {
  const url = page === 1 ? 'https://notavello.com/pages/blog/' : `https://notavello.com/pages/blog/page-${page}/`;
  const title = page === 1
    ? 'The Export — AI Tips & Insights | Notavello'
    : `The Export — Page ${page} | Notavello`;
  const desc = page === 1
    ? 'Honest tips, hidden quirks, and practical insights about AI tools — from the people who use them all day.'
    : `Older Notavello posts from The Export, page ${page} of ${totalPages}.`;

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta\s+content=["'][^"']*["']\s+name=["']description["']\s*\/>/i, `<meta content="${escapeHtml(desc)}" name="description"/>`);
  html = html.replace(/<link\s+href=["'][^"']*["']\s+rel=["']canonical["']\s*\/>/i, `<link href="${url}" rel="canonical"/>`);
  html = html.replace(/<meta\s+content=["'][^"']*["']\s+property=["']og:url["']\s*\/>/i, `<meta content="${url}" property="og:url"/>`);
  html = html.replace(/<meta\s+content=["'][^"']*["']\s+property=["']og:title["']\s*\/>/i, `<meta content="${escapeHtml(title)}" property="og:title"/>`);
  html = html.replace(/<meta\s+content=["'][^"']*["']\s+property=["']og:description["']\s*\/>/i, `<meta content="${escapeHtml(desc)}" property="og:description"/>`);
  html = html.replace(/<meta\s+content=["'][^"']*["']\s+name=["']twitter:title["']\s*\/>/i, `<meta content="${escapeHtml(title)}" name="twitter:title"/>`);

  return html;
}

function makePage(indexHtml, postsForPage, page, totalPages) {
  let shell = injectPaginationCss(indexHtml);
  shell = updatePageMeta(shell, page, totalPages);
  const parts = getPostListParts(shell);
  const cards = postsForPage.map(p => p.html.trim()).join('\n\n');
  return `${parts.before}\n\n${cards}\n\n${paginationHtml(page, totalPages)}\n${parts.after}`;
}

function main() {
  if (!fs.existsSync(BLOG_DIR)) fail('Missing pages/blog folder. Run this from C:\\Dev\\apps\\notavello.');
  if (!fs.existsSync(BLOG_INDEX)) fail('Missing pages/blog/index.html.');

  const indexHtml = readText(BLOG_INDEX);
  const existingCards = extractExistingCards(readExistingBlogIndexPages(indexHtml));
  const { posts, ignored } = scanPostFolders(existingCards);
  const totalPages = Math.max(1, Math.ceil(posts.length / PER_PAGE));

  console.log('\nNotavello safe blog splitter v6');
  console.log('--------------------------------');
  console.log('Blog folder: pages\\blog');
  console.log(`Existing cards in current index: ${existingCards.size}`);
  console.log(`Post folders found: ${posts.length}`);
  console.log(`Cards per page: ${PER_PAGE}`);
  console.log(`Index pages needed: ${totalPages}`);
  console.log(`Reused existing card HTML: ${posts.filter(p => p.usedExistingCard).length}`);
  console.log(`Generated missing card HTML: ${posts.filter(p => !p.usedExistingCard).length}`);

  if (ignored.length) {
    console.log(`Ignored folders: ${ignored.length}`);
  }

  for (let i = 0; i < totalPages; i++) {
    const pagePosts = posts.slice(i * PER_PAGE, (i + 1) * PER_PAGE);
    console.log(`\nPage ${i + 1}:`);
    for (const post of pagePosts) {
      const marker = post.usedExistingCard ? ' ' : '*';
      console.log(` ${marker} ${post.date || 'No date'} | ${post.slug} | ${post.title}`);
    }
  }

  const missing = posts.filter(p => !p.usedExistingCard);
  if (missing.length) {
    console.log('\n* = card did not exist in current index, so v5 generated it from the post page metadata.');
  }

  if (DRY_RUN && !WRITE) {
    console.log(`\nAll Posts archive: ${fs.existsSync(ALL_POSTS_PATH) ? 'would update ' + posts.length + '-entry list in pages/blog/all-posts/index.html' : 'pages/blog/all-posts/index.html not found - would skip'}`);
    console.log('\nDry run only. Nothing changed.');
    console.log('To write the pages, run:');
    console.log('  node blog-automation\\split-blog-index.js --write');
    return;
  }

  console.log('\nWriting blog index pages...');

  for (let i = 0; i < totalPages; i++) {
    const page = i + 1;
    const pagePosts = posts.slice(i * PER_PAGE, (i + 1) * PER_PAGE);
    const pageHtml = makePage(indexHtml, pagePosts, page, totalPages);
    const outPath = page === 1 ? BLOG_INDEX : path.join(BLOG_DIR, `page-${page}`, 'index.html');
    writeText(outPath, pageHtml);
    console.log('  wrote: ' + path.relative(ROOT, outPath));
  }

  const allPostsHtml = buildAllPostsHtml(posts);
  if (allPostsHtml) {
    writeText(ALL_POSTS_PATH, allPostsHtml);
    console.log('  wrote: ' + path.relative(ROOT, ALL_POSTS_PATH) + ` (${posts.length} titles)`);
  }

  console.log('\nDone.');
  console.log('Open pages/blog/index.html in your browser and check it before committing.');
}

main();
