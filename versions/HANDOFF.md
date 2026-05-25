# NOTAVELLO — LIVING HANDOFF FILE
> **⚠️ BEFORE CLOSING ANY SESSION: say "wrap up" so Claude updates this file.**
> **START OF EVERY SESSION: upload chatgpt/index.html + claude/index.html + this file + CHANGELOG.md**

Last updated: May 25, 2026 — Session 16
Current versions: `root-1.5` · `claude-3.0` · `chatgpt-1.2` · `login-1.0`
⚠️ root and claude auto-increment on every push via GitHub Action — check live page for actual number.
⚠️ chatgpt version is manual for now — not yet covered by GitHub Action.

---

## WHAT NOTAVELLO IS
A browser-based PDF exporter. First product: AI conversation exports.
Future products: anything that benefits from clean structured PDF output.
The platform is generic — the AI conversation angle is the first use case, not the only one.
- Free tier: watermarked, first 30 messages exported.
- Paid tier: $5/month, watermark-free, unlimited. (Stripe LIVE.)
- Target users: lawyers, consultants, business users.

## LIVE URLS
- Product: notavello.com
- Redirect: notavello.net → notavello.com (301)
- GitHub: github.com/skychael/notavello (PRIVATE)
- Hosting: Cloudflare Pages (auto-deploys from GitHub main branch)
- Cloudflare Worker: notavello-worker.mikekoga.workers.dev
- Owner: Mike Koga · GitHub: skychael · Location: Reno, NV

---

## FILE STRUCTURE (as of Session 16)

### Root level (notavello.com/)
```
_worker.js        ← Cloudflare Pages Worker — header/footer injection (MUST be in repo root)
_header.html      ← Single source of truth for site header
_footer.html      ← Single source of truth for site footer (no "Made in Reno, NV." as of S15)
index.html        ← Master landing page (root-1.5)
sitemap.xml       ← Google sitemap
about.html        ← No founder name — intentional
contact.html      ← Four email address cards
faq.html
pricing.html
privacy.html      ← Nevada law
sample.html       ← Sample PDF (generated on the fly)
sitemap.html      ← Account section added (Session 13)
terms.html
login.html        ← Pro member login page (login-1.0) — noindex
.gitignore        ← Hides versions/ folder
.github/workflows/version-bump.yml ← Auto-bumps root and claude versions on push
```

### HOW HEADER/FOOTER AUTOMATION WORKS
- _worker.js runs on every request, replaces <!--HEADER--> and <!--FOOTER--> placeholders
- Edit _header.html or _footer.html in GitHub → all pages updated instantly
- NEVER use fetch('https://notavello.com/...') inside _worker.js — causes Error 1000 loop
- Always use env.ASSETS.fetch() instead
- _worker.js MUST be in the GitHub repo root — if missing, all placeholders show as literal text

### Product pages
```
claude/index.html   ← Working (claude-3.0) — auto-versioned
chatgpt/index.html  ← Working (chatgpt-1.2) — manual versioning for now
gemini/             ← NOT BUILT YET
copilot/            ← NOT BUILT YET
```

### Versions folder
```
versions/HANDOFF.md       ← This file
versions/CHANGELOG.md     ← Full session history
versions/claude-1.6.html  ← Snapshot (claude-1.7+ snapshots not yet added)
```

### Cloudflare Worker (notavello-worker.mikekoga.workers.dev)
```
LIVE routes:
  /validate-speakers — AI speaker validation via Haiku 4.5
  /create-checkout   — Creates Stripe checkout session
  /stripe-webhook    — Receives Stripe payment, saves email to D1, sends welcome email
  /send-code         — Generates + emails 6-digit login code via Resend
  /verify-code       — Checks code, sets 90-day cookie if valid
  /check-access      — Reads cookie, checks D1, returns yes/no

Secrets (encrypted): ANTHROPIC_API_KEY, STRIPE_SECRET_KEY,
                     STRIPE_WEBHOOK_SECRET, RESEND_API_KEY
Plaintext: STRIPE_PUBLISHABLE_KEY, STRIPE_PRICE_ID
Bindings: DB → notavello-db (Cloudflare D1)

IMPORTANT: notavello-worker is edited directly in Cloudflare's editor.
It does NOT deploy from GitHub. Never put its code in the GitHub repo.
```

### Stripe
```
Account: Notavello (live mode, unregistered business, sole proprietor)
Product: Notavello Pro — price_1TaMGHCKzKKAPN8Dk3FGUhm7 — $5/month recurring
Webhook: notavello-worker.mikekoga.workers.dev/stripe-webhook
Webhook event: checkout.session.completed
Payout bank: Rogue Credit Union (manual entry)
Payment methods enabled: Cards, Apple Pay, Google Pay, Link
customer_email must be OMITTED (not empty string) in checkout params — Stripe rejects empty string
```

### Email Routing (Cloudflare — receiving only)
```
All four addresses forward to mikekoga@hotmail.com via catch-all rule.
hello@notavello.com   — general questions & feedback
bugs@notavello.com    — bug reports
billing@notavello.com — billing & account
legal@notavello.com   — legal & privacy
```

