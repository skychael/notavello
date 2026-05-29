# Notavello Handoff — May 29, 2026

## Session Summary
Two sessions this date:

1. **Full site SEO audit and fix** across all 17 pages. Every page now has correct canonicals, OG tags, Twitter cards, and structured data. Several pages had broken internal links and outdated content that were also fixed. Blog template created. Tools page built from scratch.
2. **Gemini + Copilot parser rework.** Gemini was shredding single responses into dozens of fake alternating turns. Copilot's label parser wasn't recognising the real "You said" / "Copilot said" markers and its noise list was full of Gemini/Google leftovers. Both fixed and verified against real paste input.

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

**`exporters/perplexity/` — v2.5**
- Fixed canonical URL (`/perplexity/` → `/exporters/perplexity/`)
- Fixed OG URL to match
- Added `og:image` and dimensions
- Upgraded `twitter:card` to `summary_large_image`
- Added `twitter:image`
- Added full structured data (`WebApplication` schema)

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

## Known Remaining Issues
- `sitemap.xml` may need updating to include `/tools/` and `/pages/blog/` if not already there — check
- Cloudflare bot settings block Claude's web fetch tool — not fixable on free plan, not a Googlebot issue
- Homepage version badge shows `ROOT-2.0 · HH:MM:SS UTC` — dev artifact, consider removing
- `looksShredded`, `scoreMessages`, the chooser guard, and the `checkConfidence` shred warning are now copy-pasted identically across the Gemini and Copilot pages. When ChatGPT gets a parser, it will need a third manual copy. **Recommended action:** extract into a shared parser utility module before adding ChatGPT support.

---

## Active Development Priorities (unchanged)
1. Cloudflare Worker implementation
2. Haiku 4.5 speaker validation
3. Auto-versioning
4. Stripe integration ($5/mo)
5. Paywall enforcement (30 message limit — UI exists, not yet enforced)
6. ChatGPT + Gemini support improvements
