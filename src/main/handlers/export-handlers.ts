/**
 * IPC handlers for the database-export feature.
 *
 * Two channels:
 *
 *   - `export:pick-folder` — wraps `dialog.showOpenDialog` with
 *      `openDirectory + createDirectory`, returning the absolute path or
 *      `undefined` on cancel.
 *
 *   - `export:run` — runs the actual export. Dispatches on `profile.type`
 *      and `request.scope`; rejects loudly when the scope can't be honored
 *      (missing target for table/schema). Returns the engine-produced
 *      `ExportResult` (folder path + artifact list + warnings).
 *
 * The handler does not stream progress — v1 is a single round-trip. Live
 * progress would need a renderer-side listener subscribed to a separate
 * pushed channel; queued for a follow-up once the basic flow ships.
 */

import { BrowserWindow, dialog, shell } from "electron";
import { CassandraService } from "../../core/cassandra/CassandraService";
import { PostgresService } from "../../core/postgres/PostgresService";
import { ConnectionProfile } from "../../core/config/profile";
import { ExportRequest, ExportResult } from "../../core/export/types";
import { ipcChannels } from "../../core/ipc";
import { ProfileStore } from "../ProfileStore";
import { RedisAdapter } from "../adapters/RedisAdapter";

export function createExportHandlers(
  store: ProfileStore,
  cassandra: CassandraService,
  postgres: PostgresService,
  redis: RedisAdapter,
) {
  const requireProfile = async (profileId: string): Promise<ConnectionProfile> => {
    const profile = await store.get(profileId);
    if (!profile) throw new Error(`Profile ${profileId} not found.`);
    return profile;
  };

  return {
    [ipcChannels.pickExportFolder]: async (): Promise<string | undefined> => {
      // Honor the focused window when available so the dialog appears as a
      // sheet attached to it on macOS — matches the migrations folder picker.
      const focused = BrowserWindow.getFocusedWindow();
      // Electron's `OpenDialogOptions.properties` expects a mutable string
      // array, so we let the literals widen rather than freezing with
      // `as const` (which gives a readonly tuple and trips tsc).
      const opts: Electron.OpenDialogOptions = {
        title: "Pick export folder",
        // `openDirectory + createDirectory` lets the user navigate to a parent
        // folder and create a fresh subfolder on the fly, which is the most
        // common workflow ("Mordor Exports/2026-06-07/").
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: "Select folder",
      };
      const result = focused
        ? await dialog.showOpenDialog(focused, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return undefined;
      return result.filePaths[0];
    },

    [ipcChannels.exportDatabase]: async (
      request: ExportRequest,
    ): Promise<ExportResult> => {
      if (!request.outputDir) {
        throw new Error("Export failed: no output folder was supplied.");
      }
      const profile = await requireProfile(request.profileId);

      if (profile.type === "cassandra") {
        if (request.scope === "table") {
          if (!request.table) throw new Error("Export failed: table scope requires a target table.");
          return cassandra.exportTable(
            profile.id,
            request.table.keyspace,
            request.table.table,
            request.outputDir,
          );
        }
        if (request.scope === "schema") {
          if (!request.schema) throw new Error("Export failed: schema scope requires a keyspace.");
          return cassandra.exportKeyspace(profile.id, request.schema.keyspace, request.outputDir);
        }
        return cassandra.exportAll(profile.id, request.outputDir);
      }

      if (profile.type === "postgres") {
        if (request.scope === "table") {
          if (!request.table) throw new Error("Export failed: table scope requires a target table.");
          return postgres.exportTable(
            profile.id,
            request.table.keyspace,
            request.table.table,
            request.outputDir,
          );
        }
        if (request.scope === "schema") {
          if (!request.schema) throw new Error("Export failed: schema scope requires a schema name.");
          return postgres.exportSchema(profile.id, request.schema.keyspace, request.outputDir);
        }
        return postgres.exportAll(profile.id, request.outputDir);
      }

      if (profile.type === "redis") {
        // Redis defaults to the profile's saved db when the caller doesn't
        // override it. The adapter's exportXxx methods then re-select that
        // db on the underlying ioredis client before SCAN.
        const db = request.redisDb ?? profile.db;
        if (request.scope === "table") {
          // For Redis, table.table is the single key name (table.keyspace is
          // unused — there's no schema concept).
          if (!request.table) throw new Error("Export failed: key scope requires a key name.");
          return redis.exportKey(profile.id, profile.name, db, request.table.table, request.outputDir);
        }
        if (request.scope === "schema") {
          // Reuse the same field to carry the SCAN MATCH pattern, e.g. "user:*".
          if (!request.schema) throw new Error("Export failed: pattern scope requires a SCAN MATCH pattern.");
          return redis.exportPattern(
            profile.id,
            profile.name,
            db,
            request.schema.keyspace,
            request.outputDir,
          );
        }
        return redis.exportAll(profile.id, profile.name, db, request.outputDir);
      }

      // Exhaustiveness — forces a compile error when a new ProfileType lands
      // without an export branch. The runtime throw is a safety net.
      const _exhaustive: never = profile;
      throw new Error(`exportDatabase: unsupported profile type ${(_exhaustive as ConnectionProfile).type}`);
    },

    [ipcChannels.openFolder]: async (path: string): Promise<void> => {
      if (!path) throw new Error("openFolder requires a non-empty path.");
      // `openPath` returns an error message string on failure (resolves
      // normally even when the path is missing). We re-throw so the renderer
      // surfaces a real error instead of silently swallowing it.
      const errorMessage = await shell.openPath(path);
      if (errorMessage) {
        throw new Error(`Could not open ${path}: ${errorMessage}`);
      }
    },
  };
}
