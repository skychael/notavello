# Notavello Handoff — May 30, 2026

## Session Summary
Three sessions this date:

1. **Full site SEO audit and fix** across all 17 pages. Every page now has correct canonicals, OG tags, Twitter cards, and structured data. Several pages had broken internal links and outdated content that were also fixed. Blog template created. Tools page built from scratch.
2. **Gemini + Copilot parser rework.** Gemini was shredding single responses into dozens of fake alternating turns. Copilot's label parser wasn't recognising the real "You said" / "Copilot said" markers and its noise list was full of Gemini/Google leftovers. Both fixed and verified against real paste input.
3. **Perplexity structural parser.** Added a `Completed N steps` marker-based plain-text parser to the Perplexity exporter, wired as the highest-priority path in `parsePerplexity`. Fixes the common Perplexity copy format — plain text with no speaker labels — which the existing HTML/heuristic parsers shredded into fake alternating turns. Verified against a real 5-turn paste.

---

## Changelog

### Exporters

**`exporters/chatgpt/` — v1.16**
- Replaced hardcoded footer with `<!--FOOTER-->` partial (was the only page not using it)
- Version bumped 1.14 → 1.16

**`exporters/claude/` — v3.4**
- Added `og:image` and image dimensions
- Upgraded `twitter:card` from `summary` to `summary_large_image`
- Added `twitter:image`

**`exporters/copilot/` — v2.6** *(was v2.5 after SEO session, bumped again in parser session)*
- SEO session: fixed canonical URL (`/copilot/` → `/exporters/copilot/`), OG URL, added `og:image`, upgraded Twitter card, added structured data (`WebApplication` schema)
- Parser session: see **Copilot parser rework** section below

**`exporters/grok/` — v2.2**
- Fixed canonical URL (was wrongly pointing to `/gemini/`)
- Fixed OG URL to match
- Added `og:image` and dimensions
- Upgraded `twitter:card` to `summary_large_image`
- Added `twitter:image`
- Added full structured data (`WebApplication` schema)

**`exporters/gemini/` — v2.4.6** *(was v2.4.5 after SEO session, bumped again in parser session)*
- SEO session: added `og:image`, upgraded Twitter card
- Parser session: see **Gemini parser rework** section below

**`exporters/perplexity/` — v2.6** *(was v2.5 after SEO session, bumped again in parser session)*
- SEO session: fixed canonical URL (`/perplexity/` → `/exporters/perplexity/`), OG URL, added `og:image` + dimensions, upgraded `twitter:card` to `summary_large_image`, added `twitter:image`, added full structured data (`WebApplication` schema)
- Parser session: see **Perplexity parser rework** section below

**`exporters/other/` — v1.3**
- Fixed canonical URL (`/other/` → `/exporters/other/`)
- Fixed OG URL to match
- Added `og:image` and dimensions
- Upgraded `twitter:card` to `summary_large_image`
- Added `twitter:image`
- Intentionally left title generic and no structured data (catch-all page)

---

### Gemini parser rework (`gemini-2.4.6`)

**What was broken:** A real export produced 65 alternating one-line messages instead of the correct 4. The correct parse existed in the plain-text candidate but was discarded. Two defects:
1. `chooseBestGeminiParse` short-circuited to the HTML candidate whenever `|human − ai| ≤ 2` — perfect alternation of tiny messages trivially satisfies this.
2. `scoreMessages` used `total * 10`, so more (smaller) messages always scored higher. The garbage scored ~646 vs the correct parse at ~40.

**What was fixed:**
- **`looksShredded(messages)`** — new helper added before `scoreMessages`. Returns `true` when ≥6 messages have >50% under 40 chars and >90% of consecutive pairs alternate roles.
- **`scoreMessages`** — `total * 10` → `total * 4`. Added: −8 per message under 25 chars, −60 cliff when >50% are fragments, average-length reward capped at 400 chars. Existing AI-language penalties unchanged.
- **`chooseBestGeminiParse`** — `htmlBalanced` early-return now has a `looksShredded` guard; if shredded, falls through to score-based decision.
- **`checkConfidence`** — added shred warning: ≥8 messages and >50% under 40 chars triggers amber warning even when human/AI counts look balanced.
- Housekeeping: version comment, badge, stale `GEMINI-2.3 DEBUG` / `19:40:18` debug strings, `v1.6 strategy` parser header — all updated.

**Verified:** Shredded candidate now scores −322 vs correct +83. Regression (normal multi-turn Q&A) still picks HTML via the DOM path.

---

### Copilot parser rework (`copilot-2.6`)

