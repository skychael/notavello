# SOP: Notavello Blog Generator

## Purpose

This SOP explains how to use the Notavello private blog generator form, how the GitHub/Cloudflare setup works, what not to touch, and how to troubleshoot common problems.

The goal is simple:

Open private web form → enter optional topic/source → run GitHub Action → generate blog post → GitHub commits files → Cloudflare redeploys site

---

## 1. Important Links

### Blog generator form

<your-private-blog-generator-url>

### GitHub repo

<your-github-repo>

### GitHub Actions page

GitHub → <your-github-repo> → Actions

### Cloudflare Pages project

Cloudflare → Workers & Pages → <your-pages-project>

Make sure the Cloudflare Pages project is connected to the correct GitHub repo.

---

## 2. What Each System Does

### Cloudflare

Cloudflare hosts the private web form and receives your request.

It stores these secrets:

- BLOG_GENERATOR_ADMIN_TOKEN
- GITHUB_WORKFLOW_TOKEN

### GitHub Actions

GitHub Actions actually runs the blog generator.

It runs:

blog-automation/generate-daily-post.js

Then it updates the blog files and commits them back to the repo when not in dry run mode.

### OpenAI key

The OpenAI API key should stay in GitHub Actions secrets, not Cloudflare.

Do not put the OpenAI key into the web form or frontend code.

---

## 3. Secrets Explained

### BLOG_GENERATOR_ADMIN_TOKEN

This is the password you type into the blog generator form.

It can be a simple private password you choose.

This protects the form from random users.

### GITHUB_WORKFLOW_TOKEN

This is the big GitHub token.

Do not type this into the form.

It belongs only in Cloudflare as a secret.

The GitHub token must have:

- Repository: <your-github-repo>
- Actions: Read and write
- Metadata: Read-only

If Actions is only Read-only, the form will fail with HTTP 403.

---

## 4. Normal Blog Generation

### Safe dry run test

Use this first whenever testing.

1. Open: <your-private-blog-generator-url>
2. Enter your admin password in Admin password/token.
3. Optional: enter a topic.
4. Optional: enter source/context.
5. Keep mode as Dry run first.
6. Click Generate Blog.
7. Go to GitHub → <your-github-repo> → Actions.
8. Check the newest Generate Daily Blog Post run.

Green checkmark means the dry run worked.

Dry run does not publish a blog post.

---

## 5. Publishing a Real Blog Post

Only do this after a successful dry run.

1. Open the blog generator form.
2. Enter your admin password.
3. Fill topic/source only if needed.
4. Change mode from Dry run first to the publish/generate option.
5. Click Generate Blog.
6. Check GitHub Actions.
7. Wait for the run to complete.
8. Cloudflare should redeploy automatically.
9. Check the live blog page.

---

## 6. Topic and Source Rules

### Leaving everything blank

Topic: blank
One-time source/context: blank

Result:

The generator uses its normal default behavior, including Hacker News topic seeding.

### Topic only

Topic: filled in
One-time source/context: blank

Result:

The generator writes about your topic, but keeps the normal default source behavior.

### Source/context filled in

One-time source/context: filled in

Result:

Hacker News seeding is skipped for that run.

The pasted source/context is used only for that one blog post.

It does not permanently change the generator.

---

## 7. Source/Context Format

There is no exact required format.

You can paste:

- notes
- links
- bullet points
- article snippets
- rough instructions
- background context

Example:

Topic: AI tools for small businesses

Source/context:
Focus on practical tools for scheduling, customer service, and writing.
Avoid hype.
Mention that owners should still review AI output before sending it to customers.

---

## 8. Blog Order Rule

The expected blog order is:

Newest post first
Older posts below

The current visible baseline before the test post was:

1. AI Agents Need Smaller Jobs, Not Bigger Promises
2. AI Travel Planning Still Needs Offline Maps
3. Mechanical Turk's Slow Fade Is A Data Quality Warning
4. AI Coding Agents Need Workspace Quarantine
5. Local LLMs Are Finally Boring Enough To Use

A bug was found where same-day posts could sort alphabetically instead of newest first.

The fix is in:

- blog-automation/generate-daily-post.js
- blog-automation/split-blog-index.js

Going forward, new posts should use a reliable publish timestamp instead of Windows/Git modified dates.

Do not use Windows Explorer Date modified to judge blog order. Git push/pull can make old files appear newly modified.

---

## 9. Applying the Blog Order Fix

Use:

notavello-blog-order-fix-files.zip

Only overwrite these files:

<your-local-repo>\blog-automation\generate-daily-post.js
<your-local-repo>\blog-automation\split-blog-index.js

Do not overwrite the whole repo folder with a full ZIP.

Reason:

Your live repo already has the newly generated blog post. A full old ZIP might not include that post.

After replacing those two files:

git add blog-automation/generate-daily-post.js blog-automation/split-blog-index.js
git commit -m "Fix blog post ordering for same-day posts"
git push

Cloudflare should redeploy automatically.

---

## 10. Troubleshooting

### Form says unauthorized

Problem:

Admin password/token is wrong.

Fix:

Go to Cloudflare:

notavello-site → Settings → Variables and secrets

Check:

BLOG_GENERATOR_ADMIN_TOKEN

Rotate it to a password you know.

Redeploy the Cloudflare project.

Use that password in the form.

### Form says HTTP 403

Problem:

GitHub token permission issue.

Fix the GitHub token.

It must have:

- Repository access: <your-github-repo>
- Actions: Read and write
- Metadata: Read-only

Then update/rotate this Cloudflare secret:

GITHUB_WORKFLOW_TOKEN

Redeploy Cloudflare.

### Form says dry run started but nothing happens

The form does not live-monitor GitHub.

Go to:

GitHub → <your-github-repo> → Actions

Check the newest workflow run.

### GitHub Action is green but no blog post appears

Check whether the form was in Dry run first.

Dry run does not publish.

To publish, run again using the publish/generate mode.

### New post appears lower than expected

This was the same-day sorting bug.

Fix files:

- generate-daily-post.js
- split-blog-index.js

After the patch, future posts should sort by timestamp.

The already-published post does not need to be manually moved unless you care about its exact placement.

---

## 11. Do Not Touch Unless Needed

Avoid changing these unless you are intentionally updating the system:

- OpenAI API key
- GITHUB_WORKFLOW_TOKEN
- GitHub Actions workflow permissions
- Cloudflare project connection
- split-blog-index.js
- generate-daily-post.js

Do not connect the live site back to:

<old-or-wrong-repo-if-applicable>

The correct repo for this setup is:

<your-github-repo>

---

## 12. Safe Operating Rule

Use this habit:

Dry run first.
Check GitHub Actions.
Then publish.

That prevents accidental bad posts, broken source/context runs, or surprise commits.
