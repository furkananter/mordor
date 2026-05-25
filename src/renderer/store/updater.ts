import { create } from "zustand";
import { UpdateStatus } from "../../core/ipc";

interface UpdaterState {
  status: UpdateStatus;
  /**
   * Banner dismissals are version-keyed: dismissing v1.2.3 hides the banner
   * UNTIL v1.2.4 comes along. We don't suppress forever — a user closing the
   * banner once shouldn't lock them out of seeing the next release.
   */
  dismissedVersion: string | undefined;
}

interface UpdaterActions {
  init(): Promise<void>;
  setStatus(status: UpdateStatus): void;
  dismissBanner(): void;
  checkNow(): Promise<void>;
  installNow(): Promise<void>;
}

export const useUpdaterStore = create<UpdaterState & UpdaterActions>(
  (set, get) => ({
    status: { kind: "idle" },
    dismissedVersion: undefined,

    init: async () => {
      // Seed the snapshot synchronously so the first render doesn't flicker
      // through "idle" when an update is already pending (e.g. user installed
      // the app, restarted, second app start finds the same downloaded build).
      // Guard against `undefined` because tests stub the IPC method with a
      // no-arg `vi.fn()` that resolves to undefined — we'd otherwise blow
      // away the default `{ kind: "idle" }` and crash on next read of
      // `status.kind`.
      const initial = await window.cassandraDesk.getUpdateStatus();
      if (initial) set({ status: initial });
      // Subscribe to subsequent pushes from main.
      window.cassandraDesk.onUpdateStatus((next) => {
        if (!next) return;
        // When a NEW version arrives, clear any prior dismissal so the
        // banner reappears for the new release.
        const prev = get().dismissedVersion;
        if (prev && next.version && prev !== next.version) {
          set({ status: next, dismissedVersion: undefined });
        } else {
          set({ status: next });
        }
      });
    },

    setStatus: (status) => set({ status }),

    dismissBanner: () => {
      const version = get().status.version;
      if (version) set({ dismissedVersion: version });
    },

    checkNow: async () => {
      await window.cassandraDesk.checkForUpdates();
    },

    installNow: async () => {
      await window.cassandraDesk.installUpdate();
    }
  })
);
