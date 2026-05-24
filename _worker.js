export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': 'https://notavello.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    // ─────────────────────────────────────────────
    // Route: AI speaker validation
    // ─────────────────────────────────────────────
    if (url.pathname === '/validate-speakers' && request.method === 'POST') {
      try {
        const { lines } = await request.json();

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: `You are checking speaker attribution in a parsed conversation.
Below are the first 20 lines, each labeled HUMAN or AI.
Reply with JSON only: { "ok": true } if attribution looks correct,
or { "ok": false, "fix": "brief reason" } if something looks wrong.

${lines.map((l, i) => `${i+1}. [${l.role.toUpperCase()}] ${l.text.substring(0, 80)}`).join('\n')}`
            }]
          })
        });

        const data = await response.json();
        const text = data.content?.[0]?.text || '{"ok":true}';
        const clean = text.replace(/```json|```/g, '').trim();
        const result = JSON.parse(clean);

        return json(result);

      } catch (err) {
        return json({ ok: true });
      }
    }

    // ─────────────────────────────────────────────
    // Route: Create Stripe checkout session
    // ─────────────────────────────────────────────
    if (url.pathname === '/create-checkout' && request.method === 'POST') {
      try {
        const body = new URLSearchParams({
          'mode': 'subscription',
          'line_items[0][price]': env.STRIPE_PRICE_ID,
          'line_items[0][quantity]': '1',
          'success_url': 'https://notavello.com/claude/?paid=true',
          'cancel_url': 'https://notavello.com/claude/?paid=cancelled',
          'customer_email': '',
        });

        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        const session = await response.json();

        if (!session.url) throw new Error('No checkout URL returned from Stripe');

        return json({ url: session.url });

      } catch (err) {
        return json({ error: 'Checkout failed' }, 500);
      }
    }

    // ─────────────────────────────────────────────
    // Route: Stripe webhook
    // Verifies signature, saves customer email to D1
    // ─────────────────────────────────────────────
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') {
      try {
        const rawBody = await request.text();
        const sig = request.headers.get('Stripe-Signature');

        const isValid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
        if (!isValid) {
          return new Response('Invalid signature', { status: 400 });
        }

        const event = JSON.parse(rawBody);

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const email = session.customer_details?.email;

          if (email) {
            await env.DB.prepare(
              'INSERT OR REPLACE INTO customers (email, plan, status, created) VALUES (?, ?, ?, ?)'
            ).bind(email, 'pro', 'active', new Date().toISOString()).run();
            console.log(`Customer saved to D1: ${email}`);
          }
        }

        return json({ received: true });

      } catch (err) {
        return new Response('Webhook error', { status: 400 });
      }
    }

    // ─────────────────────────────────────────────
    // Route: Send login code
    // POST { email } → generates 6-digit code,
    // saves to D1, sends via Resend
    // ─────────────────────────────────────────────
    if (url.pathname === '/send-code' && request.method === 'POST') {
      try {
        const { email } = await request.json();

        if (!email || !email.includes('@')) {
          return json({ ok: false, error: 'Invalid email' }, 400);
        }

        // Check this email is a paying customer
        const customer = await env.DB.prepare(
          'SELECT * FROM customers WHERE email = ? AND status = ?'
        ).bind(email, 'active').first();

        if (!customer) {
          return json({ ok: false, error: 'No active subscription found for that email.' });
        }

        // Generate 6-digit code, expires in 15 minutes
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        await env.DB.prepare(
          'INSERT OR REPLACE INTO login_codes (email, code, expires) VALUES (?, ?, ?)'
        ).bind(email, code, expires).run();

        // Send via Resend
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Notavello <hello@notavello.com>',
            to: email,
            subject: 'Your Notavello login code',
            text: `Your Notavello login code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`,
          }),
        });

        return json({ ok: true });

      } catch (err) {
        return json({ ok: false, error: 'Failed to send code. Please try again.' }, 500);
      }
    }

    // ─────────────────────────────────────────────
    // Route: Verify login code
    // POST { email, code } → validates code,
    // sets 90-day session cookie if valid
    // ─────────────────────────────────────────────
    if (url.pathname === '/verify-code' && request.method === 'POST') {
      try {
        const { email, code } = await request.json();

        const row = await env.DB.prepare(
          'SELECT * FROM login_codes WHERE email = ? AND code = ?'
        ).bind(email, code).first();

        if (!row) {
          return json({ ok: false, error: 'Invalid code.' });
        }

        if (new Date(row.expires) < new Date()) {
          return json({ ok: false, error: 'Code has expired. Please request a new one.' });
        }

        const customer = await env.DB.prepare(
          'SELECT * FROM customers WHERE email = ? AND status = ?'
        ).bind(email, 'active').first();

        if (!customer) {
          return json({ ok: false, error: 'No active subscription found.' });
        }

        // Delete used code
        await env.DB.prepare(
          'DELETE FROM login_codes WHERE email = ?'
        ).bind(email).run();

        // Set 90-day session cookie
        const cookie = `notavello_session=${email}; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 24 * 60 * 60}; Domain=notavello.com; Path=/`;

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Set-Cookie': cookie,
          },
        });

      } catch (err) {
        return json({ ok: false, error: 'Verification failed. Please try again.' }, 500);
      }
    }

    // ─────────────────────────────────────────────
    // Route: Check access
    // GET → reads session cookie, checks D1,
    // returns { ok: true/false }
    // ─────────────────────────────────────────────
    if (url.pathname === '/check-access' && request.method === 'POST') {
      try {
        const cookie = request.headers.get('Cookie') || '';
        const match = cookie.match(/notavello_session=([^;]+)/);

        if (!match) return json({ ok: false });

        const email = match[1];
        const customer = await env.DB.prepare(
          'SELECT * FROM customers WHERE email = ? AND status = ?'
        ).bind(email, 'active').first();

        return json({ ok: !!customer });

      } catch (err) {
        return json({ ok: false });
      }
    }

    return new Response('Notavello Worker running.', { headers: corsHeaders });
  }
};

// ─────────────────────────────────────────────
// Stripe webhook signature verification
// ─────────────────────────────────────────────
async function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    const parts = sigHeader.split(',').reduce((acc, part) => {
      const [k, v] = part.split('=');
      acc[k.trim()] = v.trim();
      return acc;
    }, {});

    const timestamp = parts['t'];
    const signature = parts['v1'];
    const signed = `${timestamp}.${payload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
    const expected = Array.from(new Uint8Array(mac))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return expected === signature;
  } catch {
    return false;
  }
}
