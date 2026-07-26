const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { htmlFiles, normalizeFooter } = require('./normalize-shared-footer');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const occurrences = (text, pattern) => [...text.matchAll(pattern)].length;

const exporters = [
  ['/exporters/chatgpt/', 'ChatGPT'],
  ['/exporters/claude/', 'Claude'],
  ['/exporters/gemini/', 'Gemini'],
  ['/exporters/copilot/', 'Microsoft Copilot'],
  ['/exporters/grok/', 'Grok'],
  ['/exporters/perplexity/', 'Perplexity'],
  ['/exporters/other/', 'Other AI'],
];

test('exporter hub has canonical metadata and each required destination once', () => {
  const html = read('exporters/index.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/notavello\.com\/exporters\/"\s*\/?>/);
  assert.match(html, /<meta name="robots" content="index, follow"\s*\/?>/);
  for (const [href, label] of exporters) {
    assert.equal(occurrences(html, new RegExp(`href="${href.replaceAll('/', '\\/')}"`, 'g')), 1, label);
    assert.match(html, new RegExp(`>${label}<|>${label}\\s*<`));
  }
  assert.equal(occurrences(html, /href="\/pages\/sample"/g), 1);
  assert.equal(occurrences(html, /href="\/tools\/"/g), 1);
  assert.doesNotMatch(html, /\binnerHTML\b/);
  assert.doesNotMatch(html, /<script\b[^>]*src="https?:\/\//i);
  assert.doesNotMatch(html, /<link\b[^>]*rel="stylesheet"[^>]*href="https?:\/\//i);
});

test('shared footer contains only the compact global navigation', () => {
  const html = read('_footer.html');
  assert.equal(occurrences(html, />Export AI Chats</g), 1);
  assert.equal(occurrences(html, />All Tools</g), 1);
  assert.match(html, /href="\/weather">Weather</);
  assert.match(html, /href="\/pages\/relay\/">Relay</);
  for (const label of ['FAQ', 'Privacy', 'Terms', 'Contact']) {
    assert.equal(occurrences(html, new RegExp(`>${label}<`, 'g')), 1);
  }
  for (const forbidden of ['Export PDF', 'Sample PDF', 'ChatGPT', 'Gemini', 'Copilot', 'Claude', 'Grok', 'Perplexity', 'Other AI']) {
    assert.doesNotMatch(html, new RegExp(`>${forbidden}<`));
  }
});

test('legacy footer normalization is idempotent and never nests footers', () => {
  const legacy = '<main>Page</main><footer class="site-footer"><a href="/">Old</a></footer><style>.site-footer { padding: 2rem; }</style>';
  const once = normalizeFooter(legacy);
  const twice = normalizeFooter(once);
  assert.equal(once, twice);
  assert.equal(occurrences(once, /<!--FOOTER-->/g), 1);
  assert.equal(occurrences(once, /<footer\b/g), 0);
});

test('every public HTML page uses at most one shared footer placeholder', () => {
  for (const file of htmlFiles()) {
    if (file === path.join(ROOT, '_footer.html')) continue;
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(occurrences(html, /<!--FOOTER-->/g) <= 1, path.relative(ROOT, file));
    assert.equal(occurrences(html, /<footer\b[^>]*\bsite-footer\b/gi), 0, path.relative(ROOT, file));
  }
});

test('sitemaps expose the exporter hub once without an index.html duplicate', () => {
  const human = read('pages/sitemap.html');
  const xml = read('sitemap.xml');
  assert.equal(occurrences(human, /href="\/exporters\/"/g), 1);
  assert.equal(occurrences(xml, /<loc>https:\/\/notavello\.com\/exporters\/<\/loc>/g), 1);
  assert.doesNotMatch(human, /\/exporters\/index\.html/);
  assert.doesNotMatch(xml, /\/exporters\/index\.html/);
  for (const [href] of exporters) assert.match(human, new RegExp(`href="${href.replaceAll('/', '\\/')}"`));
  assert.match(human, /href="\/pages\/sample"/);
});
