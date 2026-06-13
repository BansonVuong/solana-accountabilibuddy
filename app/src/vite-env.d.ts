/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the AccountabiliBuddy relayer (default https://66.42.115.38). */
  readonly VITE_RELAYER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
