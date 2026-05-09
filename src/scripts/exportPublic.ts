import { createWikiStore } from "../wiki/store.js";

const store = createWikiStore();
const result = await store.exportPublicSite();

console.log(JSON.stringify(result, null, 2));