**What was broken** (three separate issues, tested against a real 8-turn Copilot paste):
1. `parseCopilotByLabels` required a colon — matched `You said:` but not `You said`. The real Copilot web UI emits bare `You said` / `Copilot said` with no colon, so label detection silently failed and fell through to the alternation guesser.
2. The noise list was inherited from the Gemini page: contained `Google apps`, `Open in Gmail`, `Export to Docs`, `Conversation with Copilot` (none appear in Copilot pastes) while missing `Edit in a page` (appended after every AI response), `Message Copilot` (composer placeholder), and the entire sidebar nav.
3. `preparePlainCopilotText` sliced on `Conversation with Copilot` — a Gemini marker that never appears in Copilot pastes, so the pre-trim did nothing.
4. The old `total * 10` scorer and blind `htmlBalanced` trust (same bugs as Gemini) were still present and unported.

**What was fixed:**
- **`copilotLabelRole(label)`** — new helper mapping speaker name → role (replaces the duplicated `/copilot|copilot/i` regex that was also a leftover from Gemini).
- **`parseCopilotByLabels`** — patterns rewritten. `labelPattern` now uses `(?:\s+said)?` (said optional, colon optional) so it matches bare `You said` and `Copilot said` as well as `You:` / `Copilot:` variants. Inline pattern still requires a colon before the text.
- **`cleanCopilotNoise`** — rebuilt from scratch. Removed Gemini/Google leftovers. Added: full sidebar nav (`New chat`, `Library`, `Tasks`, `Projects`, `Discover`, `Health`, `Shopping`, `Imagine`, `Experiments`, `Preview`), account chrome (`Free Plan`, `Upgrade`, `Invite`), day separators (`Today`, `Yesterday`), per-turn controls (`Edit in a page`, `Message Copilot`, `Listen`, `Copy`, `Like`, `Dislike`, `Quick response`, `Think Deeper`, `Smart (GPT-5)`, etc.), updated disclaimer regexes. Also added filter for single-letter avatar initials and markdown-link nav items.
- **`preparePlainCopilotText`** — now finds the first real turn-label line via regex and slices there, instead of searching for the nonexistent Gemini banner.
- **`classifyCopilotElement`** — removed `/copilot|copilot/i` duplicate alternation.
- **`looksShredded`**, **`scoreMessages`**, **`chooseBestCopilotParse`**, **`checkConfidence`** — Gemini shred fixes ported verbatim.
- Housekeeping: version comment, badge, stale `COPILOT-2.2 DEBUG` / `19:40:18` debug strings, `v1.6 strategy` parser header — all updated.

**Verified:** Real 8-turn paste → 16 messages (8 human / 8 AI), parsed via `Plain label candidate: 16` (label parser fired, no fallback), zero chrome or noise leaked into any message.

---

### Perplexity parser rework (`perplexity-2.6`)

**What was broken** (tested against a real 5-turn Perplexity paste — a plain-text copy with no clipboard HTML):
1. Perplexity plain-text copy carries **no speaker labels** — "You" / "Perplexity" never appear — so `parsePerplexityByLabels` matched nothing and fell through to the alternation guesser.
2. `cleanPerplexityNoise` strips all blank lines, destroying paragraph boundaries, so `split(/\n{2,}/)` found nothing and the smart parser dropped to splitting on *every line* — shredding each multi-paragraph answer into many fake alternating turns. Mid-answer headings ("How it works", etc.) became fake user messages.
3. The real turn delimiter, `Completed N steps` (printed before every answer), was not in the noise list and was itself consumed as an AI message.
4. The trailing `Follow-ups` block (5 suggested prompts) plus the `Pro` / `Free preview of advanced search enabled.` footer were absorbed as messages.

**What was fixed:** rather than patch the heuristic path, added a dedicated structural parser that trusts the one real marker instead of guessing speakers from wording.
- **`PPLX_STEP_MARKER`** = `/^\s*Completed\s+\d+\s+steps?\s*$/i` — the turn delimiter (also matches singular "1 step").
- **`PPLX_FOLLOWUPS_MARKER`** + **`PPLX_NOISE_LINES`** — tail-strip marker and chrome set.
- **`looksLikePerplexityStepFormat(raw)`** — returns true if any line matches the step marker; gate for whether to run the new path at all.
- **`parsePerplexityStepFormat(raw)`** — splits the transcript on the step markers (marker dropped). Text before the first marker = opening user question. Each middle segment = AI answer (all paragraph blocks except the last) + next user question (the final block). Final segment = last AI answer with the Follow-ups/footer tail cut. Returns `[]` when no marker is present so other parsers take over.
- Helpers: **`pplxStepClean`** (rstrip + drop chrome, preserve blank lines), **`pplxStepBlocks`** (split on blank lines), **`pplxStepStripTrailingChrome`** (cut at `Follow-ups`).
- **`parsePerplexity`** — now tries the step parser *first*. If the marker is present and it yields ≥2 messages with both roles, it returns immediately (`Parser choice: step-marker (structural)`). Otherwise it falls through to the existing HTML / plain candidates **completely unchanged**.

