# NOTAVELLO — LIVING HANDOFF FILE
> **⚠️ BEFORE CLOSING ANY SESSION: say "wrap up" so Claude updates this file.**
> **START OF EVERY SESSION: upload `claude/index.html` + this file.**

Last updated: May 22, 2026 — Session 5
Current versions: `root-1.1` · `claude-1.6`

---

## WHAT NOTAVELLO IS
Paste an AI conversation → get a clean, color-coded PDF.
- User messages: blue. AI responses: plain text.
- Free tier: watermarked, 30 msg limit.
- Paid tier: $5/month, watermark-free, unlimited. (Stripe not yet built.)
- Target users: lawyers, consultants, business users.

## LIVE URLS
- Product: notavello.com
- Redirect: notavello.net → notavello.com (301)
- GitHub: github.com/skychael/notavello (PRIVATE)
- Hosting: Cloudflare Pages (auto-deploys from GitHub main branch)
- Owner: Mike Koga · GitHub: skychael · Location: Reno, NV

---

## FILE STRUCTURE (as of Session 5)

### Root level (notavello.com/)
```
index.html        ← Master landing page (root-1.1)
sitemap.xml       ← Google sitemap
about.html        ← About page (no founder name — intentional)
contact.html      ← Contact page
faq.html          ← FAQ
pricing.html      ← Free vs $5/month Pro
privacy.html      ← Privacy policy (Nevada law)
sample.html       ← Sample PDF (generated on the fly)
sitemap.html      ← Human-readable sitemap
terms.html        ← Terms of service
```

### AI parser pages
```
claude/index.html   ← MAIN WORKING FILE (claude-1.6)
chatgpt/            ← NOT BUILT YET
gemini/             ← NOT BUILT YET
copilot/            ← NOT BUILT YET
```

### Versions folder (NEW — added Session 5)
```
versions/HANDOFF.md     ← This file
versions/CHANGELOG.md   ← Full version history
versions/claude-1.6.html  ← Snapshot of current working file
```

> Note: Supporting pages live at ROOT as flat .html files, not subfolders.
> e.g. notavello.com/about.html NOT notavello.com/about/index.html

---

## VERSIONING RULES — NEVER SKIP THIS

Each file has its own independent version. Never sync them.

| Prefix | File |
|--------|------|
| root-X.X | notavello.com/index.html |
| claude-X.X | notavello.com/claude/index.html |
| chatgpt-X.X | future |
| gemini-X.X | future |

**For claude/index.html — every change must bump ALL THREE:**
1. Version in the comment header
2. Badge: `<div class="badge">Free Preview · claude-X.X</div>`
3. Debug panel string: `"Notavello Debug · claude-X.X"`

All three must match or Mike can't verify live vs local.

---

## ARCHITECTURE — DO NOT VIOLATE

**ONE FILE PER AI. No shared parser. No auto-detection.**

A unified multi-AI parser was tried and failed completely.
ChatGPT and Gemini paste formats change with every UI update.
This decision is final. Do not revisit it.

**AI_NAME variable:**
`const AI_NAME = 'Claude';`
When copying to make chatgpt/index.html — change ONLY this one value.
All UI strings pull from it. Exception: SEO meta tags and parser regexes stay hardcoded.

---

## PARSER SYSTEM (claude-1.6 — Three-Layer Architecture)

### Two copy formats handled:

**Format A** (Ctrl+A — standard):
```
[user text]
9:14 AM
[AI text]
[user text]
9:16 AM
```
Timestamps on their own lines. Parser: `parseClaude()`

**Format B** (Manual selection):
```
You said: [user text] timestamp PM
Claude responded: [AI text]
```
Labels at line start. Parser: `parseClaudeManual()`

**Detection:** `detectFormat()` checks for "You said:" at line start.
If found → `parseClaudeManual()`. If not → `parseClaude()`.

### Three layers:
1. Format auto-detection (invisible to user)
2. Confidence check — flags bad human/AI ratio
3. Speaker prompt UI — "Who speaks first?" Only appears if genuinely ambiguous.

---

## KNOWN BUGS

