import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createWikiStore } from "../wiki/store.js";

const store = createWikiStore();
const server = new McpServer({
  name: "secret-wiki",
  version: "0.1.0"
});

function asText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

server.tool(
  "search_notes",
  "Search notes that explicitly allow LLM access.",
  {
    query: z.string().optional(),
    tags: z.array(z.string()).optional(),
    folder: z.string().optional()
  },
  async ({ query, tags, folder }) => {
    const notes = await store.searchNotes({ query, tags, folder }, true);
    return asText(
      notes.map((note) => ({
        id: note.id,
        title: note.title,
        tags: note.tags,
        folder: note.folder,
        excerpt: note.excerpt,
        backlinks: note.backlinks,
        outgoing: note.outgoing
      }))
    );
  }
);

server.tool(
  "get_note",
  "Get a note by id only when llm_access is true.",
  {
    id: z.string()
  },
  async ({ id }) => {
    const note = await store.getNote(id, true);
    if (!note) {
      return asText({ error: "Note not found or not available to LLM" });
    }
    return asText(note);
  }
);

server.tool(
  "create_note",
  "Create a Markdown note. LLM access defaults to false.",
  {
    path: z.string(),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()).optional(),
    llm_access: z.boolean().optional()
  },
  async (input) => {
    const note = await store.createNote({
      path: input.path,
      title: input.title,
      body: input.body,
      tags: input.tags,
      llm_access: input.llm_access === true
    });
    return asText(note);
  }
);

server.tool(
  "update_note",
  "Update an existing note.",
  {
    id: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
    tags: z.array(z.string()).optional(),
    llm_access: z.boolean().optional()
  },
  async (input) => {
    const note = await store.updateNote(input);
    return asText(note);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
