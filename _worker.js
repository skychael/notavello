// =============================================================
// _worker.js — Notavello Pages Worker
// Place this file in the ROOT of your GitHub repo.
// Cloudflare Pages runs this automatically on every request.
//
// Uses env.ASSETS to fetch static files directly —
// avoids the self-referencing loop that causes Error 1000.
// =============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ─────────────────────────────────────────────
    // Serve partial files and non-HTML assets as-is
    // ─────────────────────────────────────────────
    if (
      url.pathname === '/_header.html' ||
      url.pathname === '/_footer.html' ||
      url.pathname === '/_worker.js' ||
      url.pathname.match(/\.(js|css|xml|txt|ico|png|jpg|svg|woff|woff2)$/)
    ) {
      return env.ASSETS.fetch(request);
    }

    // ─────────────────────────────────────────────
    // Forward POST and OPTIONS to existing Worker
    // (Stripe webhook, checkout, speaker validation)
    // ─────────────────────────────────────────────
    if (request.method === 'POST' || request.method === 'OPTIONS') {
      return fetch(
        'https://notavello-worker.mikekoga.workers.dev' + url.pathname,
        request
      );
    }

    // ─────────────────────────────────────────────
    // GET requests — inject header + footer
    // Uses env.ASSETS to read files directly (no HTTP loop)
    // ─────────────────────────────────────────────
    try {
      const [pageRes, headerRes, footerRes] = await Promise.all([
        env.ASSETS.fetch(request),
        env.ASSETS.fetch(new Request('https://notavello.com/_header.html')),
        env.ASSETS.fetch(new Request('https://notavello.com/_footer.html')),
      ]);

      // If page not found or not HTML, pass through untouched
      const contentType = pageRes.headers.get('Content-Type') || '';
      if (!pageRes.ok || !contentType.includes('text/html')) {
        return pageRes;
      }

      let html     = await pageRes.text();
      const header = await headerRes.text();
      const footer = await footerRes.text();

      // Only replace if placeholders exist
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
      // If anything goes wrong, serve the original page untouched
      return env.ASSETS.fetch(request);
    }
  }
};
