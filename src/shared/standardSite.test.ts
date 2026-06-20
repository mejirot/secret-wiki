import { describe, expect, test } from "vitest";
import {
  isAtprotoRecordKey,
  isStandardSiteNote,
  notePagePath,
  standardSiteDocumentAtUri,
  standardSiteDocumentRkey,
  standardSitePublicationAtUri,
  standardSiteStaticConfig
} from "./standardSite.js";

describe("standard.site helpers", () => {
  test("builds stable AT URIs and record keys", () => {
    const did = "did:plc:example";
    const rkey = standardSiteDocumentRkey("blog/secret-wiki");

    expect(rkey).toBe(standardSiteDocumentRkey("blog/secret-wiki"));
    expect(rkey).toMatch(/^note-[a-f0-9]{32}$/);
    expect(isAtprotoRecordKey(rkey)).toBe(true);
    expect(standardSitePublicationAtUri(did)).toBe("at://did:plc:example/site.standard.publication/self");
    expect(standardSiteDocumentAtUri(did, "blog/secret-wiki")).toBe(`at://did:plc:example/site.standard.document/${rkey}`);
  });

  test("validates AT Protocol record key syntax", () => {
    expect(isAtprotoRecordKey("note-abc_123.~:x")).toBe(true);
    expect(isAtprotoRecordKey("")).toBe(false);
    expect(isAtprotoRecordKey(".")).toBe(false);
    expect(isAtprotoRecordKey("..")).toBe(false);
    expect(isAtprotoRecordKey("has/slash")).toBe(false);
    expect(isAtprotoRecordKey("has space")).toBe(false);
  });

  test("uses standard_site true as the only opt-in flag", () => {
    expect(isStandardSiteNote({ frontmatter: { standard_site: true } })).toBe(true);
    expect(isStandardSiteNote({ frontmatter: { publish: true } })).toBe(false);
    expect(isStandardSiteNote({ frontmatter: { standard_site: "true" } })).toBe(false);
  });

  test("builds note paths and static config from environment", () => {
    expect(notePagePath("blog/secret wiki")).toBe("/note/blog/secret%20wiki");
    expect(standardSiteStaticConfig({ SECRET_WIKI_STANDARD_SITE_ENABLED: "false" })).toEqual({ enabled: false });
    expect(
      standardSiteStaticConfig({
        SECRET_WIKI_STANDARD_SITE_ENABLED: "true",
        SECRET_WIKI_STANDARD_SITE_DID: "did:plc:example",
        SECRET_WIKI_PUBLIC_ORIGIN: "https://example.com/"
      })
    ).toEqual({
      enabled: true,
      did: "did:plc:example",
      publicOrigin: "https://example.com",
      publicationAtUri: "at://did:plc:example/site.standard.publication/self"
    });
  });
});
