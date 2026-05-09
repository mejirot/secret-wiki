# Private Note Operations

This repository tracks the private note workspace and keeps the public product repository as `upstream`.

## Sync Product Updates

```powershell
git fetch upstream
git merge upstream/main
```

Keep private-only changes limited to vault content and deployment configuration whenever possible.

## Publish

```powershell
npm run build:public
npm run deploy:public
```

The static export contains the notes in the current `vault/` tree. Review `exports/public` before deployment.