**Design note:** this path deliberately does NOT add a fourth copy of `looksShredded` / `scoreMessages` — it sidesteps the score contest entirely by keying on a real structural marker. Speakers are derived from document structure, not inferred from sentence content.

**Verified:**
- Real 5-turn paste → 10 messages (5 human / 5 AI), correct chronological order, via the structural path.
- Mid-answer headings and the answer's own closing question ("Would you like a simple breakdown…?") stayed inside the AI turn — not split off.
- Follow-ups suggestions + footer fully stripped — zero leakage into any message.
- Regression: a no-marker paste returns `looksLikePerplexityStepFormat === false`, skips the new path, and falls through to the label parser with no error (returned 2 messages on a labelled `You` / `Perplexity` test).
- `node --check` passes on the full extracted `<script>` block.
- Housekeeping: version comment + header badge bumped 2.5 → 2.6 (timestamp `00:06:26 UTC`).

**Known caveat:** assumes each user question is a single paragraph block. A single-line question — or a multi-line question with soft line breaks but no blank line — parses fine. Only a question containing a genuinely *blank* line would have its earlier paragraph(s) glued onto the preceding answer. Rare for Perplexity follow-ups, and covered by the HTML path when clipboard HTML is present.

---

### Tools

**`tools/index.html` — v1.0 (NEW PAGE)**
- Built from scratch — was a blank page
- Full SEO: title, description, canonical, OG, Twitter, structured data (`CollectionPage`)
- Lists AI Detector and AI to PDF Exporter as tool cards
- Links to blog (`/pages/blog/`) as separate section
- Comment `<!-- ADD NEW TOOLS BELOW THIS LINE -->` for easy future additions

**`tools/ai-detector/index.html` — v1.1**
- Added full title (was just "AI Writing Detector" with no brand)
- Added meta description
- Added canonical (`/tools/ai-detector/`)
- Added full OG tags with image
- Added Twitter card `summary_large_image`
- Added structured data (`WebApplication` schema)
- Fixed logo link (`#` → `/`)

---

### Pages

**`pages/pricing/`**
- Fixed canonical (`/pricing/` → `/pages/pricing/`)
- Fixed OG URL to match
- Added `og:image` and dimensions
- Added Twitter card
- Fixed "Start Exporting Free" button link (`/claude/` → `/exporters/claude/`)
- Fixed Stripe return redirect URLs to `/pages/pricing/`

**`pages/faq/`**
- Fixed canonical (`/faq/` → `/pages/faq/`)
- Fixed OG URL to match
- Added missing `og:description`
- Added `og:image` and dimensions
- Added Twitter card
- Added full `FAQPage` structured data (6 Q&As — eligible for Google rich results)
- Updated outdated content: "ChatGPT, Gemini, Copilot in development" → all live
- Fixed internal links (`/sample/` → `/pages/sample/`, `/pricing/` → `/pages/pricing/`)

**`pages/about/`**
- Fixed canonical (`/about/` → `/pages/about/`)
- Added full OG tags (were completely missing)
- Added Twitter card
- Updated roadmap: ChatGPT, Gemini, Copilot, Grok, Perplexity all changed from "Building/Planned" to "Live"
- Fixed CTA button link (`/claude/` → `/exporters/claude/`)

**`pages/sample/`**
- Fixed canonical (`/sample/` → `/pages/sample/`)
- Fixed OG URL to match
- Added `og:image` and dimensions
- Added Twitter card

**`pages/contact/`**
- Fixed canonical (`/contact/` → `/pages/contact/`)
- Fixed OG URL to match
- Added `og:description`
- Added `og:image` and dimensions
- Added Twitter card
- Fixed FAQ button link (`/faq/` → `/pages/faq/`)

**`pages/privacy/`**
- Fixed canonical (`/privacy/` → `/pages/privacy/`)
- Added full OG tags (were completely missing)
- Added Twitter card (`summary`)

