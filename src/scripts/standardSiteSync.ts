import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { NoteDetail } from "../shared/types.js";
import {
  defaultPublicOrigin,
  isStandardSiteNote,
  standardSiteDocumentCollection,
  standardSiteDocumentRecord,
  standardSiteDocumentRkey,
  standardSitePublicationCollection,
  standardSitePublicationRecord,
  standardSitePublicationRkey,
  standardSiteSyncConfig,
  validIsoDateTime,
  type StandardSiteDocumentRecord,
  type StandardSitePublicationRecord,
  type StandardSiteRecord,
  type StandardSiteSyncConfig
} from "../shared/standardSite.js";
import { repoRoot } from "../shared/repoRoot.js";
import { createWikiStore } from "../wiki/store.js";

const execFileAsync = promisify(execFile);
const fallbackPublishedAt = "2026-05-10T00:00:00+09:00";
const gitCommitDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type SyncArgs = {
  dryRun: boolean;
  deleteStale: boolean;
};

type StandardSiteDocumentSyncItem = {
  noteId: string;
  rkey: string;
  uri: string;
  record: StandardSiteDocumentRecord;
};

export type StandardSiteSyncPayload = {
  publication: {
    collection: typeof standardSitePublicationCollection;
    rkey: typeof standardSitePublicationRkey;
    uri: string;
    record: StandardSitePublicationRecord;
  };
  documents: StandardSiteDocumentSyncItem[];
};

type XrpcFetch = typeof fetch;

type SyncResult = {
  dryRun: boolean;
  publication: string;
  documents: string[];
  deletedStale: string[];
};

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function standardSiteDocumentAtUri(did: string, rkey: string) {
  return `at://${did}/${standardSiteDocumentCollection}/${rkey}`;
}

function gitVaultPathspec(rootDir: string, vaultDir: string) {
  const relative = path.relative(rootDir, vaultDir).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative;
}

function parseGitCreatedAtLog(output: string, vaultPathspec: string) {
  const createdAtByPath = new Map<string, string>();
  let currentDate: string | undefined;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (gitCommitDatePattern.test(line)) {
      currentDate = line;
      continue;
    }
    if (!currentDate || !line.toLowerCase().endsWith(".md")) {
      continue;
    }
    const normalized = line.replace(/\\/g, "/");
    const relativePath = normalized.startsWith(`${vaultPathspec}/`) ? normalized.slice(vaultPathspec.length + 1) : normalized;
    if (!createdAtByPath.has(relativePath)) {
      createdAtByPath.set(relativePath, currentDate);
    }
  }
  return createdAtByPath;
}

export async function readGitCreatedAtByPath(rootDir: string, vaultDir: string) {
  const vaultPathspec = gitVaultPathspec(rootDir, vaultDir);
  if (!vaultPathspec) {
    return new Map<string, string>();
  }
  try {
    const { stdout } = await execFileAsync("git", ["log", "--reverse", "--format=%cI", "--name-only", "--", vaultPathspec], {
      cwd: rootDir,
      maxBuffer: 10 * 1024 * 1024
    });
    return parseGitCreatedAtLog(stdout, vaultPathspec);
  } catch {
    return new Map<string, string>();
  }
}

export function standardSitePublishedAt(note: Pick<NoteDetail, "path" | "frontmatter">, createdAtByPath: Map<string, string>) {
  return validIsoDateTime(note.frontmatter.standard_site_published_at) ?? createdAtByPath.get(note.path.replace(/\\/g, "/")) ?? fallbackPublishedAt;
}

function validatePublicationRecord(record: StandardSitePublicationRecord) {
  requireString(record.url, "publication.url");
  requireString(record.name, "publication.name");
  if (record.url.endsWith("/")) {
    throw new Error("publication.url must not have a trailing slash");
  }
}

