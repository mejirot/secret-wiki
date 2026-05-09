import type { TagConfig } from "./tagConfig";

export interface TagCompletion {
  readonly label: string;
  readonly detail: string;
}

export function getTagCompletions(config: TagConfig): TagCompletion[] {
  return config.tags.map((tag) => ({
    label: tag,
    detail: "Secret Wiki tag"
  }));
}