### Resend (sending — LIVE)
```
Purpose: welcome emails on payment + 6-digit login codes
Free tier: 3,000 emails/month, 100/day
Domain: notavello.com (verified)
From address: hello@notavello.com
API key: stored as RESEND_API_KEY in Cloudflare Worker secrets
```

### Cloudflare D1
```
Database name: notavello-db
Binding in Worker: DB
Tables:
  customers   — email TEXT PRIMARY KEY, plan TEXT, status TEXT, created TEXT
  login_codes — email TEXT, code TEXT, expires TEXT
```

---

## AUTH SYSTEM (LIVE — fully tested Session 12)

- User clicks "Already a Pro member?" → types email → Worker checks D1 → sends 6-digit code
- User enters code → Worker verifies → sets 90-day HttpOnly cookie
- On page load, /check-access reads cookie, sets localStorage as backup

Cookie spec:
  Name: notavello_session · HttpOnly, Secure, SameSite=Lax · Max-Age: 90 days

---

## CHATGPT PARSER (chatgpt-1.2) — NEW THIS SESSION

### Architecture (completely different from Claude parser)
- Clipboard HTML → DOMParser → querySelectorAll('[data-turn]') → structured messages
- data-turn="user" → human, data-turn="assistant" → AI
- No regex. No timestamp splitting. No speaker guessing.
- ChatGPT's own DOM structure is the source of truth.

### Why it works
Ctrl+A on ChatGPT copies the entire page HTML including sidebar and chrome.
But querySelectorAll('[data-turn]') correctly isolates only conversation turns.
This is the architectural breakthrough — speaker labels come from the DOM, not inference.

### What works (confirmed live testing)
- Simple conversations: ✓
- Code blocks — line breaks preserved: ✓ (DOM tree walker fix)
- Bullet points and numbered lists: ✓
- Paragraph text: ✓
- Role accuracy (user/assistant): ✓
- Worker speaker validation: ✓
- Watermark for free users: ✓
- Stripe checkout wired: ✓ (same pattern as claude)
- Conversation saved/restored across Stripe redirect: ✓
- Auto-redaction (API keys, SSNs, etc): ✓
- Dev mode (Ctrl+Shift+D): ✓

### What is NOT done yet on chatgpt page
- 30-message paywall UI exists but download is NOT gated — fix before launch
- Fallback regex parser still present — dangerous, should be replaced with hard error
- Debug box and timestamp badge intentionally kept — still needed for testing
- Not covered by GitHub Action auto-versioning yet

### DOM tree walker (extractText function)
Replaces innerText which collapsed all formatting. Walks DOM nodes, inserts \n at:
P, DIV, LI, PRE, BLOCKQUOTE, H1-H6, TR (block elements) and BR (explicit breaks).
Collapses 3+ consecutive newlines to 2. Universal fix — not just for code.

