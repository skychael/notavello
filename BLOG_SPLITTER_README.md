# Notavello Safe Blog Splitter v4

This version preserves the existing Notavello blog design in `pages/blog/index.html`, scans real post folders, reuses existing blog cards, generates missing cards, and splits the blog list into multiple pages.

Run a dry run first:

```powershell
cd C:\Dev\apps\notavello
node blog-automation\split-blog-index.js --dry-run
```

Only after the dry run looks right, write the files:

```powershell
node blog-automation\split-blog-index.js --write
```

The script writes:

- `pages/blog/index.html`
- `pages/blog/page-2/index.html`
- `pages/blog/page-3/index.html`

It also creates a backup of the old `pages/blog/index.html`. Do not commit backup files unless you intentionally want them in the site.

Version 4 fixes the write error where the existing index page did not have the expected `</div></main>` ending after the post list.
