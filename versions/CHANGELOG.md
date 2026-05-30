# NOTAVELLO — FULL SESSION HISTORY
> Append-only. Never overwrite. Never summarize away detail.
> This file exists so future Claude sessions can understand not just
> WHAT changed but WHY, what was tried, what failed, and what decisions
> were made. Read this before touching anything.

---

## SESSION 17 · May 30, 2026

### Context
Worker URL migration — removed Mike's account name (`mikekoga`) from the public
Worker URL, plus a full sweep of external services for stale references to the
old host. (NOTE: the three May 29 sessions are documented in HANDOFF.md but were
never assigned CHANGELOG session numbers — this entry is numbered 17 as the next
integer after the last logged session, 16.)

### The problem
The Worker's default URL `notavello-worker.mikekoga.workers.dev` exposed the
Cloudflare account name publicly — visible in View Source on every exporter page.

### What changed
- **Custom Domain added:** `api.notavello.com` connected to the `notavello-worker`
  Worker via the dashboard Domains tab. DNS auto-created (`notavello.com` was
  already an active Cloudflare zone). Verified live.
- **Old URLs disabled:** both the `workers.dev` Worker URL and the Preview URL set
  Inactive. Dashboard-only deploy (no Wrangler) means they stay off.
- **Frontend updated:** all `fetch()` calls → `https://api.notavello.com` across
  `login.html`, `pages/pricing.html`, and exporters claude/grok/perplexity/gemini/
  copilot/other. (chatgpt was already migrated.) No version bumps applied to these
  files this session — single-line host swap only. Deployed via GitHub → Pages.
- **Stripe webhook updated:** endpoint URL changed (existing destination edited, not
  recreated, so signing secret preserved) to `https://api.notavello.com/stripe-webhook`.
  This was a hidden external dependency — easy to miss.

### Verifications (all passed)
- Live grok page source: zero `mikekoga`.
- Webhook resend: 200 OK, `{"received": true}`, Delivered/Recovered. Welcome email delivered.
- Stripe Event destinations: one destination, new URL, 0% error rate.
- Live Upgrade button → reached Stripe checkout page.
- Worker code: success_url/cancel_url point to notavello.com; CORS = notavello.com; no old host.
- `/admin/` Decap CMS: blank/unconfigured — confirmed NOT a migration issue.

### Findings / decisions
1. Session cookie (`Domain=notavello.com`) was likely rejected on the old workers.dev
   host (different registrable domain) — should now persist correctly on api.notavello.com.
   Pending a login-and-reload confirmation.
2. Polish backlog: email em-dash UTF-8 encoding; success_url always returns to
   /exporters/claude/; optional config.js to centralize the API base (hardcoded ~30× across 8 files).
3. External sweep cleared Worker code, Stripe, CMS, and all repo files. Workers Routes /
   GitHub webhooks / Resend webhooks left unchecked as low-probability.

---

## SESSION 16 · May 25, 2026

### Context
ChatGPT built chatgpt/index.html across one or more sessions after Session 15.
No CHANGELOG entries were written for that work — this entry reconstructs what
was built based on code inspection and live testing performed this session.

### chatgpt/index.html — built by ChatGPT (sessions between 15 and 16)
Architecture: DOM-based clipboard extraction. Completely different from claude parser.
Does NOT use regex or timestamp-based splitting. Uses ChatGPT's own HTML structure.

Core approach:
- User presses Ctrl+A, Ctrl+C on ChatGPT page
- Clipboard contains full page HTML including sidebar, footer, UI chrome
- DOMParser parses the HTML
- querySelectorAll('[data-turn]') isolates conversation turns only
- data-turn="user" → human, data-turn="assistant" → AI
- data-message-author-role used as secondary selector inside each turn

Why this works: ChatGPT's clipboard HTML contains structured DOM with data-turn
attributes on every conversation turn. This bypasses all the regex guessing
that plagued early Claude parser development.

### What ChatGPT built (confirmed by code inspection)
- Full chatgpt/index.html standalone file
- Same visual design as claude/index.html
- AI_NAME = 'ChatGPT'
- parseConversation(raw, html) — accepts both plain text and clipboard HTML
- HTML parser branch: if (html && html.includes('data-turn'))
- Fallback to regex parser if no data-turn found (dangerous — see below)
- lastClipboardHTML variable captures HTML on paste event
- Debug paste box + green debug output panel (intentional — keep for testing)
- Timestamp badge: document.querySelector('.badge').textContent = 'chatgpt-X.X · ' + time
- Worker integration: /validate-speakers, /create-checkout, /check-access, /send-code, /verify-code
- Stripe checkout wired (same pattern as claude)
- 30-message paywall UI exists but NOT enforced (paywall shows but download not gated)
- Auto-redaction: API keys, hex keys, SSNs, credit cards