### Debug tools (keep these)
- Debug paste box (#debugPasteBox): paste clipboard here to inspect raw turn extraction
- Debug output (#debugOutput): green panel showing turn count and role assignment
- Badge shows: "chatgpt-1.2 · [timestamp]" — version confirms build, time confirms refresh
- Floating debug panel (bottom right): shows parse mode, message counts, worker status

---

## CLAUDE PARSER (claude-3.0)

### What works
- Ctrl+A copy format with timestamps on their own lines
- First-speaker detection (length, question mark, Claude opener words)
- AI speaker validation via Cloudflare Worker (Haiku 4.5, ~$0.0009/export)
- Confidence check flags bad human/AI ratios
- Attachment placeholders replace raw metadata
- Auto-redaction checkbox (on by default)
- 30-message paywall: preview completes, paywall on Download click
- Free truncated download (first 30 messages) always available
- Watermark removed for paid users (isPaid check)
- Stripe checkout, conversation persistence, restore flow — all working
- Dev mode (Ctrl+Shift+D) bypasses paywall and watermark

### Known bugs
| # | Status | Description |
|---|--------|-------------|
| 2 | OPEN | Single-char replies show as AI in edge cases |
| 3 | OPEN | Timestamps embedded in AI text cause false splits |
| 4 | **DO NOT TOUCH** | Preview is simulation not PDF renderer. Multiple sessions spiraled fixing this. Do not touch without reading full CHANGELOG history and explicit Mike instruction. |
| 5 | OPEN | Images can't export. Shows [Attachment] placeholder. |
| 6 | OPEN | Claude tool-use labels bleed into export. Stripping risky. Leave as-is. |
| 8 | OPEN | Watermark fragments into PDF text layer. pdfmake limitation. |

---

## VERSIONING

### Auto (root and claude only)
GitHub Action (.github/workflows/version-bump.yml) bumps minor version on every push.
Do not manually bump root or claude versions — Action handles it.
Check live page badge to confirm deployed version.

### Manual (chatgpt and all other files)
Bump ALL THREE on every change:
1. Comment at top of file
2. Badge text
3. Debug panel string

### Where versions appear
- root: small faint text under CTA button on home page
- claude: badge top-right ("Free Preview · claude-X.Y")
- chatgpt: badge top-right ("chatgpt-X.X · [timestamp]")

---

## WATERMARK
- Diagonal: NOTAVELLO.COM · 52pt · -45° · 18% opacity · #4F46E5
- Mike confirmed "perfect" at v0.093. Do not change without asking.
- Removed for paid users (isPaid check in downloadPDF function)

---

## ARCHITECTURE — DO NOT VIOLATE

1. ONE FILE PER PRODUCT. No shared parser. No auto-detection. Final.
2. All new pages MUST use <!--HEADER--> and <!--FOOTER--> placeholders.
3. notavello-worker lives ONLY in Cloudflare editor — never in GitHub.
4. NEVER use fetch('https://notavello.com/...') in _worker.js — use env.ASSETS.fetch().
5. Products are not AI-specific. Future products may have nothing to do with AI.
6. Paywall: preview always completes. Gate the download, not the parse.

---

## SEO STATUS
- Full SEO heads on root and claude pages
- sitemap.xml exists — not yet submitted to Google Search Console
- Missing: robots.txt, Search Console setup, structured data

---

## NEXT STEPS (priority order as of Session 16)

1. **Enforce 30-message paywall on chatgpt page** — UI exists, download not gated. Fix before real traffic.
2. **Remove/replace dangerous fallback parser on chatgpt page** — regex fallback produces 700+ fake messages. Replace with hard error message.
3. **robots.txt** — add to GitHub root, allow all
4. **Google Search Console** — submit sitemap.xml
5. **Extend GitHub Action to chatgpt/index.html** — auto-bump chatgpt version on push
6. **Stripe customer portal** — let paying users manage/cancel subscription
7. **Email logo** — update Resend email bodies in Worker with email-logo-snippet.html
8. **gemini/index.html** — need real Gemini paste sample first
9. **Remove debug UI from chatgpt page** — only when Mike explicitly decides

---

## STANDING DECISIONS — DO NOT REVISIT WITHOUT MIKE'S EXPLICIT DIRECTION

1. ONE FILE PER PRODUCT. No unified parser. No auto-detection. Final.
2. DO NOT touch BUG 4 (preview simulation) without reading full CHANGELOG history
3. DO NOT move any URL without 301 redirects in _redirects file
4. DO NOT add founder name to about page without asking Mike
5. DO NOT sync version numbers across files — each file independent
6. Watermark confirmed perfect at v0.093 — do not change without asking
7. Debug panel stays until Mike explicitly decides to remove it
8. notavello-worker lives ONLY in Cloudflare editor — never in GitHub
9. NEVER use fetch('https://notavello.com/...') in _worker.js
10. All new pages MUST use <!--HEADER--> and <!--FOOTER--> placeholders
11. Paywall: preview always completes. Gate the download, not the parse.
12. One subscription unlocks everything on notavello.com
13. localStorage kept as fallback alongside cookie — remove only when D1 confirmed solid
14. Welcome email is the only marketing email Notavello sends

---

## SESSION LOG

| Session | Date | Key changes |
|---------|------|-------------|
| 1–4 | Pre-May 2026 | See CHANGELOG.md for full history |
| 5 | May 22, 2026 (morning) | Textarea visible (claude-1.6). versions/ folder created. |
| 6 | May 22, 2026 (evening) | All-blue PDF bug fixed. claude-1.7 first-speaker detection. |
| 7 | May 22, 2026 (night) | Site copy edits across all pages. |
| 8 | May 23, 2026 | Cloudflare Worker built. Haiku 4.5 validation live. Paywall redesigned. Dev mode. claude-2.5. |
| 9 | May 23, 2026 | Stripe fully integrated. claude-2.6. Email routing live. root-1.2. |
| 10 | May 23, 2026 | Full auth system designed. Header/footer automation LIVE. |
| 11 | May 24, 2026 | Full auth system built and deployed. D1 live. Resend live. claude-2.8. root-1.4. |
| 12 | May 24, 2026 | Stripe checkout fixed. Welcome email added. Conversation persistence. End-to-end confirmed. claude-2.9. |
| 13 | May 24, 2026 | Login page (login-1.0). Log In in header/footer. Logo SVG. Email logo snippet. |
| 13b | May 24, 2026 | Watermark removal for paid users. claude-3.0. |
| 14 | May 24, 2026 | _worker.js rebuilt (was missing from GitHub). Full page audit. root-1.5. |
| 15 | May 24, 2026 | GitHub Action for auto-versioning. Manual versioning retired for root/claude. Footer cleaned. |
| 16 | May 25, 2026 | chatgpt/index.html confirmed working. DOM tree walker fixes formatting. chatgpt-1.2. |

---
*Upload HANDOFF.md + CHANGELOG.md + chatgpt/index.html + claude/index.html at start of every session.*
*Say "wrap up" before closing any session so Claude updates these files.*
