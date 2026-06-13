/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional relayer URL override; defaults differ between development and production. */
  readonly VITE_RELAYER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Short git commit hash injected at build time (see vite.config.ts). */
declare const __GIT_COMMIT__: string;
