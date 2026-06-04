# Notavello PWA Session Handoff
## Session Date: June 3, 2026

---

## What Was Built This Session

A full Progressive Web App (PWA) implementation for Notavello. Three new files in `/app/`, two icon PNGs in the repo root, and an updated `/tools/index.html`.

---

## Files Deployed / To Deploy

### New files — `/app/` folder (create this folder in repo root)
| File | Purpose |
|---|---|
| `app/index.html` | PWA install landing page |
| `app/manifest.json` | PWA manifest — tells browser this is installable |
| `app/sw.js` | Service worker — caches app shell for fast loads |

### New files — repo root
| File | Purpose |
|---|---|
| `icon-192.png` | PWA icon for Android home screen (192x192) |
| `icon-512.png` | PWA icon for splash screen (512x512) |

### Updated files
| File | Change |
|---|---|
| `tools/index.html` | Redesigned to list view + added Notavello App card linking to `/app/` |

---

## How It Works

- **Android/Chrome** — visits `notavello.com/app/`, browser shows native "Add to Home Screen" prompt, one tap installs. Opens directly to `/exporters/chatgpt/` as a standalone app (no browser chrome).
- **iOS/Safari** — no programmatic prompt possible (Apple restriction). Page detects iOS and shows Safari-only instructions. Must be done in Safari, not Brave or Chrome.
- **Already installed** — install button changes to green "✓ Already installed" state automatically.

---

## Key Decisions Made

- `start_url` points to `/exporters/chatgpt/` — ChatGPT is ~57% of AI chatbot market share, most likely user
- Standalone display mode — no browser address bar, looks like a native app
- iOS experience shows ONLY the instructions (all marketing copy hidden via `body.is-ios` CSS class) — avoids confusing the user with content they can't act on
- Icons generated from `notavello-logo.svg` — square format, purple gradient background matching brand

---

## Known Issues / Next Steps

1. **Icon won't update on already-installed PWA** — user must uninstall and reinstall to get the new `icon-192.png`. Not worth forcing, just a known limitation.
2. **Service worker 404 in preview** — harmless, only happens in Claude's artifact preview. Works fine on live Cloudflare deployment.
3. **iOS requires Safari** — Brave/Chrome on iPhone cannot install PWAs. This is an Apple OS restriction, not fixable in code. Instructions on the page make this clear.
4. **Sitemap** — the auto-generator will pick up `/app/index.html` automatically on next deploy. No manual action needed.
5. **`tools/index.html` version string** — currently `tools-1.0`, was not bumped this session. Bump if version-bump.yml doesn't catch it automatically.

---

## PWA Architecture Notes

- Service worker strategy: **network-first for HTML**, **cache-first for assets**
- Cache name: `notavello-app-v1` — increment to `v2` if you need to force a cache bust on all users
- Scope is `/` (entire site) but start URL is `/exporters/chatgpt/`
- To update the SW: change `CACHE_NAME` version string in `app/sw.js` — old cache auto-deletes on activate

---

## Files NOT Changed This Session
All exporter pages, blog posts, `_header.html`, `_footer.html`, `_worker.js`, auth flow, Stripe, D1, Resend — untouched.
