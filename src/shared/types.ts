export type NoteAccess = {
  llm_access: boolean;
};

export type NoteMedia = {
  source: string;
  path: string;
  url: string;
  exists: boolean;
};

export type ExternalLink = {
  label: string;
  url: string;
};

export type NoteSummary = NoteAccess & {
  id: string;
  path: string;
  title: string;
  tags: string[];
  folder: string;
  cover?: string;
  media: NoteMedia[];
  brokenMedia: NoteMedia[];
  excerpt: string;
  updatedAt: string;
  outgoing: string[];
  backlinks: string[];
  brokenLinks: string[];
  externalLinks: ExternalLink[];
};

export type NoteDetail = NoteSummary & {
  body: string;
  frontmatter: Record<string, unknown>;
};

export type WikiIndex = {
  notes: NoteSummary[];
  tags: Array<{ name: string; count: number }>;
  folders: Array<{ path: string; count: number }>;
  brokenLinks: Array<{ from: string; target: string }>;
  mediaWarnings: Array<{ note: string; target: string; reason: string }>;
};

export type SearchFilters = {
  query?: string;
  tags?: string[];
  folder?: string;
};

export type UpdateNoteInput = {
  id: string;
  title?: string;
  tags?: string[];
  llm_access?: boolean;
  body?: string;
};

export type CreateNoteInput = {
  path: string;
  title: string;
  body: string;
  tags?: string[];
  llm_access?: boolean;
};

export type PublicExportResult = {
  outputDir: string;
  notes: string[];
  standardSiteNotes: string[];
  media: string[];
  warnings: Array<{ note: string; target: string; reason: string }>;
};
