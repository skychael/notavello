// .github/scripts/generate-sitemap.js
//
// Scans the repo for pages and writes sitemap.xml at the repo root.
// No external dependencies — just plain Node. Run automatically by
// .github/workflows/generate-sitemap.yml on every push to main.
//
// HOW IT DECIDES WHAT'S A PAGE:
//   - Every index.html in the repo becomes a URL (e.g. exporters/claude/index.html -> /exporters/claude/)
//   - Folders in EXCLUDE_DIRS are skipped entirely (tooling / internal / CMS)
//   - Standalone .html pages that aren't named index.html are listed in EXTRA_PAGES
//   - Everything else (partials like _header.html, 404.html, images, etc.) is ignored

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE = 'https://notavello.com';

// Folders that should NEVER appear in the sitemap.
const EXCLUDE_DIRS = new Set([
  '.git',
  '.github',
  'node_modules',
  'admin',     // Decap CMS, not a public page
  'versions',  // changelog / internal
]);

// Standalone .html pages that are real pages but aren't named index.html.
// Map:  file path in repo  ->  clean URL path on the live site.
const EXTRA_PAGES = {
  'login.html': '/login/',
};

const root = process.cwd();
const pages = [];

// Walk the tree collecting index.html files.
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.name === 'index.html') {
      const rel = path.relative(root, path.join(dir, entry.name));
      pages.push({ file: rel, url: fileToUrl(rel) });
    }
  }
}

// exporters/claude/index.html  ->  /exporters/claude/
// index.html (root)            ->  /
function fileToUrl(rel) {
  let p = rel.replace(/\\/g, '/').replace(/index\.html$/, '');
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

// Last git commit date for a file as YYYY-MM-DD. Falls back to today.
function lastmod(file) {
  try {
    const d = execSync(`git log -1 --format=%cs -- "${file}"`, { encoding: 'utf8' }).trim();
    return d || today();
  } catch {
    return today();
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

walk(root);

// Add explicit standalone pages (only if the file actually exists).
for (const [file, url] of Object.entries(EXTRA_PAGES)) {
  if (fs.existsSync(path.join(root, file))) {
    pages.push({ file, url });
  }
}

// Stable order: homepage first, then alphabetical. Keeps diffs clean.
pages.sort((a, b) => {
  if (a.url === '/') return -1;
  if (b.url === '/') return 1;
  return a.url.localeCompare(b.url);
});

// Build the XML.
const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '',
];
for (const { file, url } of pages) {
  lines.push('  <url>');
  lines.push(`    <loc>${SITE}${url}</loc>`);
  lines.push(`    <lastmod>${lastmod(file)}</lastmod>`);
  lines.push('  </url>');
  lines.push('');
}
lines.push('</urlset>');
lines.push('');

fs.writeFileSync(path.join(root, 'sitemap.xml'), lines.join('\n'));
console.log(`Wrote sitemap.xml with ${pages.length} URLs.`);
