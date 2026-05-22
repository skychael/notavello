# NOTAVELLO — FULL SESSION HISTORY
> Append-only. Never overwrite. Never summarize away detail.
> This file exists so future Claude sessions can understand not just
> WHAT changed but WHY, what was tried, what failed, and what decisions
> were made. Read this before touching anything.

---

## SESSION 6 · May 22, 2026 (evening)

### What we found
The PDF output was completely broken — every single message was blue
(all labeled as human). Mike uploaded a real conversation export PDF
and the debug panel showed 0 AI messages. This was the "everything blue" bug.

### Diagnosis
We compared claude-1.3 (last known good) with claude-1.6 (current).
The parseClaude() function was IDENTICAL between versions — the parser
itself had not been broken by recent sessions. The real problem was
architectural: the parser assumes the first block of text before the
first timestamp is always the human. But many conversations start with
Claude responding first (e.g. after an artifact or a long AI message).
In those cases, the entire first block — which could be hundreds of
words of AI text — gets labeled human, and everything downstream is
wrong by one.

### What we tried first
We considered rolling back to claude-1.3. Mike found it in GitHub
commit history (a few hours old). We read both files and confirmed
the parser was identical, so rollback would not have fixed the bug.

### The fix (claude-1.7)
Added first-speaker detection to parseClaude(). Before assigning
the first block as human, the parser now checks three signals:
1. Is the block longer than 120 characters?
2. Does it contain no question mark?
3. Does it start with a word Claude commonly uses to open a response?
   (Sure, Of course, Great, Here, I , Let me, To , Based on, etc.)
If all three true → flip first block to AI role.

### Test result
367-message conversation: 183 human / 184 AI. Near-perfect alternation.
Page heights all normal (1054px baseline). Previously was 125 pages of
all-blue. Now correct. Mike confirmed preview "appears to work."

### Important caveat — this is NOT a complete fix
This was one successful example. Still broken/unhandled:
- AI openers not in the detection word list
- Short AI responses that don't trigger the 120-char length check
- Manual selection format (You said: / Claude responded:) fully unsupported
- Tool-use labels bleeding in
- Watermark text fragmenting in PDF text layer (pdfmake limitation)
Claude-1.7 fixed one pattern. The real fix is the AI validation layer.

### Decisions made this session
1. Cloudflare Worker is the #1 priority — everything depends on it
   - AI speaker validation needs it (API key must be server-side)
   - Auto-versioning to versions/ folder needs it (GitHub API calls)
   - Footer injection needs it
   - Source code hiding needs it
2. AI validation layer (Haiku 4.5, ~$0.0009/export) is next after Worker
3. Stop patching the parser further until Worker + AI layer exist
4. versions/ folder system created this session — HANDOFF.md, CHANGELOG.md
5. .gitignore added to hide versions/ if repo ever goes public
6. Auto-versioning agreed: Worker will commit snapshots to versions/
   automatically using version number already in the code. No manual rename.

### Cost analysis done this session
Haiku 4.5: $1.00 input / $5.00 output per million tokens
Per export (20 lines only): ~$0.0009 (less than a tenth of a cent)
At 50,000 users/month with 4% conversion = $10,000 revenue, $45 AI cost.
Conclusion: AI validation is essentially free at any realistic scale.

### What was NOT done this session
- claude-1.7.html snapshot not added to versions/ folder
- Cloudflare Worker not started (agreed as next session priority)
- Stripe not started
- Manual selection format not fixed

---

## SESSION 5 · May 22, 2026 (morning)

### What we did
- Fixed textarea visibility: was transparent/invisible, users couldn't
  see where to paste. Added #FAFBFF background, 1.5px border, 10px
  border-radius, 16px margin inside card. Focus state sharpens to accent.
  This was claude-1.6.
- Updated AI order across all pages to market share order (was wrong):
  ChatGPT (~65-80%) first, Gemini (~18%), Copilot (~5%), Claude (~2%) last.
  Claude listed last but only working one — has "Live now" badge.
  This was claude-1.5.
- Created versions/ folder on GitHub with:
  - HANDOFF.md (living current-state document)
  - CHANGELOG.md (this file — full session history)
  - claude-1.6.html (first rollback snapshot)
  - .gitignore (hides versions/ from public if repo goes public)

### Why the versions folder was created
Sessions keep breaking things that were working. Comments in the HTML
file are not enough — they're invisible to Mike, can't be diffed,
and disappear when sessions go wrong. Multiple sessions have burned
hours re-explaining context. The versions folder gives future Claude
sessions a complete readable history without relying on the HTML comments.

### Decisions made
- HANDOFF.md: always current state, overwritten each session
  (GitHub commit history preserves all past versions)
