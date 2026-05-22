# NOTAVELLO — CHANGELOG
> Append-only. Newest versions at the top. Never delete entries.
> Updated by Claude at end of every session.

---

## claude-1.6 · May 22, 2026 · Session 5
**Changed:** Textarea input area made visually distinct.
- Background: `transparent` → `#FAFBFF`
- Added `1.5px solid var(--border)` border with `border-radius: 10px`
- Added `16px` margin so textarea floats inside the card
- Focus state: border sharpens to accent indigo
**Why:** Users couldn't see where the text input area was — it blended into the card.
**Also this session:** Versions folder created. HANDOFF.md and CHANGELOG.md introduced.
**Known issues introduced:** None.
**Suggested commit message:** `claude-1.6: textarea border + background, versions folder added`

---

## claude-1.5 · May 2026 · Session 5
**Changed:** AI order updated across all pages to reflect real market share.
- ChatGPT first (~65-80%), Gemini second (~18%), Copilot third (~5%), Claude last (~2%)
- Claude stays live/active, others remain "coming soon"
**Why:** Previous order didn't reflect actual market share — matters for credibility.
**Known issues introduced:** None.
**Suggested commit message:** `claude-1.5: AI market share order corrected across all pages`

---

## claude-1.4 · Session 4
**Changed:** Full site footer added to all pages.
- Navigation links for all current and future AI pages
- Product links: Pricing, FAQ, Sample PDF, About, Sitemap
- Legal links: Privacy Policy, Terms of Service, Contact
- Footer CSS added, mobile responsive
**Why:** No footer existed — pages had no navigation or legal links.
**Known issues introduced:** Footer is copy-pasted into every file (not injected). Updating it means touching every file. Accepted tradeoff for SEO.
**Suggested commit message:** `claude-1.4: site footer added to all pages`

---

## claude-1.3 · Session 3
**Changed:** BUG 5 partial fix — file attachments, image IDs, artifact labels.
- Now replaced with `[Attachment]` placeholders instead of bleeding through as raw text
**Why:** Raw attachment metadata was appearing in PDF exports, confusing users.
**Known issues introduced:** Actual image data still cannot be recovered from copy-paste — fundamental limitation. Browser extension (Phase 2) is the real fix.
**Suggested commit message:** `claude-1.3: attachment placeholders replace raw metadata in exports`

---

## claude-1.2 · Session 3
**Changed:** BUG 4 warning expanded with full history to prevent future sessions from attempting to fix the preview simulation.
- Band-aid loop history documented in comment header
**Why:** Multiple sessions had tried to fix the preview, each spiraling into circular band-aid loops requiring full resets.
**Known issues introduced:** None.
**Suggested commit message:** `claude-1.2: BUG 4 warning expanded, fix-attempt history documented`

---

## claude-1.1 · Session 2
**Changed:** Personal info removed from HTML comments.
- Email and other project URLs removed from View Source exposure
- View Source note added
**Why:** HTML comments are visible to anyone doing Ctrl+U. Cloudflare Worker migration will fully resolve this later.
**Known issues introduced:** None.
**Suggested commit message:** `claude-1.1: personal info removed from HTML comments`

---

## claude-1.0 · Session 2
**Changed:** Version system changed to per-file independent numbering.
- Full comment header rewritten for future-session reliability
- Handoff note updated
**Why:** Single shared version number across all files was confusing — updating claude was incorrectly bumping root's version.
**Known issues introduced:** None.
**Suggested commit message:** `claude-1.0: independent per-file versioning introduced`

---

## Legacy versions (pre-independent versioning)

### v0.095
AI_NAME variable added. All UI "Claude" strings now pull from AI_NAME.
AI selector removed, replaced with "Not using Claude?" link.

### v0.094
Moved to notavello.com/claude/. SEO optimization.
Root landing page created at notavello.com/.

### v0.093
Watermark tuned: bands removed, opacity 7%→18%.
Mike confirmed "perfect" — do not change without asking.

### v0.092
Watermark bands added (too aggressive — reverted next version).

### v0.091
UX: renamed button, added floating download bar,
bottom download button, yellow hint bar.

### v0.090
Claude-only release. Stripped other parsers.
Added AI selector UI with routing stubs.

### v0.080
Rolled back to clean page div / empty height approach.
This baseline exists because the multi-parser attempt failed completely.

### v0.4
BUG 1 FIXED: User replies caught inside AI block.
Parser fix: AI block split on blank lines.

### v0.3
Multi-platform parser attempted (Claude, ChatGPT, Gemini).
Failed completely — format detection unreliable. Abandoned.

### v0.2
UI redesign: modern, rounded, gradient style.

### v0.1
Initial build.

---

## root-1.1 · Session 5
**Changed:** AI order updated to reflect market share. Footer added.
**Suggested commit message:** `root-1.1: AI order corrected, footer added`

## root-1.0 · Session 4
**Changed:** Root landing page created at notavello.com/.
Previously the site had no landing page — claude/ was effectively the homepage.
**Suggested commit message:** `root-1.0: root landing page created`
