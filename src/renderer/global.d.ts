import { CassandraDeskApi } from "../core/ipc";

declare global {
  interface Window {
    cassandraDesk: CassandraDeskApi;
  }
  const __APP_VERSION__: string;
}

export {};
