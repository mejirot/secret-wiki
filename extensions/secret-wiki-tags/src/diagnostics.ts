import type { TagConfig } from "./tagConfig";
import type { TagOccurrence, TextRange } from "./frontmatter";
import { extractTagOccurrences } from "./frontmatter";

export type TagDiagnosticKind = "unknown" | "alias" | "duplicate";

export interface TagDiagnostic {
  readonly kind: TagDiagnosticKind;
  readonly tag: string;
  readonly canonical?: string;
  readonly message: string;
  readonly range: TextRange;
}

export function analyzeTagDiagnostics(text: string, config: TagConfig): TagDiagnostic[] {
  const occurrences = extractTagOccurrences(text);
  const diagnostics: TagDiagnostic[] = [];
  const seenByCanonical = new Map<string, TagOccurrence>();

  for (const occurrence of occurrences) {
    const aliasTarget = config.aliases.get(occurrence.value);
    const canonical = aliasTarget ?? occurrence.value;

    if (aliasTarget) {
      diagnostics.push({
        kind: "alias",
        tag: occurrence.value,
        canonical: aliasTarget,
        message: `Tag "${occurrence.value}" should be written as "${aliasTarget}".`,
        range: occurrence.range
      });
    } else if (!config.tagSet.has(occurrence.value)) {
      diagnostics.push({
        kind: "unknown",
        tag: occurrence.value,
        message: `Unknown Secret Wiki tag: "${occurrence.value}".`,
        range: occurrence.range
      });
    }

    if (seenByCanonical.has(canonical)) {
      diagnostics.push({
        kind: "duplicate",
        tag: occurrence.value,
        canonical,
        message: `Duplicate tag in this note: "${canonical}".`,
        range: occurrence.range
      });
    } else {
      seenByCanonical.set(canonical, occurrence);
    }
  }

  return diagnostics;
}
