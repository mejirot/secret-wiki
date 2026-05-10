# Secret Wiki

Secret Wiki is a local-first Markdown wiki with a React web UI, controlled LLM access through MCP, a VS Code tag helper extension, and a read-only static site export.

## Commands

- `npm install`: install dependencies
- `npm run dev`: start the API on `127.0.0.1:3001` and the web UI on `127.0.0.1:5173`
- `npm run build`: type-check and build the local web UI
- `npm run build:public`: build the read-only static site into `exports/public`
- `npm run deploy:public`: build and deploy `exports/public` with Wrangler static assets
- `npm test`: run the wiki store tests
- `npm run extension:build`: compile the Secret Wiki Tags VS Code extension
- `npm run extension:test`: run the Secret Wiki Tags extension tests
- `npm run mcp`: start the MCP server over stdio
- `npm run index:generate`: generate configured folder indexes
- `npm run export:public`: export notes and media into `exports/public/data`

## Vault Format

Markdown files in `vault/` are the source of truth.

```yaml
---
title: Example
tags: [wiki]
llm_access: false
---
```

Unset `llm_access` values are treated as `false`. This flag controls MCP visibility only.

## MCP Access Model

The MCP server can search and read only notes with `llm_access: true`.
It can update only existing notes that already have `llm_access: true`, and MCP updates cannot change `llm_access`.
It can create new notes, including with `llm_access: true` when explicitly requested.

## Static Export

`npm run build:public` builds the client and exports the current `vault/` contents into `exports/public`.

Review `exports/public` before deploying it. The static export is read-only and contains the notes available in the workspace where the command is run.

## VS Code Tag Assistance

The local extension in `extensions/secret-wiki-tags` uses `wiki-tags.json` as the canonical tag list for `vault/**/*.md` frontmatter. It provides tag completion, warnings for unknown or duplicated tags, and quick fixes for aliases.

```powershell
npm --prefix extensions/secret-wiki-tags install
npm run extension:build
npm run extension:test
```
