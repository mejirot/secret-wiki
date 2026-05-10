/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SECRET_WIKI_MODE?: "public";
  readonly VITE_PLANTUML_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
