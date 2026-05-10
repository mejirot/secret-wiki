import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  CreateNoteInput,
  GenerateIndexInput,
  NoteMedia,
  NoteDetail,
  NoteSummary,
  PublicExportResult,
  SearchFilters,
  UpdateNoteInput,
  WikiIndex
} from "../shared/types.js";

type WikiStoreOptions = {
  rootDir?: string;
  vaultDir?: string;
  exportDir?: string;
};

type ParsedNote = {
  id: string;
  absolutePath: string;
  relativePath: string;
  noteDir: string;
  body: string;
  frontmatter: Record<string, unknown>;
  mtime: Date;
};

const INTERNAL_EXPORT_KEYS = new Set(["llm_access"]);
const IGNORED_FRONTMATTER_KEYS = new Set(["publish"]);
const AUTO_INDEX_MARKER = "<!-- secret-wiki:auto-index -->";
const DEFAULT_INDEX_FOLDERS = ["boardgame"];

export function createWikiStore(options: WikiStoreOptions = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const vaultDir = path.resolve(options.vaultDir ?? path.join(rootDir, "vault"));
  const exportDir = path.resolve(options.exportDir ?? path.join(rootDir, "exports", "public"));

  async function ensureVault() {
    await fs.mkdir(vaultDir, { recursive: true });
  }

  function normalizeId(input: string) {
    return input.replace(/\\/g, "/").replace(/\.md$/i, "").replace(/^\/+/, "").replace(/\/+$/, "");
  }

  function canonicalIdFromRelativePath(relativePath: string) {
    const normalized = normalizeId(relativePath);
    const basename = path.posix.basename(normalized);
    const dirname = path.posix.dirname(normalized);
    if (basename === "index" && dirname !== ".") {
      return dirname;
    }
    return normalized;
  }

  function noteDirFromRelativePath(relativePath: string) {
    const normalized = relativePath.replace(/\\/g, "/");
    const withoutExt = normalizeId(normalized);
    const dirname = path.posix.dirname(normalized);
    if (path.posix.basename(withoutExt) === "index" && dirname !== ".") {
      return dirname;
    }
    return dirname === "." ? "" : dirname;
  }

  function safeVaultPath(relativePath: string) {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("..")) {
      throw new Error(`Invalid vault path: ${relativePath}`);
    }
    const absolutePath = path.resolve(vaultDir, normalized);
    if (!absolutePath.startsWith(vaultDir + path.sep)) {
      throw new Error(`Path escapes vault: ${relativePath}`);
    }
    return absolutePath;
  }

  function safeMarkdownPathFromId(id: string) {
    const normalized = normalizeId(id);
    if (!normalized || normalized.includes("..")) {
      throw new Error(`Invalid note id: ${id}`);
    }
    return safeVaultPath(`${normalized}.md`);
  }

  function safePathFromCreateInput(inputPath: string) {
    const normalizedInput = inputPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    const normalized = normalizeId(normalizedInput);
    if (!normalized || normalized.includes("..")) {
      throw new Error(`Invalid note path: ${inputPath}`);
    }
    if (normalizedInput.toLowerCase().endsWith(".md") || path.posix.basename(normalized) === "index") {
      return safeMarkdownPathFromId(normalized);
    }
    return safeVaultPath(`${normalized}/index.md`);
  }

  async function listMarkdownFiles(dir = vaultDir): Promise<string[]> {
    await ensureVault();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return listMarkdownFiles(absolute);
        }
        return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [absolute] : [];
      })
    );
    return files.flat();
  }

  async function readParsedNotes(): Promise<ParsedNote[]> {
    const files = await listMarkdownFiles();
    return Promise.all(
      files.map(async (absolutePath) => {
        const raw = await fs.readFile(absolutePath, "utf8");
        const parsed = matter(raw);
        const stat = await fs.stat(absolutePath);
        const relativePath = path.relative(vaultDir, absolutePath).replace(/\\/g, "/");
        return {
          id: canonicalIdFromRelativePath(relativePath),
          absolutePath,
          relativePath,
          noteDir: noteDirFromRelativePath(relativePath),
          body: parsed.content.trimStart(),
          frontmatter: parsed.data,
          mtime: stat.mtime
        };
      })
    );
  }

  function titleFor(note: ParsedNote) {
    return typeof note.frontmatter.title === "string" && note.frontmatter.title.trim()
      ? note.frontmatter.title.trim()
      : path.basename(note.id);
  }

  function tagsFor(note: ParsedNote) {
    const tags = note.frontmatter.tags;
    if (Array.isArray(tags)) {
      return tags.map((tag) => String(tag).trim()).filter(Boolean);
    }
    if (typeof tags === "string") {
      return tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    return [];
  }

  function accessFor(note: ParsedNote) {
    return {
      llm_access: note.frontmatter.llm_access === true
    };
  }

  function excerptFor(body: string) {
    return body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/^::link-card\[([^\]\n]+)\]\([^)]+\)\s*$/gm, "$1")
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target)
      .replace(/[#>*_`[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function coverFor(note: ParsedNote) {
    return typeof note.frontmatter.cover === "string" && note.frontmatter.cover.trim()
      ? note.frontmatter.cover.trim()
      : undefined;
  }

  function isAutoIndex(note: ParsedNote | NoteDetail) {
    return note.frontmatter.auto_index === true || note.body.includes(AUTO_INDEX_MARKER);
  }

  function isExternalTarget(target: string) {
    return /^(https?:|mailto:|#|data:)/i.test(target);
  }

  function normalizeMediaSource(source: string) {
    const withoutFragment = source.trim().split("#")[0].split("?")[0].replace(/\\/g, "/");
    if (!withoutFragment || isExternalTarget(withoutFragment) || withoutFragment.startsWith("/")) {
      return undefined;
    }
    let decoded = withoutFragment;
    try {
      decoded = decodeURIComponent(withoutFragment);
    } catch {
      return undefined;
    }
    const normalized = path.posix.normalize(decoded).replace(/^\.\/+/, "");
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
      return undefined;
    }
    return normalized;
  }

  function mediaVaultPath(note: ParsedNote | NoteDetail, mediaPath: string) {
    const baseDir = "noteDir" in note ? note.noteDir : note.path.endsWith("/index.md") ? path.posix.dirname(note.path) : path.posix.dirname(note.path);
    const base = baseDir === "." ? "" : baseDir;
    const vaultRelative = path.posix.join(base, mediaPath);
    return {
      vaultRelative,
      absolutePath: safeVaultPath(vaultRelative)
    };
  }

  function mediaUrl(noteId: string, mediaPath: string) {
    return `/api/media?note=${encodeURIComponent(noteId)}&path=${encodeURIComponent(mediaPath)}`;
  }

  async function extractMedia(note: ParsedNote): Promise<{ media: NoteMedia[]; brokenMedia: NoteMedia[]; cover?: string }> {
    const sources = new Set<string>();
    const markdownImagePattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of note.body.matchAll(markdownImagePattern)) {
      sources.add(match[1]);
    }
    const cover = coverFor(note);
    if (cover) {
      sources.add(cover);
    }

    const media = await Promise.all(
      [...sources].map(async (source) => {
        const mediaPath = normalizeMediaSource(source);
        const base: NoteMedia = {
          source,
          path: mediaPath ?? source,
          url: mediaPath ? mediaUrl(note.id, mediaPath) : "",
          exists: false
        };
        if (!mediaPath) {
          return base;
        }
        try {
          const resolved = mediaVaultPath(note, mediaPath);
          const stat = await fs.stat(resolved.absolutePath);
          return { ...base, exists: stat.isFile() };
        } catch {
          return base;
        }
      })
    );

    return {
      media,
      brokenMedia: media.filter((item) => !item.exists),
      cover
    };
  }

  function resolveTarget(target: string, fromId: string, notesById: Map<string, ParsedNote>) {
    const clean = target.trim().split("#")[0].replace(/\\/g, "/").replace(/^\.\//, "");
    if (!clean || /^(https?:|mailto:|#)/i.test(clean)) {
      return undefined;
    }
    const normalized = normalizeId(clean);
    if (notesById.has(normalized)) {
      return normalized;
    }
    const relative = normalizeId(path.posix.join(path.posix.dirname(fromId), normalized));
    if (notesById.has(relative)) {
      return relative;
    }
    const basenameMatches = [...notesById.keys()].filter((id) => path.posix.basename(id) === normalized);
    return basenameMatches.length === 1 ? basenameMatches[0] : undefined;
  }

  function extractLinks(note: ParsedNote, notesById: Map<string, ParsedNote>) {
    const outgoing = new Set<string>();
    const brokenLinks = new Set<string>();
    const wikiPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    const markdownPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

    for (const match of note.body.matchAll(wikiPattern)) {
      const target = match[1];
      const resolved = resolveTarget(target, note.id, notesById);
      resolved ? outgoing.add(resolved) : brokenLinks.add(target);
    }

    for (const match of note.body.matchAll(markdownPattern)) {
      if (match[0].startsWith("!")) {
        continue;
      }
      const target = decodeURIComponent(match[1]);
      const resolved = resolveTarget(target, note.id, notesById);
      if (resolved) {
        outgoing.add(resolved);
      } else if (!/^(https?:|mailto:|#)/i.test(target)) {
        brokenLinks.add(target);
      }
    }

    return {
      outgoing: [...outgoing].sort(),
      brokenLinks: [...brokenLinks].sort()
    };
  }

  async function buildIndex(): Promise<{ index: WikiIndex; details: Map<string, NoteDetail> }> {
    const parsedNotes = await readParsedNotes();
    const notesById = new Map(parsedNotes.map((note) => [note.id, note]));
    const linkData = new Map(parsedNotes.map((note) => [note.id, extractLinks(note, notesById)]));
    const backlinks = new Map<string, Set<string>>();

    for (const note of parsedNotes) {
      for (const target of linkData.get(note.id)?.outgoing ?? []) {
        if (!backlinks.has(target)) {
          backlinks.set(target, new Set());
        }
        backlinks.get(target)?.add(note.id);
      }
    }

    const details = new Map<string, NoteDetail>();
    const summaries: NoteSummary[] = (
      await Promise.all(
        parsedNotes.map(async (note) => {
          const folder = path.posix.dirname(note.id) === "." ? "" : path.posix.dirname(note.id);
          const links = linkData.get(note.id) ?? { outgoing: [], brokenLinks: [] };
          const mediaData = await extractMedia(note);
          const summary: NoteSummary = {
            id: note.id,
            path: note.relativePath,
            title: titleFor(note),
            tags: tagsFor(note),
            folder,
            cover: mediaData.cover,
            media: mediaData.media,
            brokenMedia: mediaData.brokenMedia,
            excerpt: excerptFor(note.body),
            updatedAt: note.mtime.toISOString(),
            outgoing: links.outgoing,
            backlinks: [...(backlinks.get(note.id) ?? new Set<string>())].sort(),
            brokenLinks: links.brokenLinks,
            ...accessFor(note)
          };
          details.set(note.id, {
            ...summary,
            body: note.body,
            frontmatter: note.frontmatter
          });
          return summary;
        })
      )
    ).sort((a, b) => a.title.localeCompare(b.title, "ja"));

    const tagCounts = new Map<string, number>();
    const folderCounts = new Map<string, number>();
    const broken: Array<{ from: string; target: string }> = [];
    const mediaWarnings: Array<{ note: string; target: string; reason: string }> = [];
    for (const note of summaries) {
      for (const tag of note.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      folderCounts.set(note.folder, (folderCounts.get(note.folder) ?? 0) + 1);
      for (const target of note.brokenLinks) {
        broken.push({ from: note.id, target });
      }
      for (const target of note.brokenMedia) {
        mediaWarnings.push({ note: note.id, target: target.source, reason: "Media file cannot be resolved" });
      }
    }

    return {
      index: {
        notes: summaries,
        tags: [...tagCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "ja")),
        folders: [...folderCounts.entries()].map(([folderPath, count]) => ({ path: folderPath, count })).sort((a, b) => a.path.localeCompare(b.path, "ja")),
        brokenLinks: broken,
        mediaWarnings
      },
      details
    };
  }

  function matchesSearch(note: NoteSummary | NoteDetail, filters: SearchFilters) {
    const query = filters.query?.trim().toLowerCase();
    const tags = filters.tags?.filter(Boolean) ?? [];
    if (filters.folder && note.folder !== filters.folder && !note.id.startsWith(`${filters.folder}/`)) {
      return false;
    }
    if (tags.length > 0 && !tags.every((tag) => note.tags.includes(tag))) {
      return false;
    }
    if (!query) {
      return true;
    }
    const detail = "body" in note ? note.body : "";
    return [note.title, note.id, note.excerpt, note.tags.join(" "), detail].join("\n").toLowerCase().includes(query);
  }

  async function searchNotes(filters: SearchFilters = {}, llmOnly = false) {
    const { index, details } = await buildIndex();
    return index.notes
      .filter((note) => (!llmOnly || note.llm_access) && matchesSearch(details.get(note.id) ?? note, filters))
      .map((note) => details.get(note.id) ?? note);
  }

  async function getNote(id: string, llmOnly = false) {
    const { details } = await buildIndex();
    const normalized = normalizeId(id);
    const note = details.get(normalized) ?? details.get(canonicalIdFromRelativePath(`${normalized}.md`));
    if (!note) {
      return undefined;
    }
    if (llmOnly && !note.llm_access) {
      return undefined;
    }
    return note;
  }

  function noteToMarkdown(frontmatter: Record<string, unknown>, body: string) {
    return matter.stringify(body.trimEnd() + "\n", frontmatter);
  }

  function stripIgnoredFrontmatter(frontmatter: Record<string, unknown>) {
    const next = { ...frontmatter };
    for (const key of IGNORED_FRONTMATTER_KEYS) {
      delete next[key];
    }
    return next;
  }

  async function updateNote(input: UpdateNoteInput) {
    const current = await getNote(input.id);
    if (!current) {
      throw new Error(`Note not found: ${input.id}`);
    }
    const absolutePath = safeVaultPath(current.path);
    const nextFrontmatter = {
      ...stripIgnoredFrontmatter(current.frontmatter),
      title: input.title ?? current.title,
      tags: input.tags ?? current.tags,
      llm_access: input.llm_access ?? current.llm_access
    };
    const nextBody = input.body ?? current.body;
    await fs.writeFile(absolutePath, noteToMarkdown(nextFrontmatter, nextBody), "utf8");
    return getNote(current.id);
  }

  async function createNote(input: CreateNoteInput) {
    const absolutePath = safePathFromCreateInput(input.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    try {
      await fs.access(absolutePath);
      throw new Error(`Note already exists: ${input.path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const frontmatter = {
      title: input.title,
      tags: input.tags ?? [],
      llm_access: input.llm_access === true
    };
    await fs.writeFile(absolutePath, noteToMarkdown(frontmatter, input.body), "utf8");
    return getNote(canonicalIdFromRelativePath(path.relative(vaultDir, absolutePath).replace(/\\/g, "/")));
  }

  async function resolveMediaFile(noteId: string, source: string) {
    const note = await getNote(noteId);
    if (!note) {
      return undefined;
    }
    const mediaPath = normalizeMediaSource(source);
    if (!mediaPath) {
      throw new Error(`Invalid media path: ${source}`);
    }
    const resolved = mediaVaultPath(note, mediaPath);
    try {
      const stat = await fs.stat(resolved.absolutePath);
      if (!stat.isFile()) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return resolved.absolutePath;
  }

  function displayFolderTitle(folder: string) {
    return folder
      .split("/")
      .filter(Boolean)
      .map((part) => part.replace(/[-_]+/g, " "))
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" / ");
  }

  function renderGeneratedIndex(folder: string, notes: NoteSummary[], previous?: NoteDetail) {
    function coverPathForIndex(note: NoteSummary) {
      if (!note.cover) {
        return "";
      }
      const media = note.media.find((item) => item.source === note.cover || item.path === note.cover);
      if (!media) {
        return note.cover;
      }
      const noteBase = path.posix.dirname(note.path) === "." ? "" : path.posix.dirname(note.path);
      return path.posix.relative(folder, path.posix.join(noteBase, media.path)).replace(/\\/g, "/");
    }

    const lines = [
      AUTO_INDEX_MARKER,
      "",
      `# ${previous?.title ?? displayFolderTitle(folder)}`,
      "",
      ...notes.flatMap((note) => {
        const tags = note.tags.length > 0 ? ` ${note.tags.map((tag) => `#${tag}`).join(" ")}` : "";
        const updated = note.updatedAt.slice(0, 10);
        const indexCover = coverPathForIndex(note);
        const cover = indexCover ? `![cover](${indexCover}) ` : "";
        const excerpt = note.excerpt ? `\n  ${note.excerpt}` : "";
        return [`- ${cover}[[${note.id}|${note.title}]]${tags} (${updated})${excerpt}`];
      }),
      ""
    ];
    return lines.join("\n");
  }

  async function generateFolderIndex(input: GenerateIndexInput) {
    const folder = normalizeId(input.folder);
    if (!folder || folder.includes("..")) {
      throw new Error(`Invalid index folder: ${input.folder}`);
    }
    const targetRelative = `${folder}/index.md`;
    const targetPath = safeVaultPath(targetRelative);
    const existing = await getNote(folder);
    if (existing && !isAutoIndex(existing)) {
      throw new Error(`Refusing to overwrite non-generated index: ${targetRelative}`);
    }

    const { index, details } = await buildIndex();
    const notes = index.notes.filter((note) => {
      if (note.id === folder || !note.id.startsWith(`${folder}/`)) {
        return false;
      }
      const detail = details.get(note.id);
      return detail ? !isAutoIndex(detail) : true;
    });
    if (notes.length === 0 && !existing) {
      return undefined;
    }
    const body = renderGeneratedIndex(folder, notes, existing);
    const frontmatter = {
      title: existing?.title ?? displayFolderTitle(folder),
      tags: existing?.tags ?? [folder],
      llm_access: notes.length > 0 && notes.every((note) => note.llm_access),
      auto_index: true
    };

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, noteToMarkdown(frontmatter, body), "utf8");
    return getNote(folder);
  }

  async function generateFolderIndexes(folders = DEFAULT_INDEX_FOLDERS) {
    const generated = [];
    for (const folder of folders) {
      const note = await generateFolderIndex({ folder });
      if (note) {
        generated.push(note.id);
      }
    }
    return { generated };
  }

  function exportedNoteFileName(id: string) {
    return `${encodeURIComponent(id).replace(/%/g, "~")}.json`;
  }

  async function exportPublicSite(): Promise<PublicExportResult> {
    await generateFolderIndexes();
    const { index, details } = await buildIndex();
    await fs.rm(exportDir, { recursive: true, force: true });
    await fs.mkdir(exportDir, { recursive: true });

    const dataDir = path.join(exportDir, "data");
    const notesDir = path.join(dataDir, "notes");
    await fs.mkdir(notesDir, { recursive: true });

    const result: PublicExportResult = { outputDir: exportDir, notes: [], media: [], warnings: [] };

    for (const note of index.notes) {
      const detail = details.get(note.id);
      if (!detail) {
        continue;
      }
      for (const target of note.brokenLinks) {
        result.warnings.push({ note: note.id, target, reason: "Target note cannot be resolved" });
      }
      for (const target of note.brokenMedia) {
        result.warnings.push({ note: note.id, target: target.source, reason: "Media file cannot be resolved" });
      }
      const frontmatter = { ...detail.frontmatter };
      for (const key of INTERNAL_EXPORT_KEYS) {
        delete frontmatter[key];
      }
      for (const key of IGNORED_FRONTMATTER_KEYS) {
        delete frontmatter[key];
      }
      const exportedDetail: NoteDetail = {
        ...detail,
        frontmatter
      };
      const noteDataPath = path.join(notesDir, exportedNoteFileName(note.id));
      await fs.writeFile(noteDataPath, `${JSON.stringify(exportedDetail, null, 2)}\n`, "utf8");
      for (const media of note.media.filter((item) => item.exists)) {
        const source = mediaVaultPath(detail, media.path);
        const mediaTarget = path.resolve(exportDir, source.vaultRelative);
        if (!mediaTarget.startsWith(exportDir + path.sep)) {
          throw new Error(`Media export path escapes export dir: ${media.path}`);
        }
        await fs.mkdir(path.dirname(mediaTarget), { recursive: true });
        await fs.copyFile(source.absolutePath, mediaTarget);
        result.media.push(source.vaultRelative);
      }
      result.notes.push(note.id);
    }

    await fs.writeFile(path.join(dataDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
    return result;
  }

  return {
    rootDir,
    vaultDir,
    exportDir,
    buildIndex: async () => (await buildIndex()).index,
    getNote,
    searchNotes,
    createNote,
    updateNote,
    resolveMediaFile,
    generateFolderIndex,
    generateFolderIndexes,
    exportPublicSite
  };
}
