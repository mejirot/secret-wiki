import fs from "node:fs/promises";
import path from "node:path";
import { createWikiStore } from "../wiki/store.js";

const store = createWikiStore();
const result = await store.exportPublicSite();
const clientBuildDir = path.join(store.rootDir, "dist", "client");

await fs.cp(clientBuildDir, store.exportDir, {
  recursive: true,
  force: true
});

console.log(JSON.stringify(result, null, 2));
