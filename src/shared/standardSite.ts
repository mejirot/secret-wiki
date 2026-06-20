import { createHash } from "node:crypto";
import type { NoteDetail } from "./types.js";

export const defaultPublicOrigin = "https://example.com";
export const standardSitePublicationCollection = "site.standard.publication";
export const standardSiteDocumentCollection = "site.standard.document";
export const standardSitePublicationRkey = "self";
export const standardSiteInternalFrontmatterKeys = ["standard_site", "standard_site_published_at"] as const;

export type StandardSiteStaticConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      did: string;
      publicOrigin: string;
      publicationAtUri: string;
    };

export type StandardSiteSyncConfig = {
  did: string;
  publicOrigin: string;
  pdsUrl: string;
  identifier?: string;
  appPassword?: string;
  publicationName: string;
  showInDiscover: boolean;
  publicationAtUri: string;
};

export type StandardSiteRecord = Record<string, unknown> & {
  $type: string;
};

export type StandardSitePublicationRecord = StandardSiteRecord & {
  $type: typeof standardSitePublicationCollection;
  url: string;
  name: string;
  preferences: {
    showInDiscover: boolean;
  };
};

export type StandardSiteDocumentRecord = StandardSiteRecord & {
  $type: typeof standardSiteDocumentCollection;
  site: string;
  path: string;
  title: string;
  publishedAt: string;
  description?: string;
  tags?: string[];
};

export function normalizePublicOrigin(value = defaultPublicOrigin) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Public origin cannot be empty");
  }
  return trimmed;
}

export function standardSiteEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.SECRET_WIKI_STANDARD_SITE_ENABLED?.trim().toLowerCase() === "true";
}

function envFlag(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }
  return value.trim().toLowerCase() === "true";
}

export function standardSiteStaticConfig(env: NodeJS.ProcessEnv = process.env): StandardSiteStaticConfig {
  if (!standardSiteEnabled(env)) {
    return { enabled: false };
  }
  const did = env.SECRET_WIKI_STANDARD_SITE_DID?.trim();
  if (!did) {
    throw new Error("SECRET_WIKI_STANDARD_SITE_DID is required when SECRET_WIKI_STANDARD_SITE_ENABLED=true");
  }
  return {
    enabled: true,
    did,
    publicOrigin: normalizePublicOrigin(env.SECRET_WIKI_PUBLIC_ORIGIN ?? defaultPublicOrigin),
    publicationAtUri: standardSitePublicationAtUri(did)
  };
}

export function standardSiteSyncConfig(env: NodeJS.ProcessEnv = process.env, options: { requireAuth?: boolean } = {}): StandardSiteSyncConfig {
  if (!standardSiteEnabled(env)) {
    throw new Error("SECRET_WIKI_STANDARD_SITE_ENABLED=true is required for standard.site sync");
  }
  const did = env.SECRET_WIKI_STANDARD_SITE_DID?.trim();
  if (!did) {
    throw new Error("SECRET_WIKI_STANDARD_SITE_DID is required when SECRET_WIKI_STANDARD_SITE_ENABLED=true");
  }
  const identifier = env.ATP_IDENTIFIER?.trim();
  const appPassword = env.ATP_APP_PASSWORD?.trim();
  if (options.requireAuth !== false && (!identifier || !appPassword)) {
    throw new Error("ATP_IDENTIFIER and ATP_APP_PASSWORD are required for standard.site sync");
  }
  return {
    did,
    publicOrigin: normalizePublicOrigin(env.SECRET_WIKI_PUBLIC_ORIGIN ?? defaultPublicOrigin),
    pdsUrl: normalizePublicOrigin(env.ATP_PDS_URL ?? "https://bsky.social"),
    identifier,
    appPassword,
    publicationName: env.SECRET_WIKI_STANDARD_SITE_PUBLICATION_NAME?.trim() || "Secret Wiki",
    showInDiscover: envFlag(env.SECRET_WIKI_STANDARD_SITE_DISCOVER, false),
    publicationAtUri: standardSitePublicationAtUri(did)
  };
}

export function notePagePath(noteId: string) {
  return `/note/${noteId.split("/").map(encodeURIComponent).join("/")}`;
}

export function isAtprotoRecordKey(value: string) {
  return value.length >= 1 && value.length <= 512 && value !== "." && value !== ".." && /^[A-Za-z0-9._:~-]+$/.test(value);
}

export function standardSiteDocumentRkey(noteId: string) {
  const hash = createHash("sha256").update(noteId).digest("hex").slice(0, 32);
  return `note-${hash}`;
}

export function standardSitePublicationAtUri(did: string) {
  return `at://${did}/${standardSitePublicationCollection}/${standardSitePublicationRkey}`;
}

export function standardSiteDocumentAtUri(did: string, noteId: string) {
  const rkey = standardSiteDocumentRkey(noteId);
  if (!isAtprotoRecordKey(rkey)) {
    throw new Error(`Invalid standard.site document rkey for note: ${noteId}`);
  }
  return `at://${did}/${standardSiteDocumentCollection}/${rkey}`;
}

export function isStandardSiteNote(note: Pick<NoteDetail, "frontmatter">) {
  return note.frontmatter.standard_site === true;
}

export function standardSiteDocumentLinkTag(atUri: string) {
  return `<link rel="site.standard.document" href="${atUri}" />`;
}

export function validIsoDateTime(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || Number.isNaN(new Date(trimmed).getTime())) {
    return undefined;
  }
  return trimmed;
}

export function standardSitePublicationRecord(config: Pick<StandardSiteSyncConfig, "publicOrigin" | "publicationName" | "showInDiscover">): StandardSitePublicationRecord {
  return {
    $type: standardSitePublicationCollection,
    url: config.publicOrigin,
    name: config.publicationName,
    preferences: {
      showInDiscover: config.showInDiscover
    }
  };
}

export function standardSiteDocumentRecord(
  note: Pick<NoteDetail, "id" | "title" | "excerpt" | "tags">,
  options: { site: string; publishedAt: string }
): StandardSiteDocumentRecord {
  const record: StandardSiteDocumentRecord = {
    $type: standardSiteDocumentCollection,
    site: options.site,
    path: notePagePath(note.id),
    title: note.title,
    publishedAt: options.publishedAt
  };
  if (note.excerpt.trim()) {
    record.description = note.excerpt;
  }
  if (note.tags.length > 0) {
    record.tags = note.tags;
  }
  return record;
}
