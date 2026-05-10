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

  test("link card directives use their label in note excerpts", async () => {
    const store = await withStore({
      "card.md": "---\ntitle: Card\n---\n::link-card[Example Site](https://example.com)\n\nBody text."
    });

    const card = await store.getNote("card");
    expect(card?.excerpt).toContain("Example Site");
    expect(card?.excerpt).not.toContain("::link-card");
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

  test("public export does not generate folder index files", async () => {
    const store = await withStore({
      "boardgame/a.md": "---\ntitle: Alpha\ntags: [boardgame]\n---\nA",
      "boardgame/b/index.md": "---\ntitle: Beta\ntags: [boardgame]\ncover: assets/cover.jpg\n---\nB",
      "boardgame/b/assets/cover.jpg": "cover"
    });

    const result = await store.exportPublicSite();

    expect(result.notes.sort()).toEqual(["boardgame/a", "boardgame/b"]);
    await expect(fs.access(path.join(store.vaultDir, "boardgame", "index.md"))).rejects.toThrow();
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

  test("LLM update only allows notes already available to LLM", async () => {
    const store = await withStore({
      "public.md": "---\ntitle: Public\ntags: [open]\nllm_access: true\n---\nVisible body",
      "private.md": "---\ntitle: Private\ntags: [closed]\n---\nPrivate body"
    });

    await expect(
      store.updateLlmAccessibleNote({
        id: "private",
        body: "Attempted update"
      })
    ).rejects.toThrow("Note not found or not available to LLM");

    const updated = await store.updateLlmAccessibleNote({
      id: "public",
      title: "Updated Public",
      tags: ["open", "edited"],
      body: "Updated visible body"
    });
    expect(updated?.title).toBe("Updated Public");
    expect(updated?.tags).toEqual(["open", "edited"]);
    expect(updated?.body).toBe("Updated visible body\n");
    expect(updated?.llm_access).toBe(true);

    const privateNote = await store.getNote("private");
    expect(privateNote?.body).toBe("Private body");
    expect(privateNote?.llm_access).toBe(false);
  });

  test("LLM update cannot change llm_access even if provided at runtime", async () => {
    const store = await withStore({
      "public.md": "---\ntitle: Public\nllm_access: true\n---\nVisible body"
    });

    const updated = await store.updateLlmAccessibleNote({
      id: "public",
      body: "Still visible",
      llm_access: false
    } as Parameters<typeof store.updateLlmAccessibleNote>[0] & { llm_access: boolean });

    expect(updated?.body).toBe("Still visible\n");
    expect(updated?.llm_access).toBe(true);
  });
});
