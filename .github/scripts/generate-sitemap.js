// Generate a stable sitemap from canonical, indexable repository pages.
// Eligibility and metadata parsing are shared with the SEO audit.

const fs = require('fs');
const path = require('path');
const { audit, gitDate, ORIGIN } = require('../../scripts/seo-audit');

const root = path.resolve(__dirname, '../..');
const result = audit();
const redirectSources = new Set(fs.readFileSync(path.join(root, '_redirects'), 'utf8').split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean).map(line => line.split(/\s+/)[0]));
const pages = result.pages
  .filter(page => !page.robots.includes('noindex'))
  .filter(page => !redirectSources.has(page.route))
  .filter(page => page.canonicals.length === 1 && page.canonical === ORIGIN + page.route)
  .sort((a, b) => {
    if (a.route === '/') return -1;
    if (b.route === '/') return 1;
    return a.route.localeCompare(b.route);
  });

const duplicateUrls = pages.filter((page, index) => pages.findIndex(other => other.canonical === page.canonical) !== index);
if (duplicateUrls.length) {
  throw new Error(`Duplicate canonical sitemap URLs: ${duplicateUrls.map(page => page.canonical).join(', ')}`);
}

const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
];

for (const page of pages) {
  lines.push('  <url>');
  lines.push(`    <loc>${page.canonical}</loc>`);
  const lastmod = gitDate(page);
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push('  </url>');
}

lines.push('</urlset>', '');
fs.writeFileSync(path.join(root, 'sitemap.xml'), lines.join('\n'));
console.log(`Wrote sitemap.xml with ${pages.length} canonical, indexable URLs.`);
