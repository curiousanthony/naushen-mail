/// <reference types="vite/client" />

/** Build-time values injected by electron-vite from `.env` (only `MAIN_VITE_*` reach the main bundle). */
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}
