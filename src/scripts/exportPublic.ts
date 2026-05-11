import { repoRoot } from "../shared/repoRoot.js";
import { createWikiStore } from "../wiki/store.js";

const store = createWikiStore({ rootDir: repoRoot });
const result = await store.exportPublicSite();

console.log(JSON.stringify(result, null, 2));
