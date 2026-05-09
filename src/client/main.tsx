import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import {
  BookOpen,
  Image,
  Folder,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Link2,
  Lock,
  RefreshCcw,
  Search,
  Send,
  Shield,
  Sparkles,
  Tag
} from "lucide-react";
import type { NoteDetail, NoteMedia, NoteSummary, WikiIndex } from "../shared/types.js";
import "./styles.css";

type DataMode = "local" | "public";
const forcedPublicMode = import.meta.env.VITE_SECRET_WIKI_MODE === "public";

const emptyIndex: WikiIndex = { notes: [], tags: [], folders: [], brokenLinks: [], mediaWarnings: [] };
const internalMarkerPattern = /<!--\s*secret-wiki:auto-index\s*-->/g;

type FolderTreeNode = {
  path: string;
  label: string;
  count: number;
  ownCount: number;
  children: FolderTreeNode[];
};

function buildFolderTree(folders: WikiIndex["folders"]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];

  function ensureNode(folderPath: string) {
    const normalized = folderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const pathParts = normalized ? normalized.split("/").filter(Boolean) : [];
    const nodePath = pathParts.join("/");
    const label = pathParts.at(-1) || "root";
    const existing = nodes.get(nodePath);
    if (existing) {
      return existing;
    }

    const node: FolderTreeNode = {
      path: nodePath,
      label,
      count: 0,
      ownCount: 0,
      children: []
    };
    nodes.set(nodePath, node);

    if (pathParts.length <= 1) {
      roots.push(node);
    } else {
      const parentPath = pathParts.slice(0, -1).join("/");
      ensureNode(parentPath).children.push(node);
    }

    return node;
  }

  for (const folder of folders) {
    const node = ensureNode(folder.path);
    node.ownCount = folder.count;
  }

  const sortNodes = (items: FolderTreeNode[]) => {
    items.sort((a, b) => a.label.localeCompare(b.label, "ja"));
    for (const item of items) {
      sortNodes(item.children);
      item.count = item.ownCount || item.children.reduce((total, child) => total + child.count, 0);
    }
  };
  sortNodes(roots);

  return roots;
}

function ancestorFolders(folderPath: string) {
  const parts = folderPath.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/"));
}

function youtubeEmbedUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    let videoId = "";

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (kind === "watch") {
        videoId = url.searchParams.get("v") ?? "";
      } else if (kind === "shorts" || kind === "embed") {
        videoId = id ?? "";
      }
    }

    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      return undefined;
    }

    return `https://www.youtube-nocookie.com/embed/${videoId}`;
  } catch {
    return undefined;
  }
}

function singleChildYoutubeEmbed(children: React.ReactNode) {
  const nodes = React.Children.toArray(children).filter((child) => {
    return typeof child !== "string" || child.trim().length > 0;
  });

  if (nodes.length !== 1) {
    return undefined;
  }

  const [child] = nodes;
  if (typeof child === "string") {
    return youtubeEmbedUrl(child);
  }

  if (!React.isValidElement(child)) {
    return undefined;
  }

  const props = child.props as { href?: unknown };
  return typeof props.href === "string" ? youtubeEmbedUrl(props.href) : undefined;
}

