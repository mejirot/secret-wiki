import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../shared/repoRoot.js";
import type { NoteDetail } from "../shared/types.js";
import {
  defaultPublicOrigin,
  standardSiteDocumentAtUri,
  standardSiteStaticConfig
} from "../shared/standardSite.js";
import { createWikiStore } from "../wiki/store.js";
import { noteDataFileName, withNoteHead } from "./publicHtml.js";

const publicOrigin = (process.env.SECRET_WIKI_PUBLIC_ORIGIN ?? defaultPublicOrigin).replace(/\/+$/, "");
const standardSite = standardSiteStaticConfig();

const store = createWikiStore({ rootDir: repoRoot });
const result = await store.exportPublicSite();
const clientBuildDir = path.join(store.rootDir, "dist", "client");

await fs.cp(clientBuildDir, store.exportDir, {
  recursive: true,
  force: true
});

const baseHtml = await fs.readFile(path.join(store.exportDir, "index.html"), "utf8");
const standardSiteNotes = new Set(result.standardSiteNotes);

async function generateNoteHtml() {
  const notesDir = path.join(store.exportDir, "data", "notes");
  for (const noteId of result.notes) {
    const note = JSON.parse(await fs.readFile(path.join(notesDir, noteDataFileName(noteId)), "utf8")) as NoteDetail;
    const documentAtUri = standardSite.enabled && standardSiteNotes.has(note.id) ? standardSiteDocumentAtUri(standardSite.did, note.id) : undefined;
    const noteHtml = withNoteHead(baseHtml, note, { publicOrigin, standardSiteDocumentAtUri: documentAtUri });
    const outputDir = path.resolve(store.exportDir, "note", ...note.id.split("/"));
    if (!outputDir.startsWith(store.exportDir + path.sep)) {
      throw new Error(`Note HTML path escapes export dir: ${note.id}`);
    }
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "index.html"), noteHtml, "utf8");

    const pathParts = note.id.split("/");
    const fileName = `${pathParts.pop()}.html`;
    const htmlFile = path.resolve(store.exportDir, "note", ...pathParts, fileName);
    if (!htmlFile.startsWith(store.exportDir + path.sep)) {
      throw new Error(`Note HTML file escapes export dir: ${note.id}`);
    }
    await fs.mkdir(path.dirname(htmlFile), { recursive: true });
    await fs.writeFile(htmlFile, noteHtml, "utf8");
  }
}

async function generateStandardSiteWellKnown() {
  if (!standardSite.enabled) {
    return;
  }
  const wellKnownDir = path.join(store.exportDir, ".well-known");
  await fs.mkdir(wellKnownDir, { recursive: true });
  await fs.writeFile(path.join(wellKnownDir, "site.standard.publication"), `${standardSite.publicationAtUri}\n`, "utf8");
}

await generateNoteHtml();
await generateStandardSiteWellKnown();

console.log(JSON.stringify(result, null, 2));
