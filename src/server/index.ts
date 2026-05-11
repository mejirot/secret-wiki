import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../shared/repoRoot.js";
import { createWikiStore } from "../wiki/store.js";
import type { CreateNoteInput, SearchFilters, UpdateNoteInput } from "../shared/types.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const store = createWikiStore({ rootDir: repoRoot });

app.use(express.json({ limit: "2mb" }));

function asyncRoute<T extends express.RequestHandler>(handler: T): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get(
  "/api/wiki",
  asyncRoute(async (_req, res) => {
    res.json(await store.buildIndex());
  })
);

app.get(
  "/api/note",
  asyncRoute(async (req, res) => {
    const id = String(req.query.id ?? "");
    const note = await store.getNote(id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  })
);

app.get(
  "/api/media",
  asyncRoute(async (req, res) => {
    const note = String(req.query.note ?? "");
    const mediaPath = String(req.query.path ?? "");
    const absolutePath = await store.resolveMediaFile(note, mediaPath);
    if (!absolutePath) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    res.sendFile(absolutePath);
  })
);

app.get(
  "/api/search",
  asyncRoute(async (req, res) => {
    const filters: SearchFilters = {
      query: typeof req.query.query === "string" ? req.query.query : undefined,
      folder: typeof req.query.folder === "string" ? req.query.folder : undefined,
      tags: typeof req.query.tags === "string" ? req.query.tags.split(",").filter(Boolean) : undefined
    };
    res.json(await store.searchNotes(filters));
  })
);

app.post(
  "/api/indexes/regenerate",
  asyncRoute(async (req, res) => {
    const folders = Array.isArray(req.body?.folders) ? req.body.folders.map(String) : undefined;
    res.json(await store.generateFolderIndexes(folders));
  })
);

app.post(
  "/api/notes",
  asyncRoute(async (req, res) => {
    const input = req.body as CreateNoteInput;
    const note = await store.createNote(input);
    res.status(201).json(note);
  })
);

app.patch(
  "/api/note",
  asyncRoute(async (req, res) => {
    const input = req.body as UpdateNoteInput;
    const note = await store.updateNote(input);
    res.json(note);
  })
);

app.post(
  "/api/export/public",
  asyncRoute(async (_req, res) => {
    res.json(await store.exportPublicSite());
  })
);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(dirname, "..", "client");
app.use(express.static(clientDir));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(400).json({ error: message });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Secret Wiki API listening on http://127.0.0.1:${port}`);
});