| # | Status | Description |
|---|--------|-------------|
| 2 | OPEN | Single-char replies show as AI in edge cases |
| 3 | OPEN | Timestamps embedded in AI text cause false splits |
| 4 | **DO NOT TOUCH** | Preview is a simulation, not a real PDF renderer. Multiple sessions tried to fix this and spiraled. PDF output is correct. Do not touch without reading full history from v0.075 and explicit instruction from Mike. |
| 5 | OPEN | Images can't export — copy-paste is text only. Shows [Attachment] placeholder. Mike hasn't decided whether to tell users upfront. |
| 6 | OPEN | Claude tool-use labels bleed into export ("Searched the web" etc). Stripping is risky — could delete real content. Leave as-is. |
| 8 | OPEN | Manual parser produces extreme page heights on large conversations (101,729px observed). Likely _emptyHeight logic misfiring. LOW PRIORITY. Do not touch without understanding BUG 4 first. |

---

## WATERMARK
- Diagonal: NOTAVELLO.COM · 52pt · -45° · 18% opacity · #4F46E5
- Rotating footer watermark text as secondary nudge
- Mike confirmed "perfect" at v0.093. Do not change without asking.

---

## FOOTER (all pages)
Same footer copy-pasted into every file (not JS-injected — better for SEO).

**Section 1 — AI Exporters (market share order):**
ChatGPT (soon) · Gemini (soon) · Copilot (soon) · Claude (live)

**Section 2 — Product:**
Pricing · FAQ · Sample PDF · About · Sitemap

**Bottom:** © 2026 Notavello. Made in Reno, NV. · Privacy Policy · Terms of Service · Contact

AI order rationale: ChatGPT ~65-80%, Gemini ~18%, Copilot ~5%, Claude ~2%.
Claude listed last by share but only working one — has "Live now" badge.

---

## SEO STATUS
- Full SEO heads on root and claude pages (title, description, canonical, OG, Twitter Card)
- sitemap.xml exists — **not yet submitted to Google Search Console**
- Missing: robots.txt, Search Console setup, structured data/schema

---

## ABOUT PAGE NOTE
Deliberately does NOT name Mike Koga. Framing: human + AI collaboration.
"The world is filling up with software built this way — most won't tell you. We will."
**Do NOT add a founder name without asking Mike first.**

---

## CONTACT EMAILS (not yet set up)
- hello@notavello.com — general / feedback / bugs
- legal@notavello.com — legal / privacy

---

## CLOUDFLARE / GITHUB NOTES
- Cloudflare Pages project name: notavello
- Auto-deploys from GitHub main branch
- The .pages.dev URL shows "chatscript.pages.dev" — cosmetic leftover, harmless, leave it
- **GitHub upload gotcha:** "Add file → Upload files" does NOT overwrite existing files. To update: click file → pencil → select all → paste → commit.
- GitHub sometimes duplicates files on upload — remove duplicates before committing.
- Committing rapidly creates a Cloudflare deployment queue — wait, don't cancel.
- **Commit messages should describe what changed**, not just "Add files via upload."

---

## NEXT STEPS (priority order as of Session 5)

1. **BUG 8** — Fix manual parser extreme page heights on large conversations
2. **BUG 5 decision** — Tell users about image limitation upfront, or let them discover it?
3. **Stripe** — $5/month removes watermark. pricing.html and terms.html already exist.
4. **Domain emails** — Set up hello@ and legal@notavello.com
5. **Google Search Console** — Submit sitemap.xml
6. **Email capture** — After first download, non-blocking
7. **chatgpt/index.html** — Copy claude file, change AI_NAME, need real paste sample from Mike
8. **gemini/index.html** — Same process
9. **robots.txt** — Add to root
10. **Cloudflare Worker** — Hides source, enables server-side footer injection, fixes chatscript.pages.dev
11. **Remove debug panel** — Only when Mike explicitly decides

---

## PRODUCT ROADMAP
- Phase 1: Web app (IN PROGRESS)
- Phase 2: Chrome extension ($5 one-time) — fixes image problem
- Phase 3: Firefox + Edge (free)
- Phase 4: Safari ($99/year Apple dev)
- Phase 5: Android ($25 one-time)
- Phase 6: iOS (same Apple account)
- Future: B2B API

---

## TECH STACK
- Single HTML file per AI (no build step)
- pdfmake via CDN
- Cloudflare Pages → GitHub main branch
- No backend currently
- Future: Cloudflare Worker + Cloudflare D1

---

## SESSION LOG

| Session | Date | Key changes |
|---------|------|-------------|
| 1–4 | Pre-May 2026 | See CHANGELOG.md for full history |
| 5 | May 22, 2026 | Textarea made visible (border + background). Versions folder created. HANDOFF.md and CHANGELOG.md introduced. claude-1.5 → claude-1.6 |

---
*This file replaces all numbered handoff notes (handoff_note_may22_1 through _5).*
*Do not create handoff_note_may22_6.txt — update this file instead.*
