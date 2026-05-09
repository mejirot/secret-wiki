import { createWikiStore } from "../wiki/store.js";

const store = createWikiStore();
const folders = process.argv.slice(2);
const result = await store.generateFolderIndexes(folders.length > 0 ? folders : undefined);

console.log(JSON.stringify(result, null, 2));
