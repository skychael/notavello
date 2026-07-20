# SEO post-deployment checklist

Do not perform these steps until the pull request is approved, merged, and the Cloudflare Pages deployment is healthy.

1. Confirm the deployment commit matches the merged commit and Cloudflare Pages reports success.
2. Run `node scripts/seo-audit.js --live https://notavello.com` and require zero live failures.
3. Manually verify these normalization cases make at most one permanent redirect:
   - `http://notavello.com/` to `https://notavello.com/`
   - `https://www.notavello.com/` to the chosen apex host
   - directory routes without their trailing slash to the trailing-slash canonical
   - standalone page routes with `.html` or a trailing slash to the extensionless canonical
   - `/pages/blog/pages-blog-google-passkey-cleanup/` to `/pages/blog/google-passkey-cleanup/`
4. Confirm `https://notavello.com/robots.txt` is HTTP 200, allows `/pages/blog/`, and declares `https://notavello.com/sitemap.xml`.
5. Confirm the sitemap is HTTP 200 XML, contains 147 URLs (or the new expected count), contains the newest articles, excludes `/login`, and has stable `lastmod` values.
6. In Google Search Console, resubmit `https://notavello.com/sitemap.xml` and verify it is fetched successfully.
7. Use URL Inspection live tests on:
   - the newest article
   - `/pages/blog/`
   - `/pages/blog/all-posts/`
   - `/pages/blog/google-passkey-cleanup/`
   Confirm **URL is available to Google**, the user-declared canonical equals the inspected URL, and rendered HTML contains the article body.
8. Request indexing for a small representative set (newest article, renamed article, one previously “Discovered” article). Do not submit all 51 manually in a burst.
9. Review Cloudflare Security Events and access logs for verified Googlebot/Bingbot requests returning 403, 429, 5xx, managed challenge, or authentication content. Do not weaken crawler controls unless logs confirm a legitimate crawler is affected.
10. Record the deployment date and baseline counts for **Discovered - currently not indexed**, **Crawled - currently not indexed**, sitemap discovered pages, and indexed pages.
11. Recheck after 7, 14, and 28 days. Indexing changes are asynchronous; compare cohorts rather than expecting immediate removal.
12. Editorially review `reports/seo/content-review.md`. Do not automatically rewrite articles. Prioritize genuinely repetitive, off-topic, or low-value pages using Search Console impressions and engagement data.

