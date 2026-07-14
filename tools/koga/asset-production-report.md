# Koga promotional asset production report

## Production approach

All app UI pixels come directly from the four approved screenshots in `assets-raw/fresh`. The compositions use deterministic cropping, resizing, device framing, shadows, and a generated neutral abstract background. No controls, webpage content, or app features were moved, redrawn, replaced, or invented.

Android status bars were cropped from the marketing compositions. Source images remain unchanged.

## Source images

| Source | Original dimensions | Used for |
|---|---:|---|
| `assets-raw/fresh/koga-final-portrait-browsing.png` | 720 × 1604 | Hero, browsing feature, overview collage |
| `assets-raw/fresh/koga-final-tabs-002.png` | 720 × 1604 | Tabs feature, overview collage |
| `assets-raw/fresh/koga-final-bookmarks.png` | 720 × 1604 | Bookmarks feature, overview collage |
| `assets-raw/fresh/koga-final-landscape-002.png` | 1604 × 720 | Landscape feature, overview collage |

## Output images

| Output | Dimensions | Processing | File size |
|---|---:|---|---:|
| `assets/screenshots/koga-hero.webp` | 1600 × 1100 | Status-bar crop, large centered portrait device frame, soft shadow, minimal neutral background, WebP optimization | 34,992 bytes |
| `assets/screenshots/koga-browsing.webp` | 1200 × 900 | Status-bar crop, centered portrait device frame, soft shadow, neutral background, WebP optimization | 27,048 bytes |
| `assets/screenshots/koga-tabs.webp` | 1200 × 900 | Status-bar crop, centered portrait device frame, soft shadow, neutral background, WebP optimization | 24,872 bytes |
| `assets/screenshots/koga-bookmarks.webp` | 1200 × 900 | Status-bar crop, centered portrait device frame, soft shadow, neutral background, WebP optimization | 36,114 bytes |
| `assets/screenshots/koga-landscape.webp` | 1400 × 850 | Status-bar crop, centered landscape device frame, soft shadow, neutral background, WebP optimization | 40,548 bytes |
| `assets/screenshots/koga-overview.webp` | 1600 × 1000 | Three real portrait screens and one real landscape screen arranged as a device collage, soft shadows, neutral background, WebP optimization | 97,652 bytes |

## Website integration

- Replaced the synthetic hero placeholder with `koga-hero.webp`.
- Replaced all screenshot placeholders with browsing, tabs, and bookmarks promotional images.
- Added landscape and overview presentations using live HTML captions.
- Added descriptive alt text and intrinsic image dimensions.
- Retained responsive single-column behavior on narrow screens.
- Added horizontal-overflow protection and narrow-screen heading sizing.

## Local preview verification

- Local page returned HTTP 200 at `http://127.0.0.1:4173/`.
- Desktop preview checked at 1440 × 1200.
- Mobile preview checked in normal installed Chrome with responsive emulation at 390 × 844.
- All six WebP paths resolved locally.
- No broken image paths were found.
- The Koga page measured `390px` viewport width and `390px` document width with no horizontal scrolling or out-of-viewport images.
- The parent Tools page measured `390px` viewport width and `390px` document width; the Koga card was found fully inside the viewport.
- Preview captures are stored in `assets-raw/preview-desktop.png` and `assets-raw/preview-mobile.png` for local review only.

## Image-generation workflow

The built-in image-generation tool produced only the reusable abstract neutral background. Final image assembly was performed locally so the approved screenshot pixels and UI geometry remained exact.
