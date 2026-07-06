// Notavello Pages Worker
// Injects _header.html and _footer.html into every HTML page request.
// Uses env.ASSETS to read static files — never fetch() the live domain.

const BLOG_GENERATOR_RATE_LIMIT = new Map();

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < max; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }

  return diff === 0;
}

function getClientKey(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    'unknown'
  ).split(',')[0].trim();
}

function checkRateLimit(request) {
  const key = getClientKey(request);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxAttempts = 5;
  const bucket = BLOG_GENERATOR_RATE_LIMIT.get(key) || { count: 0, resetAt: now + windowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  BLOG_GENERATOR_RATE_LIMIT.set(key, bucket);

  // Opportunistic cleanup. Worker memory is best-effort, but this prevents
  // unbounded growth within a warm isolate.
  if (BLOG_GENERATOR_RATE_LIMIT.size > 500) {
    for (const [bucketKey, value] of BLOG_GENERATOR_RATE_LIMIT.entries()) {
      if (value.resetAt <= now) BLOG_GENERATOR_RATE_LIMIT.delete(bucketKey);
    }
  }

  return bucket.count <= maxAttempts;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}

function getProvidedAdminSecret(request, body) {
  const auth = request.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return (
    request.headers.get('x-notavello-admin-token') ||
    request.headers.get('x-admin-token') ||
    (body && (body.admin_token || body.password)) ||
    ''
  );
}

function normalizeBlogGeneratorPayload(body) {
  const topic = String((body && body.topic) || '').trim();
  const sourceContext = String((body && body.source_context) || '').trim();
  const dryRunValue = body ? body.dry_run : undefined;
  const dryRun = dryRunValue === undefined ? true : !(dryRunValue === false || dryRunValue === 'false');

  if (topic.length > 200) {
    return { error: 'Topic must be 200 characters or fewer.' };
  }

  if (sourceContext.length > 12000) {
    return { error: 'Source/context must be 12,000 characters or fewer.' };
  }

  return { topic, sourceContext, dryRun };
}

async function handleGenerateBlog(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Use POST.' }, 405);
  }

  if (!checkRateLimit(request)) {
    return jsonResponse({ ok: false, error: 'Too many requests. Try again shortly.' }, 429);
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return jsonResponse({ ok: false, error: 'Request body must be valid JSON.' }, 400);
  }

  const expectedAdminSecret =
    env.BLOG_GENERATOR_ADMIN_TOKEN ||
    env.BLOG_GENERATOR_PASSWORD ||
    env.ADMIN_TOKEN ||
    env.ADMIN_PASSWORD ||
    '';

  if (!expectedAdminSecret) {
    return jsonResponse({ ok: false, error: 'Blog generator admin secret is not configured.' }, 500);
  }

  const providedAdminSecret = getProvidedAdminSecret(request, body);
  if (!safeEqual(providedAdminSecret, expectedAdminSecret)) {
    return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);
  }

  const payload = normalizeBlogGeneratorPayload(body);
  if (payload.error) {
    return jsonResponse({ ok: false, error: payload.error }, 400);
  }

  const githubToken =
    env.GITHUB_WORKFLOW_TOKEN ||
    env.GITHUB_ACTIONS_TOKEN ||
    env.GITHUB_TOKEN ||
    '';

  if (!githubToken) {
    return jsonResponse({ ok: false, error: 'GitHub workflow token is not configured.' }, 500);
  }

  const owner = env.GITHUB_REPO_OWNER || env.REPO_OWNER || 'skychael';
  const repo = env.GITHUB_REPO_NAME || env.REPO_NAME || 'notavello';
  const workflow = env.GITHUB_WORKFLOW_ID || env.GITHUB_WORKFLOW_FILE || 'generate-daily-post.yml';
  const ref = env.GITHUB_REF || env.GITHUB_BRANCH || 'main';

  const githubResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'content-type': 'application/json',
        'user-agent': 'notavello-blog-generator-worker',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        ref,
        inputs: {
          topic: payload.topic,
          source_context: payload.sourceContext,
          dry_run: payload.dryRun ? 'true' : 'false',
        },
      }),
    }
  );

  if (!githubResponse.ok) {
    const text = await githubResponse.text();
    return jsonResponse({
      ok: false,
      error: `GitHub workflow dispatch failed with HTTP ${githubResponse.status}.`,
      details: text.slice(0, 1000),
    }, 502);
  }

  return jsonResponse({
    ok: true,
    message: payload.dryRun
      ? 'Dry run started in GitHub Actions.'
      : 'Blog generation started in GitHub Actions.',
    dry_run: payload.dryRun,
  }, 202);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/generate-blog') {
      return handleGenerateBlog(request, env);
    }

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