**`pages/terms/`**
- Fixed canonical (`/terms/` → `/pages/terms/`)
- Added full OG tags (were completely missing)
- Added Twitter card (`summary`)

**`pages/sitemap/`**
- Added full OG tags
- Added Twitter card
- Added Tools index page (`/tools/`) as new entry
- Added Blog (`/pages/blog/`) as new section

---

### Blog

**`pages/blog/index.html`** — No changes needed, fully optimized

**All 5 blog posts** — All fully optimized, no changes needed:
- `why-copilot-silently-cuts-off-your-code/`
- `claude-vs-copilot-for-coding-honest-comparison/`
- `what-is-github-in-plain-english/`
- `github-web-ui-limits-command-line-vs-desktop/`
- `chrome-firefox-chromium-privacy-comparison/`

---

### New Files

**`pages/_blog-post-template.html`**
- Complete blog post template with `%%PLACEHOLDER%%` system
- All placeholders feed directly into SEO meta tags, OG, Twitter, and schema
- Warning comment at top: `⚠️ ALL %% PLACEHOLDERS MUST BE REPLACED`
- Checklist at bottom listing every placeholder and what it does
- CTA button updated to point to `/tools/` with label "See our free AI tools →"

---

## Google Search Console Actions Taken
- Sitemap submitted May 28 — Status: Success, 17 pages discovered
- Manually requested indexing for:
  - `exporters/grok/` (had wrong canonical pointing to /gemini/)
  - `exporters/copilot/`
  - `exporters/perplexity/`

---

## Session Notes — May 29, 2026 (analytics + architecture session)

- Submitted to Google Search Console yesterday — indexing not yet visible, expected delay 1–2 weeks
- Cloudflare Web Analytics confirmed active (JS snippet already installed) — 24 real visitors in last 24hrs, 31 page views
- Traffic is 100% direct or word-of-mouth right now (20 direct, 3 via Gmail on Android, 1 via chatgpt.com referral)
- `notavello.com/exporters/chatgpt/` has a **Poor LCP** in Core Web Vitals — root cause is `vfs_fonts.js` (~1.5MB) loading synchronously in `<head>` before render. Fix: lazy-load pdfmake only on download click
- **[RESOLVED May 30, 2026] Worker URL no longer exposes personal name.** Previously the Worker was served at `notavello-worker.<account-subdomain>.workers.dev`, which leaked the account name in View Source. Fix applied: added a Custom Domain (`api.notavello.com`) to the `notavello-worker` Worker via the Cloudflare dashboard (Worker → Domains), then updated every `fetch()` call across all exporter pages, `login.html`, and `pages/pricing.html` to use `https://api.notavello.com`. The old `workers.dev` Worker URL **and** Preview URL were disabled (set Inactive in the dashboard) so the name-bearing endpoints no longer respond. Verified live: `api.notavello.com/check-access` returns "Notavello Worker running." Deploy flow is dashboard/GitHub upload — no Wrangler in use, so the disabled workers.dev route stays disabled.

---

## Session Notes — May 30, 2026 (Worker URL migration + external dependency sweep)

**Goal:** the Worker's default URL `notavello-worker.mikekoga.workers.dev` exposed Mike's Cloudflare account name (`mikekoga`) publicly — visible in View Source on every exporter page. Remove it.

**What was done:**
- Added Custom Domain `api.notavello.com` to the `notavello-worker` Worker (Cloudflare → Workers & Pages → notavello-worker → **Domains** tab → Add Domain → Connect domain → typed `notavello.com` to surface the zone, then set host `api`). DNS record auto-created. `notavello.com` was already an active Cloudflare zone, so no nameserver change was needed.
- Disabled BOTH the `workers.dev` **Worker URL** and the **Preview URL** (set Inactive in the Domains tab). Deploy flow is dashboard / GitHub-upload only (no Wrangler), so they stay disabled permanently.
- Updated every `fetch()` call from the old host → `https://api.notavello.com` across: `login.html`, `pages/pricing.html`, and exporters `claude`, `grok`, `perplexity`, `gemini`, `copilot`, `other`. (`chatgpt` was already on the new URL.) Deployed via GitHub → Cloudflare Pages.
- **Easy-to-miss external dependency:** the **Stripe webhook** endpoint was still pointing at the old host. Fixed in Stripe Workbench → Webhooks → `upbeat-glow` → **Edit destination** → URL set to `https://api.notavello.com/stripe-webhook`. Edited the *existing* destination (NOT recreated), so the signing secret (= `STRIPE_WEBHOOK_SECRET`) is unchanged and the Worker keeps validating events.