### Bugs found and fixed this session (Claude, Session 16)

#### Bug 1: innerText collapsing all formatting (FIXED — chatgpt-1.2)
Symptom: code blocks, bullet points, numbered lists, paragraphs all collapsed
into single lines in the PDF. "print('hello')\nname = input()" became
"print('hello')name = input()" with no line breaks.

Root cause: msg.innerText.trim() collapses block-level element boundaries.

Fix: replaced innerText with a recursive DOM tree walker (extractText function).
Walker inserts \n at block boundaries: P, DIV, LI, PRE, BLOCKQUOTE, H1-H6, TR.
Inserts \n for BR elements. Collapses 3+ consecutive newlines to 2.
This is universal — fixes code blocks, bullets, paragraphs, headers, tables.

Confirmed working: Python code block renders on 3 separate lines. Bullet list
renders with each item on its own line. Paragraph text flows correctly.

#### Bug 2: Variable declaration order (FIXED — chatgpt-1.2)
parsedMessages and lastClipboardHTML were declared after the event listeners
that used them. Moved declarations above first use.

#### Bug 3: Badge showed only timestamp, no version (FIXED — chatgpt-1.2)
Badge now shows: "chatgpt-1.2 · 8:26:47 AM"
Both version and timestamp visible simultaneously.

### What was NOT fixed this session
- Fallback regex parser still present and dangerous — if data-turn not found,
  falls back to alternating-block splitter which produces 700+ fake messages.
  Should be replaced with a hard error. Deferred.
- 30-message paywall not enforced on chatgpt page. Deferred.
- Debug box and timestamp intentionally kept — still needed for testing.

### Live test results (chatgpt-1.2)
- Simple conversation (14 messages): ✓ perfect extraction and PDF
- Code block (Python 3 lines): ✓ correct line breaks in PDF
- Paragraph + bullet list: ✓ each item on own line in PDF
- Role accuracy: ✓ user/assistant correctly identified
- Worker speaker validation: ✓ called and returning results

### Current versions as of end of Session 16
- root/index.html: root-1.5 (auto-increments on push)
- claude/index.html: claude-3.0 (auto-increments on push)
- chatgpt/index.html: chatgpt-1.2 (manual for now — not covered by GitHub Action yet)
- login.html: login-1.0

### What the GitHub Action does NOT cover yet
The version-bump.yml Action only covers root/index.html and claude/index.html.
chatgpt/index.html requires manual version bumping for now.

---

## SESSION 15 · May 24, 2026

### GitHub Action: auto version bump
File: `.github/workflows/version-bump.yml`

Triggers on every push to main that touches `index.html` or `claude/index.html`.
Reads current version string, increments minor number, replaces all occurrences
in the file, commits back with `[version-bump]` message to prevent infinite loop.

- `index.html` → bumps `root-X.Y` everywhere in that file
- `claude/index.html` → bumps `claude-X.Y` everywhere in that file (comment, badge, debug panel)

Manual version bumping is now retired. The Action handles it on every push.
The live page always shows the true deployed version — use it to confirm deploys.

To create the Action in GitHub:
1. In your repo, create folder `.github/workflows/`
2. Upload `version-bump.yml` into that folder
3. GitHub Actions is enabled by default on all repos — no setup needed
4. On next push to a versioned file, check Actions tab to confirm it ran

### _footer.html
Removed "Made in Reno, NV." from copyright line. Now just "&copy; 2026 Notavello."

### Manual version bumping retired
No longer needed — see versioning section in HANDOFF.

## SESSION 14 · May 24, 2026

### Root cause: _worker.js missing from GitHub
_worker.js was never in the GitHub repo — every <!--HEADER--> and <!--FOOTER-->
placeholder was rendering as literal text on every page since launch.
Rebuilt and uploaded. Immediately fixed all pages site-wide.

### Full page audit performed
- sample.html: hardcoded header/footer converted to placeholders
- contact.html: was a verbatim copy of faq.html with wrong title/meta — rebuilt as real contact page with four email address cards
- sitemap.html: redesigned — removed URL-in-left-column pattern, now shows clean page name / description / status badge layout
- login.html: missing <!--FOOTER--> added; success button changed from /claude/ to /; Log In button hidden on login page itself (display:none); full footer CSS added
- about.html, privacy.html, terms.html: missing justify-content:space-between on .header + missing .header-login CSS — both added
- faq.html, pricing.html: missing .header-login CSS — added

