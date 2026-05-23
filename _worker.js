// =============================================================
// _worker.js — Notavello Pages Worker
// Place this file in the ROOT of your GitHub repo.
// Cloudflare Pages runs this automatically on every request.
//
// What this does:
//   GET requests  → injects _header.html + _footer.html into pages
//   POST requests → forwards to notavello-worker (existing Worker)
//
// Your existing notavello-worker.mikekoga.workers.dev is untouched.
// Stripe, speaker validation, checkout all still go there.
// =============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ─────────────────────────────────────────────
    // Forward all POST requests to existing Worker
    // (Stripe webhook, checkout, speaker validation)
    // ─────────────────────────────────────────────
    if (request.method === 'POST' || request.method === 'OPTIONS') {
      return fetch(
        'https://notavello-worker.mikekoga.workers.dev' + url.pathname,
        request
      );
    }

    // ─────────────────────────────────────────────
    // Serve partial files as-is (no injection)
    // ─────────────────────────────────────────────
    if (
      url.pathname === '/_header.html' ||
      url.pathname === '/_footer.html' ||
      url.pathname === '/_worker.js'
    ) {
      return fetch(request);
    }

    // ─────────────────────────────────────────────
    // GET requests — inject header + footer
    // ─────────────────────────────────────────────
    try {
      const [pageRes, headerRes, footerRes] = await Promise.all([
        fetch(request),                                         // original page
        fetch('https://notavello.com/_header.html'),
        fetch('https://notavello.com/_footer.html'),
      ]);

      // If page not found or not HTML, pass through untouched
      const contentType = pageRes.headers.get('Content-Type') || '';
      if (!pageRes.ok || !contentType.includes('text/html')) {
        return pageRes;
      }

      let html    = await pageRes.text();
      const header = await headerRes.text();
      const footer = await footerRes.text();

      // Only replace if placeholders exist — safe for pages not yet updated
      if (html.includes('<!--HEADER-->')) {
        html = html.replace('<!--HEADER-->', header);
      }
      if (html.includes('<!--FOOTER-->')) {
        html = html.replace('<!--FOOTER-->', footer);
      }

      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          'Cache-Control': 'public, max-age=60',
        },
      });

    } catch (err) {
      // If anything goes wrong, fall back to serving the original page
      return fetch(request);
    }
  }
};
