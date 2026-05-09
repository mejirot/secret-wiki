import fs from "node:fs/promises";
import path from "node:path";
import type { NoteDetail, NoteMedia } from "../shared/types.js";
import { createWikiStore } from "../wiki/store.js";

const defaultPublicOrigin = "https://wiki.mejilab.com";
const publicOrigin = (process.env.SECRET_WIKI_PUBLIC_ORIGIN ?? defaultPublicOrigin).replace(/\/+$/, "");

const store = createWikiStore();
const result = await store.exportPublicSite();
const clientBuildDir = path.join(store.rootDir, "dist", "client");

await fs.cp(clientBuildDir, store.exportDir, {
  recursive: true,
  force: true
});

const baseHtml = await fs.readFile(path.join(store.exportDir, "index.html"), "utf8");

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeUrlPath(pathValue: string) {
  return `/${pathValue.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
}

function notePagePath(noteId: string) {
  return `/note/${noteId.split("/").map(encodeURIComponent).join("/")}`;
}

function mediaPublicPath(note: Pick<NoteDetail, "path">, media: NoteMedia) {
  const notePath = note.path.replace(/\\/g, "/");
  const base = notePath.endsWith("/index.md")
    ? notePath.slice(0, -"/index.md".length)
    : notePath.includes("/")
      ? notePath.split("/").slice(0, -1).join("/")
      : "";
  return [base, media.path].filter(Boolean).join("/");
}

function socialImageUrl(note: NoteDetail) {
  const cover = note.cover ? note.media.find((media) => media.exists && (media.source === note.cover || media.path === note.cover)) : undefined;
  const media = cover ?? note.media.find((item) => item.exists);
  return media ? `${publicOrigin}${encodeUrlPath(mediaPublicPath(note, media))}` : undefined;
}

function noteDataFileName(noteId: string) {
  return `${encodeURIComponent(noteId).replace(/%/g, "~")}.json`;
}

function socialMetaTags(note: NoteDetail) {
  const pageUrl = `${publicOrigin}${notePagePath(note.id)}`;
  const imageUrl = socialImageUrl(note);
  const description = note.excerpt || note.title;
  const tags = [
    `<title>${htmlEscape(note.title)} | Secret Wiki</title>`,
    `<meta name="description" content="${htmlEscape(description)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Secret Wiki" />`,
    `<meta property="og:title" content="${htmlEscape(note.title)}" />`,
    `<meta property="og:description" content="${htmlEscape(description)}" />`,
    `<meta property="og:url" content="${htmlEscape(pageUrl)}" />`,
    `<meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${htmlEscape(note.title)}" />`,
    `<meta name="twitter:description" content="${htmlEscape(description)}" />`
  ];
  if (imageUrl) {
    tags.push(`<meta property="og:image" content="${htmlEscape(imageUrl)}" />`);
    tags.push(`<meta name="twitter:image" content="${htmlEscape(imageUrl)}" />`);
  }
  return tags.join("\n    ");
}

function withNoteHead(html: string, note: NoteDetail) {
  const cleanHead = html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, "")
    .replace(/\s*<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/\s*<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/\s*<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");
  return cleanHead.replace("</head>", `    ${socialMetaTags(note)}\n  </head>`);
}

async function generateNoteHtml() {
  const notesDir = path.join(store.exportDir, "data", "notes");
  for (const noteId of result.notes) {
    const note = JSON.parse(await fs.readFile(path.join(notesDir, noteDataFileName(noteId)), "utf8")) as NoteDetail;
    const noteHtml = withNoteHead(baseHtml, note);
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

await generateNoteHtml();

console.log(JSON.stringify(result, null, 2));
