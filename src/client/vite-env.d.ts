/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SECRET_WIKI_MODE?: "public";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