**Verifications performed (all passed):**
- Live page source check on `notavello.com/exporters/grok/`: zero `mikekoga` hits.
- Webhook resend of a past `checkout.session.completed`: **200 OK**, `{"received": true}`, status Delivered/Recovered. Welcome email delivered to test inbox.
- Stripe Event destinations list: exactly **one** destination (`upbeat-glow` → `api.notavello.com`), Active, **0% error rate**. No stale duplicate.
- Front-half checkout: clicked Upgrade on the live ChatGPT exporter → reached the real Stripe checkout page. (Tested on ChatGPT because Claude's paywall threshold is higher.)
- Worker code reviewed (pasted from dashboard, NOT added to repo — see Standing Decision #12): `success_url`/`cancel_url` correctly point to `notavello.com`; CORS `Access-Control-Allow-Origin` = `https://notavello.com`; no old host anywhere.
- CMS at `/admin/` (Decap CMS): loads **blank** — never configured. NOT a migration issue. Site and blog pages work independently of it.

**External dependency sweep — results:**
- Worker code ✓ clean · Stripe webhook + destinations ✓ clean · CMS OAuth N/A (unconfigured) · repo files (`_worker.js`, `_redirects`, GitHub Action, all pages) ✓ clean.
- Remaining low-probability / optional, NOT checked but almost certainly fine: Cloudflare Workers Routes, GitHub repo webhooks, Resend inbound webhooks. Rule of thumb: anything that *calls into / redirects to* the Worker needs the new address; anything the Worker *calls out to* (Anthropic, Resend send, Stripe API) is unaffected.

**Positive side effect discovered (verify when convenient):**
- The session cookie (`/verify-code` route) is set with `Domain=notavello.com`. On the OLD `workers.dev` host — a different registrable domain — browsers would have *rejected* that cookie, so "stay logged in / restore access" likely never persisted. Now that the Worker is at `api.notavello.com` (a subdomain of `notavello.com`), the cookie is valid. **ACTION:** log in via the restore-code flow and reload the page to confirm the session now sticks.

**Polish items noted (non-urgent):**
- Welcome email em-dash renders as `â€"` — set the email body to UTF-8 in the Resend send call.
- `success_url` always returns to `/exporters/claude/` regardless of which exporter the customer upgraded from — consider returning to the originating exporter.
- Optional: centralize the API base into a shared `/config.js` (currently `https://api.notavello.com` is hardcoded ~30× across 8 files). Would make a future domain change a one-line edit.
- `versions/CHANGELOG.md` contains a test email (`stanturlock@netzero.net`) — Mike confirmed it's his own fake address; left as-is.

---

## Known Remaining Issues
- `sitemap.xml` may need updating to include `/tools/` and `/pages/blog/` if not already there — check
- Cloudflare bot settings block Claude's web fetch tool — not fixable on free plan, not a Googlebot issue
- Homepage version badge shows `ROOT-2.0 · HH:MM:SS UTC` — dev artifact, consider removing
- `looksShredded`, `scoreMessages`, the chooser guard, and the `checkConfidence` shred warning are now copy-pasted identically across the Gemini and Copilot pages. When ChatGPT gets a parser, it will need a third manual copy. **Recommended action:** extract into a shared parser utility module before adding ChatGPT support.
- **Perplexity's non-marker path still has the pre-fix scorer.** The Gemini/Copilot shred fixes (`looksShredded`, the `total * 4` scorer, the chooser guard, the `checkConfidence` shred warning) were never ported to Perplexity — it still uses the old `total * 10` scorer and blind `htmlBalanced` trust. The new `perplexity-2.6` step-marker path sidesteps this whenever a `Completed N steps` marker is present, but Perplexity pastes *without* that marker (clipboard-HTML-only, or future label formats) still run through the unfixed scorer. Port the shred fixes — or better, the shared module above — to Perplexity too.

---

## Active Development Priorities (unchanged)
1. **[DONE] Name removed from Worker URL** — now served at `api.notavello.com` via Custom Domain; workers.dev disabled. (Optional future polish: centralize the API base into one shared `config.js` so a future domain change is a one-line edit instead of editing ~30 lines across 8 files. Not urgent.)
2. **LCP fix on chatgpt exporter** — lazy-load pdfmake + vfs_fonts.js on download click instead of in `<head>`
3. Cloudflare Worker implementation
4. Haiku 4.5 speaker validation
5. Auto-versioning
6. Stripe integration ($5/mo)
7. Paywall enforcement (30 message limit — UI exists, not yet enforced)
8. ChatGPT + Gemini support improvements
