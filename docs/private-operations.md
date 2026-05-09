# Private Note Operations

This repository tracks the private note workspace and keeps the public product repository as `upstream`.

## Sync Product Updates

```powershell
git fetch upstream
git merge upstream/main
```

Keep private-only changes limited to vault content and deployment configuration whenever possible.

## Publish

This workspace publishes the static export to Cloudflare Pages. Create the Pages project once:

```powershell
npx wrangler pages project create secret-wiki-note --production-branch main
```

Configure `wiki.mejilab.com` as the Pages custom domain in Cloudflare after the project exists.

```powershell
npm run deploy:public
```

The static export contains the notes in the current `vault/` tree. Review `exports/public` before deployment.