### root/index.html (root-1.5)
- Removed "Free tier includes watermark · $5/month removes it" from CTA note
- Replaced with version string "root-1.5" for cache-busting / troubleshooting
- Version comment at top bumped to root-1.5

### Version strings as of end of Session 14
- root/index.html: root-1.5 (visible on page as small text under CTA button)
- claude/index.html: claude-3.0 (visible as badge top-right of exporter)
- login.html: login-1.0

## SESSION 13b · May 24, 2026

### Watermark removal for paid users (claude-3.0)
Applied to `claude/index.html`.

Two changes in the `downloadPdf()` function, just before `const docDef`:

1. Added `isPaid` check:
   ```js
   const isPaid = localStorage.getItem('notavello_paid') === 'true'
               || sessionStorage.getItem('notavello_dev') === 'true';
   ```
   Note: dev mode (Ctrl+Shift+D) also suppresses the watermark, consistent with its purpose.

2. `watermark:` key in docDef is now conditional:
   ```js
   ...(isPaid ? {} : { watermark: { ... } })
   ```

3. Footer credit line (`pageWm`) is now empty string for paid users:
   ```js
   const pageWm = isPaid ? '' : WATERMARKS[...];
   ```

The WATERMARKS array and `watermarkIndex` counter are unchanged — they still rotate
for free users exactly as before.

### Version bumps (all three required)
- Comment: `<!-- Notavello claude-3.0 -->`
- Badge: `Free Preview · claude-3.0`
- Debug panel: `Notavello Debug · claude-3.0`

## SESSION 13 · May 24, 2026

### Context
Continuation of Session 12. Auth system fully working. Three items from need_to_add.txt.

### Item 1: Log In link added site-wide
Added "Log In" button to `_header.html` — appears on every page automatically via _worker.js.
Style: indigo pill button (matches "Already a Pro member?" paywall button aesthetic).
Also added Log In link to `_footer.html` Product nav row.
Also added "Account" section to `sitemap.html` with the login page listed.

New file: `login.html` (login-1.0)
- Standalone login page at notavello.com/login/
- Same email → 6-digit code → verify flow as paywall restore
- Uses /send-code and /verify-code Worker routes (no Worker changes needed)
- Sets localStorage('notavello_paid','true') on success
- Enter key support, resend link, "use different email" link
- noindex (not needed in search results)
- Detects if user already has local Pro flag and shows message

### Item 2: Logo SVG created
`notavello-logo.svg` — 200×48px wordmark with gradient document icon
`email-logo-snippet.html` — email-safe HTML block for Resend welcome/login emails
For the email logo: update the welcome email body in the Worker's /stripe-webhook and
/send-code routes to include the logo HTML at the top of the email body.
Note: gradient on icon box works in Gmail. Text-only fallback also provided.

### Item 3: Watermark removal on paid tier — INSTRUCTIONS
claude/index.html was NOT uploaded this session. Apply this change manually.
Version bump to claude-3.0 when this change is applied.

### Decisions made this session
1. Login page is standalone at /login/ — not a modal, not a redirect
2. Log In lives in the header (via _header.html) — one edit, all pages updated
3. Logo is SVG-first; email uses inline-CSS HTML snippet (no image dependency)
4. Watermark removal uses existing isPaid check pattern — no new logic needed
5. login.html is noindex — no need for it in search results

## SESSION 12 · May 24, 2026

### Context
Continuation of Session 11. Auth system was live but untested end-to-end.
Goal: fix Stripe checkout bug, add welcome email, improve UX, confirm everything works.

### Bug fixed: Stripe checkout returning 500
Root cause: `'customer_email': ''` in the URLSearchParams body. Stripe rejects empty
string for customer_email — must either be valid email or omitted entirely.
Fix: removed the customer_email line from the /create-checkout route.

### Payment methods cleaned up (Stripe dashboard)
Disabled: Cash App Pay, Klarna, and other buy-now-pay-later options.
Kept enabled: Cards, Apple Pay, Google Pay, Link.

### Welcome email added to /stripe-webhook
Fires on checkout.session.completed. Sends via Resend.
Subject: "Welcome to Notavello Pro"
Confirmed delivered to stanturlock@netzero.net instantly.

### Conversation saved/restored across Stripe redirect (claude-2.9)
startCheckout() saves conversation to sessionStorage before redirecting.
On return (?paid=true or ?paid=cancelled), conversation restored automatically.

