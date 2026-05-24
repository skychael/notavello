// Notavello Pages Worker
// Injects _header.html and _footer.html into every HTML page request.
// Uses env.ASSETS to read static files — never fetch() the live domain.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only process GET requests for HTML pages
    if (request.method !== 'GET') {
      return env.ASSETS.fetch(request);
    }

    // Only process paths that look like HTML pages (no file extension or .html)
    const path = url.pathname;
    const isHtmlRequest =
      path.endsWith('/') ||
      path.endsWith('.html') ||
      !path.includes('.');

    if (!isHtmlRequest) {
      return env.ASSETS.fetch(request);
    }

    // Fetch the requested page from assets
    const pageResponse = await env.ASSETS.fetch(request);

    // Only process successful HTML responses
    const contentType = pageResponse.headers.get('content-type') || '';
    if (!pageResponse.ok || !contentType.includes('text/html')) {
      return pageResponse;
    }

    let html = await pageResponse.text();

    // Only bother if the page actually has our placeholders
    if (!html.includes('<!--HEADER-->') && !html.includes('<!--FOOTER-->')) {
      return new Response(html, pageResponse);
    }

    // Fetch header and footer from assets (not HTTP — no Error 1000 loop)
    let header = '';
    let footer = '';

    try {
      const headerRes = await env.ASSETS.fetch(new Request(`${url.origin}/_header.html`));
      if (headerRes.ok) header = await headerRes.text();
    } catch (e) {}

    try {
      const footerRes = await env.ASSETS.fetch(new Request(`${url.origin}/_footer.html`));
      if (footerRes.ok) footer = await footerRes.text();
    } catch (e) {}

    // Replace placeholders
    if (header) html = html.replace('<!--HEADER-->', header);
    if (footer) html = html.replace('<!--FOOTER-->', footer);

    // Return with original headers preserved
    const newHeaders = new Headers(pageResponse.headers);
    newHeaders.set('content-type', 'text/html; charset=utf-8');

    return new Response(html, {
      status: pageResponse.status,
      headers: newHeaders,
    });
  }
};
