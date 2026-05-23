# NOTAVELLO — LIVING HANDOFF FILE
> **⚠️ BEFORE CLOSING ANY SESSION: say "wrap up" so Claude updates this file.**
> **START OF EVERY SESSION: upload `claude/index.html` + this file.**

Last updated: May 22, 2026 — Session 7
Current versions: `root-1.1` · `claude-1.7`

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

## FILE STRUCTURE (as of Session 7)

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
.gitignore        ← Hides versions/ folder if repo goes public
```

### AI parser pages
```
claude/index.html   ← MAIN WORKING FILE (claude-1.7)
chatgpt/            ← NOT BUILT YET
gemini/             ← NOT BUILT YET
copilot/            ← NOT BUILT YET
```

### Versions folder
```
versions/HANDOFF.md       ← This file
versions/CHANGELOG.md     ← Full version history
versions/claude-1.6.html  ← Snapshot (NOTE: claude-1.7 snapshot not yet added)
```

---

## VERSIONING RULES — NEVER SKIP THIS

Every change to claude/index.html must bump ALL THREE:
1. Version in the comment header
2. Badge: `<div class="badge">Free Preview · claude-X.X</div>`
3. Debug panel string: `"Notavello Debug · claude-X.X"`

---

## ARCHITECTURE — DO NOT VIOLATE

**ONE FILE PER AI. No shared parser. No auto-detection.**
A unified multi-AI parser was tried and failed. Decision is final.

**AI_NAME variable:** `const AI_NAME = 'Claude';`
When copying for chatgpt/index.html — change ONLY this one value.

---

## PARSER SYSTEM (claude-1.7)

### What works:
- Ctrl+A copy format with timestamps on their own lines
- First-speaker detection: if block before first timestamp is long,
  has no question mark, and starts with a Claude-style opener,
  it gets correctly labeled as AI instead of human
- Confidence check flags bad human/AI ratios
- Attachment placeholders replace raw metadata

### What is still broken/unhandled:
- Manual selection format (You said: / Claude responded:) — unsupported
- AI openers not in the detection list may still misattribute
- Short AI responses may not trigger length check
- Tool-use labels still bleed in ("Searched the web" etc)
- Watermark text fragments into PDF text layer (pdfmake limitation)
- This is NOT foolproof — claude-1.7 fixed one pattern, not all

### Known bugs:
| # | Status | Description |
|---|--------|-------------|
| 2 | OPEN | Single-char replies show as AI in edge cases |
| 3 | OPEN | Timestamps embedded in AI text cause false splits |
| 4 | **DO NOT TOUCH** | Preview is simulation not PDF renderer. Multiple sessions spiraled fixing this. Do not touch without reading full history from v0.075 and explicit Mike instruction. |
| 5 | OPEN | Images can't export. Shows [Attachment] placeholder. Mike hasn't decided whether to tell users upfront. |
| 6 | OPEN | Claude tool-use labels bleed into export. Stripping risky. Leave as-is. |
| 8 | OPEN | Watermark fragments into PDF text layer. pdfmake limitation. |

---

## NEXT STEPS (priority order as of Session 7)

1. **Cloudflare Worker** — THIS IS THE PREREQUISITE FOR EVERYTHING ELSE
   - Hides source code from View Source
   - Enables AI speaker validation API call safely (API key server-side)
   - Enables auto-commit of version snapshots to versions/ folder on GitHub
   - Fixes chatscript.pages.dev naming issue
   - Enables server-side footer injection

2. **AI speaker validation layer** — once Worker exists
   - Send first ~20 lines to Haiku 4.5 (~$0.0009 per export)
   - AI checks speaker attribution, flags errors
   - Catches what code parser misses
   - Targeted and surgical — not full conversation read

3. **Auto-versioning via Worker**
   - On each deploy, Worker commits snapshot to versions/ on GitHub
   - File named automatically using version number already in code
   - No manual rename, no drag and drop
   - Completely automatic

4. **Stripe** — $5/month removes watermark

5. **Investigate auto-redaction checkbox** — Does it exist in the product yet?
   Where is it in the UI? Does it actually work? Needs answer before FAQ copy
   about redaction can be trusted as accurate.

6. **Verify 30-message limit enforcement** — Confirm how the limit actually
   works in claude/index.html (truncated? blocked? prompt shown?). Pricing
   and FAQ copy was updated to say "truncated at 30, prompt to upgrade shown"
   but this needs to be verified against the actual code.

7. **BUG 5 decision** — Tell users about image limitation upfront?

8. **Domain emails** — Set up hello@, legal@, bugs@, and billing@notavello.com
   (contact.html now uses bugs@ and billing@ as separate addresses)

9. **Google Search Console** — Submit sitemap.xml

10. **chatgpt/index.html** — Need real paste sample from Mike first

11. **gemini/index.html** — Same

12. **robots.txt** — Add to root

13. **Remove debug panel** — Only when Mike explicitly decides

---

## CLOUDFLARE WORKER — WHAT IT IS & WHY IT MATTERS

A Worker is a small piece of server-side JavaScript that runs on
Cloudflare's servers between the user's browser and your site.
It can:
- Hold API keys securely (not visible in browser source)
- Make API calls to Anthropic for AI speaker validation
- Make API calls to GitHub to auto-commit version snapshots
- Inject the footer into every page automatically

This is the single most important infrastructure piece.
Everything good depends on it.

---

## COST ESTIMATES (AI validation layer)

Model: Claude Haiku 4.5
Price: $1.00 input / $5.00 output per million tokens
Per export (first 20 lines only): ~$0.0009
At scale:
- 1,000 exports = $0.90
- 10,000 exports = $9.00
- 50,000 exports = $45.00
Revenue at 4% conversion: 50,000 users = $10,000/month
AI cost at that scale: $45. Essentially free.

---

## WATERMARK
- Diagonal: NOTAVELLO.COM · 52pt · -45° · 18% opacity · #4F46E5
- Mike confirmed "perfect" at v0.093. Do not change without asking.

---

## FOOTER (all pages)
Same footer copy-pasted into every file (not JS-injected — SEO).

AI order (market share): ChatGPT (soon) · Gemini (soon) · Copilot (soon) · Claude (live)
Product: Pricing · FAQ · Sample PDF · About · Sitemap
Bottom: © 2026 Notavello. Made in Reno, NV. · Privacy · Terms · Contact

---

## SEO STATUS
- Full SEO heads on root and claude pages
- sitemap.xml exists — not yet submitted to Google Search Console
- Missing: robots.txt, Search Console setup, structured data

---

## ABOUT PAGE NOTE
No founder name. Human + AI collaboration framing. Do NOT add name without asking Mike.

---

## CONTACT EMAILS
Current state in contact.html:
- hello@notavello.com — general questions & feedback
- bugs@notavello.com — bug reports (new this session)
- billing@notavello.com — billing & account (new this session)
- legal@notavello.com — legal & privacy
All can forward to the same inbox. None are set up yet in Cloudflare.

---

## CLOUDFLARE / GITHUB NOTES
- Cloudflare Pages project: notavello
- Auto-deploys from GitHub main branch
- .pages.dev shows "chatscript.pages.dev" — harmless leftover, leave it
- GitHub upload gotcha: "Add file → Upload files" does NOT overwrite existing files
  To update: click file → pencil → select all → paste → commit
- Commit messages should describe what changed

---

## TECH STACK
- Single HTML file per AI (no build step)
- pdfmake via CDN
- Cloudflare Pages → GitHub main branch
- No backend currently
- Next: Cloudflare Worker + Cloudflare D1

---

## SESSION LOG

| Session | Date | Key changes |
|---------|------|-------------|
| 1–4 | Pre-May 2026 | See CHANGELOG.md for full history |
| 5 | May 22, 2026 (morning) | Textarea visible (claude-1.6). versions/ folder, HANDOFF.md, CHANGELOG.md, .gitignore created |
| 6 | May 22, 2026 (evening) | Diagnosed all-blue PDF bug. claude-1.7: first-speaker detection added. Confirmed working on 367-message conversation (183 human / 184 AI). Agreed Cloudflare Worker is next priority. AI cost analysis done (~$0.0009/export with Haiku 4.5). |
| 7 | May 22, 2026 (night) | Site copy edits from Corrections.txt. about.html: removed "Reno, NV" from origin card, changed "UI" → "user interface". faq.html: removed "each AI gets its dedicated page" line, added cancel transparency line. contact.html: split into 4 unique email addresses (hello@, bugs@, billing@, legal@). pricing.html: expanded 30-message limit description. Two items from corrections deferred to morning: auto-redaction checkbox (does it exist/work?), and verification of how the 30-message limit is actually enforced in code. |

---
*This file replaces all numbered handoff notes.*
*Do not create handoff_note_may22_7.txt — update this file instead.*
