---
title: PlantUML Sample
tags: [sample, guide, plantuml]
llm_access: true
---

# PlantUML Sample

Secret Wiki renders fenced `plantuml` code blocks as diagrams. Use this page to confirm sequence, activity, and class diagrams in the reader.

## Sequence

```plantuml
@startuml
actor User
participant "Secret Wiki" as Wiki
participant "PlantUML Server" as PlantUML

User -> Wiki: Open note
Wiki -> Wiki: Detect plantuml code block
Wiki -> PlantUML: Request SVG diagram
PlantUML --> Wiki: SVG response
Wiki --> User: Render diagram
@enduml
```

## Activity

```plantuml
@startuml
start
:Write Markdown note;
if (Uses plantuml fence?) then (yes)
  :Encode diagram source;
  :Load SVG from PlantUML server;
  :Show rendered diagram;
else (no)
  :Show normal code block;
endif
stop
@enduml
```

## Class

```plantuml
@startuml
class Note {
  +id: string
  +title: string
  +body: string
}

class MarkdownRenderer {
  +render(note: Note)
}

class PlantUmlDiagram {
  +source: string
  +imageUrl: string
}

MarkdownRenderer --> Note
MarkdownRenderer --> PlantUmlDiagram
@enduml
```
