---
title: secret-wiki
tags:
  - software
llm_access: true
---

LLM-wikiというワードが話題になりつつあるが、もう全部混みでwikiにぶちこんで、LLMも人間も参照/書き込みできるようにしてしまえばいいじゃないか。という発想の元作成した。

::link-card[secret-wiki GitHub](https://github.com/mejirot/secret-wiki)

# 特徴

## LLM-wikiとしての機能

LLM-wikiとしての機能はローカルで使うこと前提。

LLMとのつながりはMCP.  
参照や書き込みができる。（あんまり、書き込みはテストしてないが）

基本的には人間が書く従来のwiki寄りの思想ではある。  
情報にノイズ増えるのはちょっと微妙では、という考え。

### アクセス権

といっても、なんでもかんでもLLMに見せるのは恥ずかしいので、アクセス権を導入した。  
llm_access: trueとすると、LLMがアクセスできるようになる。  
が、この辺はあんまりテストしてないので、ちゃんと動くか（設定しないときに見ないか）は怪しい。

```plantuml
@startuml
title Secret Wiki - 全体構成図

skinparam componentStyle rectangle
skinparam shadowing false
skinparam wrapWidth 180
skinparam maxMessageSize 120

actor "利用者" as User
actor "LLM / AI Agent" as LLM

package "ローカル環境" {
  component "React Web UI\nSecret Wiki 画面" as WebUI
  component "Express API\n/api/wiki, /api/note,\n/api/search, /api/media" as API
  component "Wiki Store\nMarkdown 読み書き\n索引・リンク・メディア解析" as Store
  database "vault/\nMarkdown notes\nfrontmatter + body\n唯一の情報源" as Vault
  component "MCP Server\nsearch_notes / get_note\ncreate_note / update_note" as MCP
}


User --> WebUI : ローカルで閲覧・検索
WebUI --> API : API 呼び出し
API --> Store : ノート取得・検索・作成・更新
Store <--> Vault : Markdown files

LLM --> MCP : MCP tools
MCP --> Store : 許可されたノートのみ操作
Store --> Vault : llm_access を確認


note right of MCP
MCP から見えるのは
frontmatter で
llm_access: true
が明示されたノートのみ。

update_note も既存の
llm_access: true ノートに限定され、
llm_access 自体は変更できない。
end note

note bottom of Vault
Markdown ノートが source of truth。
Web UI、MCP、公開生成、VS Code 拡張は
すべて vault/ を中心に連携する。
end note

@enduml
```


## 普通のwikiとしての機能

今見ているように、普通のwikiとしても使える。  
が、全部コミットしてpushするのはオープンすぎるので、.gitignoreでコミットする物を制御してね。

