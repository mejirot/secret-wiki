import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { createWikiStore } from "./store.js";

const execFileAsync = promisify(execFile);
const fallbackUpdatedAt = "2026-05-10T00:00:00+09:00";

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

async function writeVaultFile(root: string, relative: string, content: string) {
  const target = path.join(root, "vault", relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function runGit(root: string, args: string[], env: Record<string, string> = {}) {
  await execFileAsync("git", args, {
    cwd: root,
    env: { ...process.env, ...env }
  });
}

function pathToFileUrl(filePath: string) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
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

  test("uses a fixed updatedAt fallback when git history is unavailable", async () => {
    const store = await withStore({
      "private.md": "# Private\n\nNo frontmatter here."
    });

    const index = await store.buildIndex();
    expect(index.notes[0].updatedAt).toBe(fallbackUpdatedAt);
  });

  test("uses the latest git commit date for tracked markdown notes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "secret-wiki-git-"));
    const olderDate = "2024-01-02T03:04:05+09:00";
    const newerDate = "2024-02-03T04:05:06+09:00";

    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.email", "secret-wiki@example.test"]);
    await runGit(root, ["config", "user.name", "Secret Wiki Test"]);
    await writeVaultFile(root, "tracked.md", "---\ntitle: Tracked\n---\nInitial body.");
    await runGit(root, ["add", "vault/tracked.md"]);
    await runGit(root, ["commit", "-m", "Add tracked note"], {
      GIT_AUTHOR_DATE: olderDate,
      GIT_COMMITTER_DATE: olderDate
    });
    await writeVaultFile(root, "tracked.md", "---\ntitle: Tracked\n---\nUpdated body.");
    await runGit(root, ["add", "vault/tracked.md"]);
    await runGit(root, ["commit", "-m", "Update tracked note"], {
      GIT_AUTHOR_DATE: newerDate,
      GIT_COMMITTER_DATE: newerDate
    });
    await writeVaultFile(root, "untracked.md", "---\ntitle: Untracked\n---\nDraft body.");

    const store = createWikiStore({ rootDir: root });
    const index = await store.buildIndex();
    const tracked = index.notes.find((note) => note.id === "tracked");
    const untracked = index.notes.find((note) => note.id === "untracked");

    expect(tracked?.updatedAt).toBe(newerDate);
    expect(untracked?.updatedAt).toBe(fallbackUpdatedAt);
  });

  test("unshallows git history before reading tracked markdown dates", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "secret-wiki-source-"));
    const cloneParent = await fs.mkdtemp(path.join(os.tmpdir(), "secret-wiki-clone-"));
    const shallowRoot = path.join(cloneParent, "repo");
    const noteDate = "2024-03-04T05:06:07+09:00";
    const headDate = "2024-04-05T06:07:08+09:00";

    await runGit(sourceRoot, ["init"]);
    await runGit(sourceRoot, ["config", "user.email", "secret-wiki@example.test"]);
    await runGit(sourceRoot, ["config", "user.name", "Secret Wiki Test"]);
    await writeVaultFile(sourceRoot, "tracked.md", "---\ntitle: Tracked\n---\nInitial body.");
    await runGit(sourceRoot, ["add", "vault/tracked.md"]);
    await runGit(sourceRoot, ["commit", "-m", "Add tracked note"], {
      GIT_AUTHOR_DATE: noteDate,
      GIT_COMMITTER_DATE: noteDate
    });
    await fs.writeFile(path.join(sourceRoot, "README.md"), "# Readme\n", "utf8");
    await runGit(sourceRoot, ["add", "README.md"]);
    await runGit(sourceRoot, ["commit", "-m", "Update readme"], {
      GIT_AUTHOR_DATE: headDate,
      GIT_COMMITTER_DATE: headDate
    });
    await execFileAsync("git", ["clone", "--depth", "1", pathToFileUrl(sourceRoot), shallowRoot]);

    const store = createWikiStore({ rootDir: shallowRoot });
    const index = await store.buildIndex();
    const tracked = index.notes.find((note) => note.id === "tracked");

    expect(tracked?.updatedAt).toBe(noteDate);
    expect(tracked?.updatedAt).not.toBe(headDate);
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
    expect(await fs.readFile(path.join(store.vaultDir, "inbox", "captured", "index.md"), "utf8")).not.toContain("updated:");
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