function normalizeWikiTarget(target: string) {
  return target.trim().split("#")[0].replace(/\\/g, "/").replace(/\.md$/i, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizePathSegments(pathValue: string) {
  const parts: string[] = [];
  for (const part of pathValue.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function resolveWikiLink(target: string, notes: NoteSummary[], fromId?: string) {
  const normalized = normalizeWikiTarget(target);
  const exact = notes.find((note) => note.id === normalized);
  if (exact) {
    return exact.id;
  }
  if (fromId && !target.startsWith("/")) {
    const parent = fromId.split("/").slice(0, -1).join("/");
    const relative = normalizePathSegments([parent, normalized].filter(Boolean).join("/"));
    const relativeMatch = notes.find((note) => note.id === relative);
    if (relativeMatch) {
      return relativeMatch.id;
    }
  }
  const basenameMatches = notes.filter((note) => note.id.split("/").at(-1) === normalized);
  return basenameMatches.length === 1 ? basenameMatches[0].id : undefined;
}

function renderWikiLinks(body: string, notes: NoteSummary[], fromId?: string) {
  const withWikiLinks = body.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
    const resolved = resolveWikiLink(target, notes, fromId);
    const text = label || target;
    return resolved ? `[${text}](${notePath(resolved)})` : `${text}`;
  });

  return withWikiLinks.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (match, label: string, target: string) => {
    if (/^(https?:|mailto:|#|data:)/i.test(target)) {
      return match;
    }
    const resolved = resolveWikiLink(target, notes, fromId);
    return resolved ? `[${label}](${notePath(resolved)})` : match;
  });
}

function notePath(id: string) {
  return `/note/${id.split("/").map(encodeURIComponent).join("/")}`;
}

function noteIdFromPathname(pathname = window.location.pathname) {
  const [root, ...parts] = pathname.split("/").filter(Boolean);
  if (root !== "note" || parts.length === 0) {
    return undefined;
  }
  try {
    return parts.map(decodeURIComponent).join("/");
  } catch {
    return undefined;
  }
}

function replaceBrowserNote(id: string) {
  const nextPath = notePath(id);
  if (window.location.pathname !== nextPath) {
    window.history.replaceState(null, "", nextPath);
  }
}

function pushBrowserNote(id: string) {
  const nextPath = notePath(id);
  if (window.location.pathname !== nextPath) {
    window.history.pushState(null, "", nextPath);
  }
}

function noteShareUrl(id: string) {
  return `${window.location.origin}${notePath(id)}`;
}

function blueskyShareUrl(note: Pick<NoteDetail, "id" | "title">) {
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(`${note.title}\n${noteShareUrl(note.id)}`)}`;
}

function renderMediaLinks(body: string, note: NoteDetail) {
  return body.replace(/(!\[[^\]]*\]\()([^\s)]+)((?:\s+"[^"]*")?\))/g, (_match, prefix: string, source: string, suffix: string) => {
    const media = note.media.find((item) => item.source === source || item.path === source);
    return media?.url ? `${prefix}${media.url}${suffix}` : `${prefix}${source}${suffix}`;
  });
}

function coverUrl(note: NoteSummary) {
  if (!note.cover) {
    return undefined;
  }
  return note.media.find((item) => item.source === note.cover || item.path === note.cover)?.url;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON from ${url}`);
  }
  return (await response.json()) as T;
}

function noteDataFile(id: string) {
  return `/data/notes/${encodeURIComponent(id).replace(/%/g, "~")}.json`;
}

