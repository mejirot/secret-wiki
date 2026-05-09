import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface RawTagConfig {
  tags?: unknown;
  aliases?: unknown;
}

export interface TagConfig {
  readonly tags: readonly string[];
  readonly tagSet: ReadonlySet<string>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly configPath: string;
}

export interface ConfigProblem {
  readonly message: string;
}

export interface ConfigResult {
  readonly config?: TagConfig;
  readonly problems: readonly ConfigProblem[];
}

export const defaultConfigFile = "wiki-tags.json";

export async function loadTagConfig(workspaceRoot: string, configFile = defaultConfigFile): Promise<ConfigResult> {
  const configPath = path.resolve(workspaceRoot, configFile);
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return parseTagConfig(raw, configPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      problems: [{ message: `Unable to read ${configFile}: ${message}` }]
    };
  }
}

export function parseTagConfig(raw: string, configPath = defaultConfigFile): ConfigResult {
  let parsed: RawTagConfig;
  try {
    parsed = JSON.parse(raw) as RawTagConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { problems: [{ message: `Invalid tag config JSON: ${message}` }] };
  }

  const problems: ConfigProblem[] = [];
  const tags: string[] = [];
  const seenTags = new Set<string>();

  if (!Array.isArray(parsed.tags)) {
    problems.push({ message: "Tag config must contain a tags array." });
  } else {
    for (const value of parsed.tags) {
      if (typeof value !== "string" || value.trim() === "") {
        problems.push({ message: "Every tag must be a non-empty string." });
        continue;
      }

      const tag = value.trim();
      if (seenTags.has(tag)) {
        problems.push({ message: `Duplicate canonical tag: ${tag}` });
        continue;
      }

      seenTags.add(tag);
      tags.push(tag);
    }
  }

  const aliases = new Map<string, string>();
  if (parsed.aliases !== undefined) {
    if (!isStringRecord(parsed.aliases)) {
      problems.push({ message: "aliases must be an object whose keys and values are strings." });
    } else {
      for (const [alias, canonical] of Object.entries(parsed.aliases)) {
        const cleanAlias = alias.trim();
        const cleanCanonical = canonical.trim();
        if (!cleanAlias || !cleanCanonical) {
          problems.push({ message: "aliases must not contain empty keys or values." });
          continue;
        }
        if (!seenTags.has(cleanCanonical)) {
          problems.push({ message: `Alias ${cleanAlias} points to unknown canonical tag: ${cleanCanonical}` });
          continue;
        }
        if (cleanAlias === cleanCanonical) {
          problems.push({ message: `Alias ${cleanAlias} points to itself.` });
          continue;
        }
        aliases.set(cleanAlias, cleanCanonical);
      }
    }
  }

  if (problems.length > 0) {
    return { problems };
  }

  return {
    config: {
      tags,
      tagSet: new Set(tags),
      aliases,
      configPath
    },
    problems: []
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}
