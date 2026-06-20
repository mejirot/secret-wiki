import { describe, expect, test } from "vitest";
import type { NoteDetail } from "../shared/types.js";
import {
  buildStandardSiteSyncPayload,
  parseStandardSiteSyncArgs,
  standardSitePublishedAt,
  syncStandardSitePayload
} from "./standardSiteSync.js";

function note(overrides: Partial<NoteDetail> = {}): NoteDetail {
  return {
    id: "blog/standard",
    path: "blog/standard.md",
    title: "Standard Site",
    tags: ["wiki"],
    folder: "blog",
    media: [],
    brokenMedia: [],
    excerpt: "Standard excerpt",
    updatedAt: "2026-05-10T00:00:00+09:00",
    outgoing: [],
    backlinks: [],
    brokenLinks: [],
    externalLinks: [],
    llm_access: false,
    body: "Body",
    frontmatter: { publish: true, standard_site: true },
    ...overrides
  };
}

const config = {
  did: "did:plc:example",
  publicOrigin: "https://example.com",
  publicationName: "Secret Wiki",
  showInDiscover: false,
  publicationAtUri: "at://did:plc:example/site.standard.publication/self"
};

describe("standard.site sync", () => {
  test("builds publication and document records without textContent", () => {
    const payload = buildStandardSiteSyncPayload(
      [
        note(),
        note({ id: "blog/publish-only", path: "blog/publish-only.md", frontmatter: { publish: true } }),
        note({ id: "blog/standard-private", path: "blog/standard-private.md", frontmatter: { standard_site: true } })
      ],
      config,
      new Map([["blog/standard.md", "2024-01-02T03:04:05+09:00"]])
    );

    expect(payload.publication.record).toEqual({
      $type: "site.standard.publication",
      url: "https://example.com",
      name: "Secret Wiki",
      preferences: { showInDiscover: false }
    });
    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0].record).toEqual({
      $type: "site.standard.document",
      site: "at://did:plc:example/site.standard.publication/self",
      path: "/note/blog/standard",
      title: "Standard Site",
      description: "Standard excerpt",
      tags: ["wiki"],
      publishedAt: "2024-01-02T03:04:05+09:00"
    });
    expect(payload.documents[0].record).not.toHaveProperty("textContent");
  });

  test("uses frontmatter publishedAt before git-created fallback", () => {
    const createdAtByPath = new Map([["blog/standard.md", "2024-01-02T03:04:05+09:00"]]);

    expect(standardSitePublishedAt(note({ frontmatter: { publish: true, standard_site: true, standard_site_published_at: "2025-02-03T04:05:06+09:00" } }), createdAtByPath)).toBe(
      "2025-02-03T04:05:06+09:00"
    );
    expect(standardSitePublishedAt(note(), createdAtByPath)).toBe("2024-01-02T03:04:05+09:00");
    expect(standardSitePublishedAt(note({ path: "missing.md", frontmatter: { publish: true, standard_site: true, standard_site_published_at: "not-a-date" } }), createdAtByPath)).toBe(
      "2026-05-10T00:00:00+09:00"
    );
  });

  test("dry-run validates payload and does not call PDS", async () => {
    const payload = buildStandardSiteSyncPayload([note()], config, new Map());
    let called = false;
    const result = await syncStandardSitePayload(
      payload,
      {
        ...config,
        pdsUrl: "https://bsky.social",
        identifier: undefined,
        appPassword: undefined
      },
      { dryRun: true, deleteStale: true },
      async () => {
        called = true;
        throw new Error("fetch should not be called");
      }
    );

    expect(called).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.documents).toHaveLength(1);
    expect(result.deletedStale).toEqual([]);
  });

  test("parses supported CLI arguments", () => {
    expect(parseStandardSiteSyncArgs(["--dry-run"])).toEqual({ dryRun: true, deleteStale: false });
    expect(parseStandardSiteSyncArgs(["--delete-stale"])).toEqual({ dryRun: false, deleteStale: true });
    expect(() => parseStandardSiteSyncArgs(["--bad"])).toThrow("Unknown argument");
  });
});
