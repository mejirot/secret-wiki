# Secret Wiki

Secret Wiki is a local-first Markdown wiki with a React web UI, controlled LLM access through MCP, a VS Code tag helper extension, and a read-only static site export.

## Commands

- `npm install`: install dependencies
- `npm run dev`: start the API on `127.0.0.1:3001` and the web UI on `127.0.0.1:5173`
- `npm run build`: type-check and build the local web UI
- `npm run check:public-scope`: verify that published notes and media are git-tracked and not ignored
- `npm run build:public`: check public scope, then build the read-only static site into `exports/public`
- `npm run deploy:public`: build and deploy `exports/public` with Wrangler static assets
- `npm run standard-site:dry-run`: print the standard.site records that would be synced
- `npm run standard-site:sync`: upsert standard.site records to the configured AT Protocol PDS
- `npm run standard-site:sync:delete-stale`: sync records and delete stale generated document records
- `npm test`: run the wiki store tests
- `npm run extension:build`: compile the Secret Wiki Tags VS Code extension
- `npm run extension:test`: run the Secret Wiki Tags extension tests
- `npm run mcp`: start the MCP server over stdio
- `npm run export:public`: export notes and media into `exports/public/data`

## Vault Format

Markdown files in `vault/` are the source of truth.

```yaml
---
title: Example
tags: [wiki]
llm_access: false
links:
  - label: GitHub
    url: https://github.com/mejirot/secret-wiki
publish: true
standard_site: true
standard_site_published_at: 2026-05-10T00:00:00+09:00
---
```

Unset `llm_access` values are treated as `false`. This flag controls MCP visibility only.

Use `links` for external links that should appear in the right-side `Links` inspector under `External`. Each item needs a `label` for display and a `url` to open. Only `http://` and `https://` URLs are shown; unsupported schemes such as `mailto:` are ignored.

Set `publish: true` only for notes that should be included in the public static site. A public note must also be tracked by git and not matched by `.gitignore`. Referenced media is copied only when it is also tracked by git and not matched by `.gitignore`.

Set `standard_site: true` only for already-public notes that should be represented as `site.standard.document` records on AT Protocol. `standard_site_published_at` is optional; when omitted, the sync script uses the note's first git commit date, then a fixed fallback. These frontmatter keys are not included in exported public JSON.

## MCP Access Model

The MCP server can search and read only notes with `llm_access: true`.
It can update only existing notes that already have `llm_access: true`, and MCP updates cannot change `llm_access`.
It can create new notes, including with `llm_access: true` when explicitly requested.

## Static Export

`npm run build:public` builds the client and exports only notes that pass the public gate into `exports/public`.

The public gate is:

- the note has frontmatter `publish: true`
- the note file is tracked by git
- the note file is not matched by `.gitignore`

Referenced media must pass the same git-tracked and non-ignored checks. `npm run check:public-scope` fails if tracked files are ignored or if a published note references media that is not safe to publish.

Review `exports/public` before deploying it. The static export is read-only.

## standard.site

Secret Wiki can publish standard.site metadata for selected public notes. The static site export and standard.site sync both require `publish: true`; standard.site records additionally require `standard_site: true`.

Enable standard.site output with environment variables:

```powershell
$env:SECRET_WIKI_STANDARD_SITE_ENABLED = "true"
$env:SECRET_WIKI_STANDARD_SITE_DID = "did:plc:..."
$env:SECRET_WIKI_PUBLIC_ORIGIN = "https://example.com"
```

`npm run build:public` then writes `.well-known/site.standard.publication` and adds `rel="site.standard.document"` links to opted-in public note HTML.

Dry-run record generation before syncing:

```powershell
npm run standard-site:dry-run
```

For real PDS sync, provide the AT Protocol account credentials as environment variables. Use an app password; do not commit it.

```powershell
$env:ATP_IDENTIFIER = "your-handle.example.com"
$env:ATP_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx"
npm run standard-site:sync
```

Optional settings:

- `ATP_PDS_URL`: defaults to `https://bsky.social`
- `SECRET_WIKI_STANDARD_SITE_PUBLICATION_NAME`: defaults to `Secret Wiki`
- `SECRET_WIKI_STANDARD_SITE_DISCOVER`: defaults to `false`

`npm run standard-site:sync:delete-stale` also removes generated `note-...` document records that are no longer present in the current standard.site payload.

## VS Code Tag Assistance

The local extension in `extensions/secret-wiki-tags` uses `wiki-tags.json` as the canonical tag list for `vault/**/*.md` frontmatter. It provides tag completion, warnings for unknown or duplicated tags, and quick fixes for aliases.

```powershell
npm --prefix extensions/secret-wiki-tags install
npm run extension:build
npm run extension:test
```