function validateDocumentRecord(record: StandardSiteDocumentRecord) {
  requireString(record.site, "document.site");
  requireString(record.path, "document.path");
  requireString(record.title, "document.title");
  requireString(record.publishedAt, "document.publishedAt");
  if (!record.path.startsWith("/")) {
    throw new Error(`document.path must start with a slash: ${record.path}`);
  }
  if (!validIsoDateTime(record.publishedAt)) {
    throw new Error(`document.publishedAt must be a valid datetime: ${record.publishedAt}`);
  }
  if ("textContent" in record) {
    throw new Error("document.textContent must not be included");
  }
}

export function buildStandardSiteSyncPayload(
  notes: NoteDetail[],
  config: Pick<StandardSiteSyncConfig, "did" | "publicOrigin" | "publicationName" | "showInDiscover" | "publicationAtUri">,
  createdAtByPath: Map<string, string>
): StandardSiteSyncPayload {
  const publication: StandardSiteSyncPayload["publication"] = {
    collection: standardSitePublicationCollection,
    rkey: standardSitePublicationRkey,
    uri: config.publicationAtUri,
    record: standardSitePublicationRecord(config)
  };
  validatePublicationRecord(publication.record);

  const documents = notes
    .filter((note) => note.frontmatter.publish === true && isStandardSiteNote(note))
    .map((note) => {
      const rkey = standardSiteDocumentRkey(note.id);
      const record = standardSiteDocumentRecord(note, {
        site: config.publicationAtUri,
        publishedAt: standardSitePublishedAt(note, createdAtByPath)
      });
      validateDocumentRecord(record);
      return {
        noteId: note.id,
        rkey,
        uri: standardSiteDocumentAtUri(config.did, rkey),
        record
      };
    });

  return {
    publication,
    documents
  };
}

