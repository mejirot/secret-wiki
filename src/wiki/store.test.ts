import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWikiStore } from "./store.js";

async function withStore(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "secret-wiki-"));
  const vault = path.join(root, "vault");
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(vault, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return createWikiStore({ rootDir: root });
}

describe("wiki store", () => {
  test("frontmatter defaults keep notes private from LLM", async () => {
    const store = await withStore({
      "private.md": "# Private\n\nNo frontmatter here."
    });

    const index = await store.buildIndex();
    expect(index.notes).toHaveLength(1);
    expect(index.notes[0].llm_access).toBe(false);
  });

  test("search can be restricted to llm_access notes", async () => {
    const store = await withStore({
      "open.md": "---\ntitle: Open\ntags: [ops]\nllm_access: true\n---\nVisible keyword",
      "closed.md": "---\ntitle: Closed\ntags: [ops]\n---\nVisible keyword"
    });

    const notes = await store.searchNotes({ query: "Visible" }, true);
    expect(notes.map((note) => note.id)).toEqual(["open"]);
  });

  test("wiki links and markdown links produce outgoing, backlinks, and broken links", async () => {
    const store = await withStore({
      "a.md": "---\ntitle: A\n---\nSee [[b]] and [missing](missing.md).",
      "b.md": "---\ntitle: B\n---\nLinked from A."
    });

    const a = await store.getNote("a");
    const b = await store.getNote("b");
    expect(a?.outgoing).toEqual(["b"]);
    expect(a?.brokenLinks).toEqual(["missing.md"]);
    expect(b?.backlinks).toEqual(["a"]);
  });

  test("page bundle index.md files use the folder as their canonical note id", async () => {
    const store = await withStore({
      "flat.md": "---\ntitle: Flat\n---\nFlat note.",
      "bundle/index.md": "---\ntitle: Bundle\n---\nBundle note.",
      "links.md": "---\ntitle: Links\n---\nSee [[bundle]]."
    });

    const index = await store.buildIndex();
    expect(index.notes.map((note) => note.id).sort()).toContain("bundle");
    expect(index.notes.map((note) => note.id).sort()).toContain("flat");

    const bundle = await store.getNote("bundle/index");
    const links = await store.getNote("links");
    expect(bundle?.id).toBe("bundle");
    expect(bundle?.path).toBe("bundle/index.md");
    expect(links?.outgoing).toEqual(["bundle"]);
  });

  test("relative markdown images and cover frontmatter produce media metadata", async () => {
    const store = await withStore({
      "gallery/item/index.md": "---\ntitle: Item\ncover: assets/cover.jpg\n---\n![cover](assets/cover.jpg)\n![missing](assets/missing.jpg)",
      "gallery/item/assets/cover.jpg": "fake image"
    });

    const item = await store.getNote("gallery/item");
    const index = await store.buildIndex();
    expect(item?.cover).toBe("assets/cover.jpg");
    expect(item?.media.find((media) => media.source === "assets/cover.jpg")?.exists).toBe(true);
    expect(item?.brokenMedia.map((media) => media.source)).toEqual(["assets/missing.jpg"]);
    expect(index.mediaWarnings).toEqual([{ note: "gallery/item", target: "assets/missing.jpg", reason: "Media file cannot be resolved" }]);
  });

  test("media resolution rejects traversal outside the note bundle", async () => {
    const store = await withStore({
      "gallery/item/index.md": "---\ntitle: Item\n---\n![bad](../secret.jpg)",
      "gallery/secret.jpg": "secret"
    });

    await expect(store.resolveMediaFile("gallery/item", "../secret.jpg")).rejects.toThrow("Invalid media path");
  });

  test("generated folder indexes are protected and omit themselves from the generated list", async () => {
    const store = await withStore({
      "boardgame/a.md": "---\ntitle: Alpha\ntags: [boardgame]\n---\nA",
      "boardgame/b/index.md": "---\ntitle: Beta\ntags: [boardgame]\ncover: assets/cover.jpg\n---\nB",
      "boardgame/b/assets/cover.jpg": "cover"
    });

    const generated = await store.generateFolderIndex({ folder: "boardgame" });
    expect(generated?.id).toBe("boardgame");

    const generatedMarkdown = await fs.readFile(path.join(store.vaultDir, "boardgame", "index.md"), "utf8");
    expect(generatedMarkdown).toContain("auto_index: true");
    expect(generatedMarkdown).toContain("[[boardgame/a|Alpha]]");
    expect(generatedMarkdown).toContain("[[boardgame/b|Beta]]");
    expect(generatedMarkdown).toContain("![cover](b/assets/cover.jpg)");
    expect(generatedMarkdown).not.toContain("[[boardgame|");

    const protectedStore = await withStore({
      "boardgame/index.md": "---\ntitle: Hand Written\n---\nDo not overwrite."
    });
    await expect(protectedStore.generateFolderIndex({ folder: "boardgame" })).rejects.toThrow("Refusing to overwrite");
  });

  test("public export includes all notes and strips local-only frontmatter", async () => {
    const store = await withStore({
      "public.md": "---\ntitle: Public\npublish: true\nllm_access: true\n---\nSee [[private]].",
      "private.md": "---\ntitle: Private\n---\nSecret."
    });

    const result = await store.exportPublicSite();
    expect(result.notes.sort()).toEqual(["private", "public"]);
    expect(result.warnings).toEqual([]);

    const exportedIndex = JSON.parse(await fs.readFile(path.join(store.exportDir, "data", "index.json"), "utf8"));
    expect(exportedIndex.notes.map((note: { id: string }) => note.id).sort()).toEqual(["private", "public"]);

    const exported = JSON.parse(await fs.readFile(path.join(store.exportDir, "data", "notes", "public.json"), "utf8"));
    expect(exported.llm_access).toBe(true);
    expect(exported.frontmatter.publish).toBeUndefined();
    expect(exported.frontmatter.llm_access).toBeUndefined();
  });

  test("public export copies media referenced by all notes", async () => {
    const store = await withStore({
      "public/item/index.md": "---\ntitle: Public Item\npublish: true\n---\n![cover](assets/cover.jpg)",
      "public/item/assets/cover.jpg": "public image",
      "private/item/index.md": "---\ntitle: Private Item\n---\n![cover](assets/secret.jpg)",
      "private/item/assets/secret.jpg": "private image"
    });

    const result = await store.exportPublicSite();
    expect(result.notes.sort()).toEqual(["private/item", "public/item"]);
    await expect(fs.readFile(path.join(store.exportDir, "public", "item", "assets", "cover.jpg"), "utf8")).resolves.toBe("public image");
    await expect(fs.readFile(path.join(store.exportDir, "private", "item", "assets", "secret.jpg"), "utf8")).resolves.toBe("private image");
  });

  test("create and update preserve private defaults unless explicitly changed", async () => {
    const store = await withStore({});

    const created = await store.createNote({
      path: "inbox/captured",
      title: "Captured",
      body: "Initial body"
    });
    expect(created?.llm_access).toBe(false);

    const updated = await store.updateNote({
      id: "inbox/captured",
      tags: ["inbox"],
      llm_access: true,
      body: "Updated body"
    });
    expect(updated?.tags).toEqual(["inbox"]);
    expect(updated?.llm_access).toBe(true);
    expect(updated?.path).toBe("inbox/captured/index.md");
    expect(updated?.body).toBe("Updated body\n");
  });
});
