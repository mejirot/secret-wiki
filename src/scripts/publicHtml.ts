import type { NoteDetail, NoteMedia } from "../shared/types.js";
import { notePagePath, standardSiteDocumentLinkTag } from "../shared/standardSite.js";

export type NoteHeadOptions = {
  publicOrigin: string;
  standardSiteDocumentAtUri?: string;
};

export function htmlEscape(value: string) {
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

function mediaPublicPath(note: Pick<NoteDetail, "path">, media: NoteMedia) {
  const notePath = note.path.replace(/\\/g, "/");
  const base = notePath.endsWith("/index.md")
    ? notePath.slice(0, -"/index.md".length)
    : notePath.includes("/")
      ? notePath.split("/").slice(0, -1).join("/")
      : "";
  return [base, media.path].filter(Boolean).join("/");
}

function socialImageUrl(note: NoteDetail, publicOrigin: string) {
  const cover = note.cover ? note.media.find((media) => media.exists && (media.source === note.cover || media.path === note.cover)) : undefined;
  const media = cover ?? note.media.find((item) => item.exists);
  return media ? `${publicOrigin}${encodeUrlPath(mediaPublicPath(note, media))}` : undefined;
}

export function noteDataFileName(noteId: string) {
  return `${encodeURIComponent(noteId).replace(/%/g, "~")}.json`;
}

function socialMetaTags(note: NoteDetail, publicOrigin: string) {
  const pageUrl = `${publicOrigin}${notePagePath(note.id)}`;
  const imageUrl = socialImageUrl(note, publicOrigin);
  const description = note.excerpt || note.title;
  const tags = [
    `<title>${htmlEscape(note.title)} | Wiki</title>`,
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

export function withNoteHead(html: string, note: NoteDetail, options: NoteHeadOptions) {
  const cleanHead = html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, "")
    .replace(/\s*<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/\s*<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/\s*<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "")
    .replace(/\s*<link\s+rel=["']site\.standard\.document["'][^>]*>/gi, "");
  const tags = [socialMetaTags(note, options.publicOrigin)];
  if (options.standardSiteDocumentAtUri) {
    tags.push(standardSiteDocumentLinkTag(options.standardSiteDocumentAtUri));
  }
  return cleanHead.replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
}