- CHANGELOG.md: append-only, full narrative, never summarized away
- claude-X.X.html snapshots: permanent, one per version, never overwritten
- .gitignore: versions/ hidden from public — contains strategy,
  monetization, bug details, roadmap. Not for public consumption.
- GitHub is the source of truth. No local copies needed.
  Cloudflare deploys from GitHub automatically.

---

## SESSION 4 · Pre-May 22, 2026

### What we did
- Built full site footer added to all pages
- Navigation: AI exporters (by market share), product links, legal links
- Footer copy-pasted into every file — not JS-injected
- Reason: static HTML footer links better for SEO than JS-rendered
- Cloudflare Worker migration will fix footer update pain later
- Root landing page (root-1.0) created at notavello.com/
- Previously claude/ was effectively the homepage — wrong architecture

### Footer order rationale
ChatGPT listed first (market share leader), then Gemini, Copilot, Claude.
Claude listed last but has "Live now" badge since it's the only working one.
This order was debated — SEO benefit of Claude first vs accuracy of
market share order. Market share order won.

---

## SESSION 3 · Pre-May 22, 2026

### What we did
- claude-1.3: BUG 5 partial fix — file attachments, image IDs, artifact
  labels now replaced with [Attachment] placeholders instead of bleeding
  through as raw text in PDF exports
- claude-1.2: BUG 4 warning expanded with full fix-attempt history
  to prevent future sessions from spiraling into the same band-aid loop

### BUG 4 history — READ THIS BEFORE TOUCHING PAGE BREAK LOGIC
Multiple Claude sessions attempted to fix the preview simulation.
Each time the session convinced itself the problem was clear, applied
a fix, broke something else, applied another fix, and spiraled into
circular band-aid loops. Sessions had to be fully reset multiple times.
The v0.080 empty height baseline approach is the best solution found.
THE PREVIEW IS A SIMULATION. THE PDF IS THE REAL OUTPUT. DO NOT TOUCH.

---

## SESSION 2 · Pre-May 22, 2026

### What we did
- claude-1.1: Removed personal info from HTML comments (email, project URLs)
  Reason: HTML comments visible to anyone doing Ctrl+U View Source
  Full resolution: Cloudflare Worker migration (source no longer exposed)
- claude-1.0: Changed to per-file independent versioning
  Previously single shared version across all files — confusing
  Now: root-X.X, claude-X.X, chatgpt-X.X etc are completely independent
  Updating claude NEVER changes root version. This is intentional.

---

## SESSION 1 · Pre-May 22, 2026

### What we did
- v0.095: AI_NAME variable added. All UI strings pull from const AI_NAME
  When copying file for new AI, change ONLY this one value.
  Exception: SEO meta tags and parser regexes stay hardcoded.
  AI selector UI removed, replaced with "Not using Claude?" link.
- v0.094: Moved to notavello.com/claude/. Root landing page created.
  URL structure locked in before significant Google indexing.
  DO NOT move without 301 redirects — will lose SEO.
- v0.093: Watermark tuned. Bands removed, opacity 7%→18%.
  Mike confirmed "perfect" after live testing. Do not change without asking.
- v0.092: Watermark bands added — too aggressive, reverted next version.
- v0.091: Floating download bar, bottom download button, yellow hint bar.
- v0.090: Claude-only release. Multi-platform parser stripped.
- v0.080: Rolled back to clean empty height approach.
  Previous multi-parser attempt failed completely for ChatGPT and Gemini.
  Their copy-paste formats change with every UI update — unmaintainable.
  Decision: one standalone file per AI. FINAL. Do not revisit.
- v0.4: BUG 1 FIXED — user replies caught inside AI block.
- v0.3: Multi-platform parser attempted (Claude, ChatGPT, Gemini).
  Failed completely. This is why we use one file per AI.
- v0.2: UI redesign — modern, rounded, gradient style.
- v0.1: Initial build.

---

## STANDING DECISIONS — DO NOT REVISIT WITHOUT MIKE'S EXPLICIT DIRECTION

1. ONE FILE PER AI. No unified parser. No auto-detection. Final.
2. DO NOT touch BUG 4 (preview simulation) without reading full v0.075 history
3. DO NOT move any URL without 301 redirects in _redirects file
4. DO NOT add founder name to about page without asking Mike
5. DO NOT sync version numbers across files — each file independent
6. Watermark confirmed perfect at v0.093 — do not change
7. Debug panel stays until Mike explicitly decides to remove it
8. Footer copy-pasted per file (not JS) until Cloudflare Worker exists
9. Cloudflare Worker is next priority — everything else depends on it