### "Already a Pro member?" button made prominent (claude-2.9)
Full-width indigo button — impossible to miss.

### End-to-end testing confirmed this session
- Stripe checkout: payment → redirect → localStorage set → paywall dismissed ✓
- Webhook: payment → D1 save → welcome email sent ✓
- Restore flow: email → 6-digit code → verify → cookie → access restored ✓

### Decisions made this session
1. customer_email must be omitted (not empty string) in Stripe checkout params
2. BNPL payment methods disabled
3. Conversation persistence across Stripe redirect is a UX requirement, not optional
4. Welcome email is the only marketing email Notavello sends

## SESSION 11 · May 24, 2026
Full auth system built and deployed. D1 live. Resend live.
Worker updated with /send-code, /verify-code, /check-access. claude-2.8. root-1.4.

## SESSION 10 · May 23, 2026
Full auth system designed. Header/footer automation LIVE.
Root pages updated to use <!--HEADER--> and <!--FOOTER--> placeholders.

## SESSION 9 · May 23, 2026
Stripe fully integrated. claude-2.6. Email routing live. root-1.2.

## SESSION 8 · May 23, 2026
Cloudflare Worker built. Haiku 4.5 validation live. Paywall redesigned. Dev mode. claude-2.5.

## SESSION 7 · May 22, 2026 (night)
Site copy edits from Corrections.txt. about.html, faq.html, contact.html, pricing.html updated.
Two items deferred: auto-redaction checkbox verification, 30-message limit enforcement verification.

## SESSION 6 · May 22, 2026 (evening)

### What we found
PDF output completely broken — every message labeled human (all blue).

### The fix (claude-1.7)
First-speaker detection added to parseClaude(). Checks block length, question marks,
Claude-style opener words before assigning first block as human.
Test result: 367-message conversation → 183 human / 184 AI. Confirmed working.

### Decisions made this session
1. Cloudflare Worker is #1 priority
2. AI validation layer (Haiku 4.5, ~$0.0009/export) next after Worker
3. Stop patching parser until Worker + AI layer exist
4. versions/ folder system created

## SESSION 5 · May 22, 2026 (morning)
Textarea visibility fixed (claude-1.6). AI order corrected to market share order.
versions/ folder, HANDOFF.md, CHANGELOG.md, .gitignore created.

## SESSION 4 · Pre-May 22, 2026
Full site footer built and copy-pasted to all pages.
Root landing page (root-1.0) created at notavello.com/.

## SESSION 3 · Pre-May 22, 2026
claude-1.3: attachment placeholders added.
claude-1.2: BUG 4 warning expanded. DO NOT TOUCH preview simulation.

## SESSION 2 · Pre-May 22, 2026
claude-1.1: personal info removed from HTML comments.
claude-1.0: per-file independent versioning established.

## SESSION 1 · Pre-May 22, 2026
v0.095–v0.1: initial build through AI_NAME variable, URL structure, watermark tuning,
floating download bar, multi-platform parser attempt (failed), rollback to one-file-per-AI.

---

## STANDING DECISIONS — DO NOT REVISIT WITHOUT MIKE'S EXPLICIT DIRECTION

1. ONE FILE PER PRODUCT. No unified parser. No auto-detection. Final.
2. DO NOT touch BUG 4 (preview simulation) without reading full v0.075 history
3. DO NOT move any URL without 301 redirects in _redirects file
4. DO NOT add founder name to about page without asking Mike
5. DO NOT sync version numbers across files — each file independent
6. Watermark confirmed perfect at v0.093 — do not change
7. Debug panel stays until Mike explicitly decides to remove it
8. Footer copy-pasted per file (not JS) until Cloudflare Worker exists — NOW AUTOMATED
9. Cloudflare Worker is live — all routes active
10. Paywall: preview always completes. Gate the download, not the parse.
11. Products are not AI-specific. Do not assume all future products are exporters.
12. notavello-worker lives ONLY in Cloudflare editor — never put its code in GitHub
13. NEVER use fetch('https://notavello.com/...') in _worker.js — use env.ASSETS.fetch()
14. All new pages MUST use <!--HEADER--> and <!--FOOTER--> placeholders
15. notavello-worker is served at api.notavello.com (Custom Domain). The default workers.dev Worker URL AND Preview URL are DISABLED — do not re-enable (re-exposes the account name). Every external integration (Stripe webhook, any future OAuth callbacks, monitoring) must point at api.notavello.com, never the old …workers.dev host.
