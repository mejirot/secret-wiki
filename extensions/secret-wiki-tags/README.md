# Secret Wiki Tags

Secret Wiki の `vault/**/*.md` にある YAML frontmatter `tags:` を補助する VS Code Extension です。

## Features

- `wiki-tags.json` の `tags` を正規タグとして補完します。
- 未登録タグ、alias タグ、同一ノート内の重複タグを Problems に warning として表示します。
- `LLM -> llm` のような alias は Quick Fix で正規タグに置換できます。
- 未登録タグは Quick Fix で `wiki-tags.json` に追加できます。

## Development

```powershell
npm --prefix extensions/secret-wiki-tags install
npm run extension:build
npm run extension:test
```

Extension Development Host で試す場合は、VS Code で `extensions/secret-wiki-tags` を開き、`Run Extension` を実行します。

設定を再読み込みするには Command Palette から `Secret Wiki Tags: Reload Tag Config` を実行します。

When editing a note, completions appear inside frontmatter `tags:` values. If the suggestion list is not shown automatically, press `Ctrl+Space` at the tag position.
