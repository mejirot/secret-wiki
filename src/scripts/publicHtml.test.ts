import { describe, expect, test } from "vitest";
import type { NoteDetail } from "../shared/types.js";
import { withNoteHead } from "./publicHtml.js";

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
    frontmatter: {},
    ...overrides
  };
}

describe("public HTML helpers", () => {
  test("adds a standard.site document link only when an AT URI is provided", () => {
    const base = [
      "<html><head>",
      "<title>Old</title>",
      '<meta name="description" content="old" />',
      "</head><body></body></html>"
    ].join("");
    const withoutStandardSite = withNoteHead(base, note(), { publicOrigin: "https://example.com" });
    const withStandardSite = withNoteHead(base, note(), {
      publicOrigin: "https://example.com",
      standardSiteDocumentAtUri: "at://did:plc:example/site.standard.document/note-abc"
    });

    expect(withoutStandardSite).not.toContain('rel="site.standard.document"');
    expect(withStandardSite).toContain('<link rel="site.standard.document" href="at://did:plc:example/site.standard.document/note-abc" />');
    expect(withStandardSite).toContain('<meta property="og:url" content="https://example.com/note/blog/standard" />');
  });
});
