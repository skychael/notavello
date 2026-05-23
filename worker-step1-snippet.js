// ============================================================
// STEP 1 — Header/footer injection
// Add this at the TOP of your Worker fetch handler,
// BEFORE the existing route checks.
// ============================================================

if (request.method === 'GET') {
  const url = new URL(request.url);

  // Don't inject into the partial files themselves
  if (url.pathname === '/_header.html' || url.pathname === '/_footer.html') {
    return fetch(request);
  }

  // Fetch the requested page and the shared partials in parallel
  const [pageRes, headerRes, footerRes] = await Promise.all([
    fetch('https://notavello.com' + url.pathname),
    fetch('https://notavello.com/_header.html'),
    fetch('https://notavello.com/_footer.html'),
  ]);

  // If page not found, pass through as-is
  if (!pageRes.ok) return pageRes;

  let html    = await pageRes.text();
  const header = await headerRes.text();
  const footer = await footerRes.text();

  html = html.replace('<!--HEADER-->', header);
  html = html.replace('<!--FOOTER-->', footer);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=60', // 1-minute cache — refresh fast on updates
    },
  });
}

// ============================================================
// Your existing POST routes follow below — do not change them.
// ============================================================
