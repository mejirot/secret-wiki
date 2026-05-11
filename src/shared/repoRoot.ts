import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findRepoRoot(fromUrl = import.meta.url) {
  let current = path.dirname(fileURLToPath(fromUrl));

  while (true) {
    if (existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find repository root from ${fromUrl}`);
    }
    current = parent;
  }
}

export const repoRoot = findRepoRoot();
