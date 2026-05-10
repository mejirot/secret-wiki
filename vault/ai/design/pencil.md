---
title: pencil
tags:
  - design
  - MCP
llm_access: true
---

普通にデスクトップアプリから使おうとすると、API Keyが必要になる。  
MCP経由でやれば、そのLLMを使うのでお金のことはあまり気にせず使える。

# VS Codeから連携して使う方法

- VS CodeのExtensionからPencilを入れる。
- Claude CodeのMCP設定をする
  - Copy MCP configから内容をコピーできる。
    - ```.claude\mcp.json``` に他のと合わせた形式で張り付ける。

これのいいところはVS Codeから使えるところであり、よくないところはVS Codeを立ち上げなきゃいけないところ。  

# デスクトップアプリから使う方法⇒失敗

- 同じようにSettingsのMCPからコピーする。
- Codex appにコピペして、このMCP設定して、と言う。

が、なんかこれやっても、VS Codeの方が開くのでよくわからん。

# どちらにしても

UIセンスはLLM依存な感じがするので、pencilならではの素晴らしいものができるっていうことはなさそう。  
まだほとんどの機能を使ってないので、可能性はあるってことと、高い金出してClaude Design使うよりマシ、くらいしか言えないかな。

# 一回使ってみた感じ

なかなかいい。  
これをベースにWebに限らずいろんなUIに落とし込める。  
落とし込む際に削られちゃう要素はあるんだが。

https://docs.pencil.dev/design-and-code/design-to-code