function encodePublicPath(path: string) {
  return `/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function mediaVaultPath(note: Pick<NoteSummary, "path">, mediaPath: string) {
  const notePath = note.path.replace(/\\/g, "/");
  const base = notePath.endsWith("/index.md")
    ? notePath.slice(0, -"/index.md".length)
    : notePath.includes("/")
      ? notePath.split("/").slice(0, -1).join("/")
      : "";
  return [base, mediaPath].filter(Boolean).join("/");
}

function publicMedia(note: NoteSummary, media: NoteMedia): NoteMedia {
  return media.exists ? { ...media, url: encodePublicPath(mediaVaultPath(note, media.path)) } : { ...media, url: "" };
}

function hydratePublicNote<T extends NoteSummary | NoteDetail>(note: T): T {
  return {
    ...note,
    media: note.media.map((media) => publicMedia(note, media)),
    brokenMedia: note.brokenMedia.map((media) => publicMedia(note, media))
  };
}

async function loadWikiIndex(): Promise<{ index: WikiIndex; mode: DataMode }> {
  if (forcedPublicMode) {
    const index = await fetchJson<WikiIndex>("/data/index.json");
    return {
      index: {
        ...index,
        notes: index.notes.map(hydratePublicNote)
      },
      mode: "public"
    };
  }

  try {
    return { index: await fetchJson<WikiIndex>("/api/wiki"), mode: "local" };
  } catch {
    const index = await fetchJson<WikiIndex>("/data/index.json");
    return {
      index: {
        ...index,
        notes: index.notes.map(hydratePublicNote)
      },
      mode: "public"
    };
  }
}

async function loadWikiNote(id: string, mode: DataMode) {
  if (mode === "public") {
    return hydratePublicNote(await fetchJson<NoteDetail>(noteDataFile(id)));
  }
  return fetchJson<NoteDetail>(`/api/note?id=${encodeURIComponent(id)}`);
}

function App() {
  const [index, setIndex] = useState<WikiIndex>(emptyIndex);
  const [selectedId, setSelectedId] = useState<string>(() => noteIdFromPathname() ?? "");
  const [selected, setSelected] = useState<NoteDetail | null>(null);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("");
  const [activeFolder, setActiveFolder] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [dataMode, setDataMode] = useState<DataMode>(forcedPublicMode ? "public" : "local");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function loadIndex(preferredId?: string) {
    const { index: nextIndex, mode } = await loadWikiIndex();
    setDataMode(mode);
    setIndex(nextIndex);
    const routeId = noteIdFromPathname();
    const requestedId = preferredId || routeId || selectedId;
    const nextId = requestedId && nextIndex.notes.some((note) => note.id === requestedId) ? requestedId : nextIndex.notes[0]?.id || "";
    setSelectedId(nextId);
    if (nextId) {
      replaceBrowserNote(nextId);
    }
  }

  function selectNote(id: string, options: { replace?: boolean } = {}) {
    setSelectedId(id);
    if (options.replace) {
      replaceBrowserNote(id);
    } else {
      pushBrowserNote(id);
    }
  }

  async function refreshGeneratedIndexes() {
    await fetch("/api/indexes/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    await loadIndex();
  }

  useEffect(() => {
    let cancelled = false;
    async function loadWithRetry(remaining = 5) {
      try {
        await loadIndex();
      } catch (error) {
        if (!cancelled && remaining > 0) {
          window.setTimeout(() => void loadWithRetry(remaining - 1), 700);
        }
      }
    }
    void loadWithRetry();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function syncFromHistory() {
      const routeId = noteIdFromPathname();
      if (!routeId) {
        const fallbackId = index.notes[0]?.id;
        if (fallbackId) {
          selectNote(fallbackId, { replace: true });
        }
        return;
      }
      if (index.notes.some((note) => note.id === routeId)) {
        setSelectedId(routeId);
        return;
      }
      const fallbackId = index.notes[0]?.id;
      if (fallbackId) {
        selectNote(fallbackId, { replace: true });
      }
    }

    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, [index.notes]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    loadWikiNote(selectedId, dataMode)
      .then((note: NoteDetail) => {
        setSelected(note);
      })
      .catch(() => {
        setSelected(null);
      });
  }, [dataMode, selectedId]);

  useEffect(() => {
    setCopyStatus("idle");
  }, [selectedId]);

  useEffect(() => {
    document.title = selected ? `${selected.title} | Wiki` : "Wiki";
  }, [selected]);

  useEffect(() => {
    const ancestors = ancestorFolders(activeFolder);
    if (ancestors.length === 0) {
      return;
    }
    setExpandedFolders((current) => {
      let changed = false;
      const next = new Set(current);
      for (const ancestor of ancestors) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeFolder]);

  const filteredNotes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return index.notes.filter((note) => {
      if (activeTag && !note.tags.includes(activeTag)) {
        return false;
      }
      if (activeFolder && note.folder !== activeFolder && !note.id.startsWith(`${activeFolder}/`)) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [note.title, note.id, note.excerpt, note.tags.join(" ")].join("\n").toLowerCase().includes(needle);
    });
  }, [activeFolder, activeTag, index.notes, query]);

  const notesById = useMemo(() => new Map(index.notes.map((note) => [note.id, note])), [index.notes]);
  const folderTree = useMemo(() => buildFolderTree(index.folders), [index.folders]);

  const visibleBody = selected ? renderMediaLinks(renderWikiLinks(selected.body.replace(internalMarkerPattern, ""), index.notes, selected.id), selected) : "";

  function selectFolder(node: FolderTreeNode) {
    setActiveFolder(node.path);
    if (node.children.length === 0) {
      return;
    }
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
      }
      return next;
    });
  }

  function renderFolderNode(node: FolderTreeNode, depth = 0): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedFolders.has(node.path);
    const folderClassName = [
      "filter",
      "folderFilter",
      hasChildren ? "folderBranch" : "folderLeaf",
      node.path && activeFolder === node.path ? "active" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <React.Fragment key={node.path || "root"}>
        <button
          className={folderClassName}
          style={{ "--folder-depth": depth } as React.CSSProperties}
          onClick={() => selectFolder(node)}
          aria-expanded={hasChildren ? isExpanded : undefined}
        >
          <span className="folderLabel">
            {hasChildren && <span className="folderToggle">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>}
            <span className="folderName" title={node.path || "root"}>
              {node.label}
            </span>
          </span>
          <em>{node.count}</em>
        </button>
        {hasChildren && isExpanded ? node.children.map((child) => renderFolderNode(child, depth + 1)) : null}
      </React.Fragment>
    );
  }

  async function copyCurrentNoteLink() {
    if (!selected) {
      return;
    }
    try {
      await navigator.clipboard.writeText(noteShareUrl(selected.id));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen size={22} />
          <div>
            <strong>Wiki</strong>
            <span>{dataMode === "public" ? "Public site" : `${index.notes.length} notes`}</span>
          </div>
        </div>

        <label className="searchBox">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" />
        </label>

        <div className="navBlock">
          <div className="blockTitle">
            <Folder size={14} />
            Folders
          </div>
          <button className={!activeFolder ? "filter active" : "filter"} onClick={() => setActiveFolder("")}>
            All folders
          </button>
          {folderTree.map((folder) => renderFolderNode(folder))}
        </div>

        <div className="navBlock">
          <div className="blockTitle">
            <Tag size={14} />
            Tags
          </div>
          <button className={!activeTag ? "filter active" : "filter"} onClick={() => setActiveTag("")}>
            All tags
          </button>
          {index.tags.map((tag) => (
            <button key={tag.name} className={activeTag === tag.name ? "filter active" : "filter"} onClick={() => setActiveTag(tag.name)}>
              <span>#{tag.name}</span>
              <em>{tag.count}</em>
            </button>
          ))}
        </div>
      </aside>

      <section className="listPane">
        <div className="paneHeader">
          <span>{filteredNotes.length} results</span>
          {dataMode === "local" && (
            <button className="iconOnly" title="Refresh indexes" onClick={() => void refreshGeneratedIndexes()}>
              <RefreshCcw size={16} />
            </button>
          )}
        </div>
        <div className="noteList">
          {filteredNotes.map((note) => (
            <button key={note.id} className={selectedId === note.id ? "noteRow active" : "noteRow"} onClick={() => selectNote(note.id)}>
              {coverUrl(note) && <img className="noteCover" src={coverUrl(note)} alt="" />}
              <span className="noteTitle">{note.title}</span>
              <span className="notePath">{note.path}</span>
              <span className="noteExcerpt">{note.excerpt || "No body text"}</span>
              {dataMode === "local" && (
                <span className="chips">
                  {note.llm_access ? (
                    <span className="chip good">
                      <Sparkles size={12} /> LLM
                    </span>
                  ) : (
                    <span className="chip muted">
                      <Lock size={12} /> private
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <main className="readerPane">
        {selected ? (
          <>
            <div className="readerHeader">
              <div>
                <span className="kicker">{selected.folder || "root"}</span>
                <h1>{selected.title}</h1>
              </div>
            </div>

            <article className={selected.tags.includes("レシピ") ? "markdown recipeMarkdown" : "markdown"}>
              <ReactMarkdown
                components={{
                  p: ({ children }) => {
                    const embedUrl = singleChildYoutubeEmbed(children);
                    if (embedUrl) {
                      return (
                        <figure className="youtubeEmbed">
                          <iframe
                            src={embedUrl}
                            title="YouTube video player"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            loading="lazy"
                          />
                        </figure>
                      );
                    }
                    return <p>{children}</p>;
                  },
                  a: ({ href, children }) => {
                    if (href?.startsWith("/note/")) {
                      const target = noteIdFromPathname(href);
                      return (
                        <button className="inlineLink" onClick={() => target && selectNote(target)}>
                          {children}
                        </button>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    );
                  },
                  img: ({ src, alt }) => <img src={src ?? ""} alt={alt ?? ""} loading="lazy" />
                }}
              >
                {visibleBody}
              </ReactMarkdown>
              <footer className="shareFooter">
                <div>
                  <strong>Share this note</strong>
                  <span>{noteShareUrl(selected.id)}</span>
                </div>
                <div className="shareActions">
                  <button className="shareButton" onClick={() => void copyCurrentNoteLink()}>
                    {copyStatus === "copied" ? <Check size={15} /> : <Copy size={15} />}
                    {copyStatus === "copied" ? "Copied" : "Copy link"}
                  </button>
                  <a className="shareButton" href={blueskyShareUrl(selected)} target="_blank" rel="noreferrer">
                    <Send size={15} />
                    Bluesky
                  </a>
                </div>
                {copyStatus === "failed" && <p className="shareStatus">Could not copy. Use the URL above.</p>}
              </footer>
            </article>
          </>
        ) : (
          <div className="emptyState">{dataMode === "public" ? "No public note selected." : "Create a note in the vault to start."}</div>
        )}
      </main>

      <aside className="inspector">
        {selected ? (
          <>
            <section>
              <h2>Access</h2>
              <div className="accessGrid">
                {dataMode === "local" ? (
                  <span className={selected.llm_access ? "access on" : "access"}>
                    <Sparkles size={15} />
                    LLM {selected.llm_access ? "allowed" : "blocked"}
                  </span>
                ) : (
                  <span className="access on">
                    <Shield size={15} />
                    Read-only public site
                  </span>
                )}
              </div>
            </section>

            <section>
              <h2>Links</h2>
              <LinkList title="Outgoing" ids={selected.outgoing} notesById={notesById} onSelect={selectNote} />
              <LinkList title="Backlinks" ids={selected.backlinks} notesById={notesById} onSelect={selectNote} />
              {selected.brokenLinks.length > 0 && (
                <div className="linkGroup broken">
                  <strong>Broken</strong>
                  {selected.brokenLinks.map((link) => (
                    <span key={link}>{link}</span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2>Media</h2>
              <div className="mediaGroup">
                {selected.media.length === 0 ? (
                  <span>No media</span>
                ) : (
                  selected.media.map((media) => (
                    <span key={media.source} className={media.exists ? "mediaItem" : "mediaItem missing"}>
                      <Image size={13} />
                      {media.source}
                    </span>
                  ))
                )}
              </div>
            </section>

            <section>
              <h2>Tags</h2>
              <div className="tagWrap">
                {selected.tags.length > 0 ? selected.tags.map((tag) => <button key={tag} onClick={() => setActiveTag(tag)}>#{tag}</button>) : <span>No tags</span>}
              </div>
            </section>
          </>
        ) : (
          <section className="emptyInspector">
            <Shield size={20} />
            No note selected
          </section>
        )}
      </aside>
    </div>
  );
}

function LinkList({
  title,
  ids,
  notesById,
  onSelect
}: {
  title: string;
  ids: string[];
  notesById: Map<string, NoteSummary>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="linkGroup">
      <strong>{title}</strong>
      {ids.length === 0 ? (
        <span>None</span>
      ) : (
        ids.map((id) => (
          <button key={id} onClick={() => onSelect(id)}>
            <Link2 size={13} />
            {notesById.get(id)?.title ?? id}
          </button>
        ))
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
  });
}