function xrpcUrl(config: Pick<StandardSiteSyncConfig, "pdsUrl">, method: string, params?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`/xrpc/${method}`, config.pdsUrl);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readJsonResponse(response: Response, method: string) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} failed with ${response.status}: ${text}`);
  }
  return json as Record<string, unknown>;
}

async function xrpcPost(
  fetchFn: XrpcFetch,
  config: Pick<StandardSiteSyncConfig, "pdsUrl">,
  method: string,
  body: Record<string, unknown>,
  accessJwt?: string
) {
  const response = await fetchFn(xrpcUrl(config, method), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessJwt ? { Authorization: `Bearer ${accessJwt}` } : {})
    },
    body: JSON.stringify(body)
  });
  return readJsonResponse(response, method);
}

async function xrpcGet(fetchFn: XrpcFetch, config: Pick<StandardSiteSyncConfig, "pdsUrl">, method: string, params: Record<string, string | number | boolean | undefined>) {
  const response = await fetchFn(xrpcUrl(config, method, params));
  return readJsonResponse(response, method);
}

async function createSession(fetchFn: XrpcFetch, config: StandardSiteSyncConfig) {
  const json = await xrpcPost(fetchFn, config, "com.atproto.server.createSession", {
    identifier: config.identifier,
    password: config.appPassword
  });
  const accessJwt = requireString(json.accessJwt, "session.accessJwt");
  const did = requireString(json.did, "session.did");
  if (did !== config.did) {
    throw new Error(`Authenticated DID ${did} does not match SECRET_WIKI_STANDARD_SITE_DID ${config.did}`);
  }
  return { accessJwt };
}

async function putRecord(fetchFn: XrpcFetch, config: StandardSiteSyncConfig, accessJwt: string, collection: string, rkey: string, record: StandardSiteRecord) {
  const json = await xrpcPost(
    fetchFn,
    config,
    "com.atproto.repo.putRecord",
    {
      repo: config.did,
      collection,
      rkey,
      validate: false,
      record
    },
    accessJwt
  );
  return requireString(json.uri, "putRecord.uri");
}

function rkeyFromAtUri(uri: string) {
  const parts = uri.split("/");
  return parts.at(-1) ?? "";
}

async function listDocumentRkeys(fetchFn: XrpcFetch, config: StandardSiteSyncConfig) {
  const rkeys: string[] = [];
  let cursor: string | undefined;
  do {
    const json = await xrpcGet(fetchFn, config, "com.atproto.repo.listRecords", {
      repo: config.did,
      collection: standardSiteDocumentCollection,
      limit: 100,
      cursor
    });
    const records = Array.isArray(json.records) ? json.records : [];
    for (const record of records) {
      if (!record || typeof record !== "object") {
        continue;
      }
      const uri = (record as { uri?: unknown }).uri;
      if (typeof uri === "string") {
        const rkey = rkeyFromAtUri(uri);
        if (rkey.startsWith("note-")) {
          rkeys.push(rkey);
        }
      }
    }
    cursor = typeof json.cursor === "string" ? json.cursor : undefined;
  } while (cursor);
  return rkeys;
}

async function deleteDocumentRecord(fetchFn: XrpcFetch, config: StandardSiteSyncConfig, accessJwt: string, rkey: string) {
  await xrpcPost(
    fetchFn,
    config,
    "com.atproto.repo.deleteRecord",
    {
      repo: config.did,
      collection: standardSiteDocumentCollection,
      rkey
    },
    accessJwt
  );
}

export async function syncStandardSitePayload(
  payload: StandardSiteSyncPayload,
  config: StandardSiteSyncConfig,
  options: SyncArgs,
  fetchFn: XrpcFetch = fetch
): Promise<SyncResult> {
  if (options.dryRun) {
    return {
      dryRun: true,
      publication: payload.publication.uri,
      documents: payload.documents.map((item) => item.uri),
      deletedStale: []
    };
  }

  const session = await createSession(fetchFn, config);
  const publication = await putRecord(fetchFn, config, session.accessJwt, payload.publication.collection, payload.publication.rkey, payload.publication.record);
  const documents: string[] = [];
  for (const item of payload.documents) {
    documents.push(await putRecord(fetchFn, config, session.accessJwt, standardSiteDocumentCollection, item.rkey, item.record));
  }

  const deletedStale: string[] = [];
  if (options.deleteStale) {
    const desiredRkeys = new Set(payload.documents.map((item) => item.rkey));
    for (const rkey of await listDocumentRkeys(fetchFn, config)) {
      if (!desiredRkeys.has(rkey)) {
        await deleteDocumentRecord(fetchFn, config, session.accessJwt, rkey);
        deletedStale.push(rkey);
      }
    }
  }

  return {
    dryRun: false,
    publication,
    documents,
    deletedStale
  };
}

export function parseStandardSiteSyncArgs(argv: string[]): SyncArgs {
  const args = new Set(argv);
  for (const arg of args) {
    if (!["--dry-run", "--delete-stale"].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    dryRun: args.has("--dry-run"),
    deleteStale: args.has("--delete-stale")
  };
}

export async function loadStandardSiteSyncPayload(config: Pick<StandardSiteSyncConfig, "did" | "publicOrigin" | "publicationName" | "showInDiscover" | "publicationAtUri">) {
  const store = createWikiStore({ rootDir: repoRoot });
  const notes = await store.searchPublicNotes();
  const createdAtByPath = await readGitCreatedAtByPath(store.rootDir, store.vaultDir);
  return buildStandardSiteSyncPayload(notes, config, createdAtByPath);
}

export async function runStandardSiteSync(argv: string[], env: NodeJS.ProcessEnv = process.env, fetchFn: XrpcFetch = fetch) {
  const args = parseStandardSiteSyncArgs(argv);
  const config = standardSiteSyncConfig(env, { requireAuth: !args.dryRun });
  const payload = await loadStandardSiteSyncPayload(config);
  const result = await syncStandardSitePayload(payload, config, args, fetchFn);
  const output = {
    mode: result.dryRun ? "dry-run" : "sync",
    publication: result.publication,
    documents: result.documents,
    deletedStale: result.deletedStale,
    publicOrigin: config.publicOrigin || defaultPublicOrigin
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}
