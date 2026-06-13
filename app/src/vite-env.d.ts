/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the AccountabiliBuddy relayer (default http://localhost:8787). */
  readonly VITE_RELAYER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
