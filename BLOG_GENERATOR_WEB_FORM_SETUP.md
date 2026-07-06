# Notavello blog generator web form setup

This repo now includes a private admin page at:

```text
/admin/blog-generator.html
```

The page calls the Cloudflare Worker endpoint:

```text
POST /api/generate-blog
```

## Required Cloudflare secrets / environment variables

Set these in Cloudflare Pages / Workers before using the form:

```text
BLOG_GENERATOR_ADMIN_TOKEN=<a private password or random token>
GITHUB_WORKFLOW_TOKEN=<GitHub token that can trigger workflow_dispatch>
```

Optional overrides are supported, but not required because the defaults match this repo:

```text
GITHUB_REPO_OWNER=skychael
GITHUB_REPO_NAME=notavello
GITHUB_WORKFLOW_FILE=generate-daily-post.yml
GITHUB_BRANCH=main
```

The GitHub token must have permission to dispatch workflows for the repo. The OpenAI API key stays in GitHub Actions secrets as `OPENAI_API_KEY`; it is never sent to the browser or Cloudflare.

## Rollout checklist

1. Deploy these changes.
2. Confirm the GitHub Action manual run shows inputs for topic, source/context, and dry run.
3. Run a manual GitHub dry run with a topic.
4. Run a manual GitHub dry run with one-time source/context.
5. Set the Cloudflare secrets above.
6. Open `/admin/blog-generator.html` and trigger a dry run from the form.
7. Only after dry runs look right, use publish mode.
