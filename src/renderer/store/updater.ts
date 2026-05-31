import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { UpdateStatus } from "../../core/ipc";

interface UpdaterState {
  status: UpdateStatus;
  /**
   * Banner dismissals are version-keyed: dismissing v1.2.3 hides the banner
   * UNTIL v1.2.4 comes along. We don't suppress forever — a user closing the
   * banner once shouldn't lock them out of seeing the next release.
   *
   * Persisted to localStorage so a dismiss survives the next app launch;
   * otherwise a user who closed the banner gets it back on every cold start
   * until they actually install the update.
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

export const useUpdaterStore = create<UpdaterState & UpdaterActions>()(
  persist(
    (set, get) => ({
      status: { kind: "idle" },
      dismissedVersion: undefined,

      init: async () => {
        // Seed the snapshot synchronously so the first render doesn't flicker
        // through "idle" when an update is already pending (e.g. user
        // installed the app, restarted, second app start finds the same
        // downloaded build). Guard against `undefined` because tests stub the
        // IPC method with a no-arg `vi.fn()` that resolves to undefined —
        // we'd otherwise blow away the default `{ kind: "idle" }` and crash
        // on next read of `status.kind`.
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
        // Prefer the version on the current status; fall back to a sentinel
        // so the UI hides the banner even when the kind has no version
        // attached. The next status push that DOES carry a version will
        // overwrite the sentinel via the init() handler above.
        const version = get().status.version ?? "__dismissed__";
        set({ dismissedVersion: version });
      },

      checkNow: async () => {
        await window.cassandraDesk.checkForUpdates();
      },

      installNow: async () => {
        await window.cassandraDesk.installUpdate();
      }
    }),
    {
      name: "mordor-updater",
      storage: createJSONStorage(() => localStorage),
      // Only the dismissal is worth surviving a relaunch — the live status
      // is re-fetched from main on init(), so persisting it would just
      // create a stale flash on the next launch.
      partialize: (state) => ({ dismissedVersion: state.dismissedVersion })
    }
  )
);
