const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'reports']);
const FOOTER_PATTERN = /<footer\b[^>]*class=["'][^"']*\bsite-footer\b[^"']*["'][^>]*>[\s\S]*?<\/footer>\s*(?:<style>\s*[\s\S]*?\.site-footer[\s\S]*?<\/style>\s*)?/i;

function htmlFiles(directory = ROOT) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.html') ? [absolute] : [];
  });
}

function normalizeFooter(html) {
  if (html.includes('<!--FOOTER-->')) return html;
  return FOOTER_PATTERN.test(html)
    ? html.replace(FOOTER_PATTERN, '<!--FOOTER-->\n')
    : html;
}

function main() {
  let changed = 0;

  for (const file of htmlFiles()) {
    if (file === path.join(ROOT, '_footer.html')) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = normalizeFooter(before);
    if (after === before) continue;
    fs.writeFileSync(file, after);
    changed += 1;
  }

  console.log(`Normalized ${changed} page${changed === 1 ? '' : 's'} to the shared footer placeholder.`);
}

if (require.main === module) main();

module.exports = { FOOTER_PATTERN, htmlFiles, normalizeFooter };
