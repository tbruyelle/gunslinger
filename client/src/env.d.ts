/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_REALM_PATH?: string;
  readonly VITE_POLL_MS?: string;
  readonly VITE_GAS_WANTED?: string;
  readonly VITE_GAS_FEE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
