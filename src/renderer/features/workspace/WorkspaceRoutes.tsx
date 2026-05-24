import { lazy, Suspense } from "react";
import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
import { usePreferencesStore } from "../../store/preferences";
import { useConnectionStore } from "../../store/connection";
import { useQueryStore } from "../../store/query";
import { useRedisStore } from "../../store/redis";
import { useSchemaStore } from "../../store/schema";
import { useStatusStore } from "../../store/status";

// Code-split every workspace route. Initial app boot only mounts WorkspaceHome
// (and even that lazily), so React's first commit doesn't have to parse + lay
// out CodeMirror, xterm, the migrations editor, etc. up front.
const ClusterWorkspace = lazy(() =>
  import("./ClusterWorkspace").then((m) => ({ default: m.ClusterWorkspace }))
);
const RedisWorkspace = lazy(() =>
  import("./redis/RedisWorkspace").then((m) => ({ default: m.RedisWorkspace }))
);
const SettingsPage = lazy(() =>
  import("./SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const TableWorkspace = lazy(() =>
  import("./TableWorkspace").then((m) => ({ default: m.TableWorkspace }))
);
const WorkspaceHome = lazy(() =>
  import("./WorkspaceHome").then((m) => ({ default: m.WorkspaceHome }))
);

/**
 * Top-level workspace router: chooses one of Settings / Redis / Table / Cluster /
 * Home based on current selection state. Lives outside App.tsx so the routing
 * decision is testable in isolation.
 */
export function WorkspaceRoutes({
  showSettings,
  onAddConnection,
  onOpenTable
}: {
  showSettings: boolean;
  onAddConnection: () => void;
  onOpenTable: (table: TableIdentity) => Promise<void>;
}) {
  const profiles = useConnectionStore((state) => state.profiles);
  const detectLocal = useConnectionStore((state) => state.detectLocal);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const busy = useStatusStore((state) => state.busy);
  const redisSelection = useRedisStore((state) => state.selection);
  const selectedTable = useSchemaStore((state) => state.selectedTable);
  const selectedProfileId = useSchemaStore((state) => state.selectedProfileId);
  const themePreference = usePreferencesStore((state) => state.themePreference);
  const setThemePreference = usePreferencesStore((state) => state.setThemePreference);
  const fontScale = usePreferencesStore((state) => state.fontScale);
  const setFontScale = usePreferencesStore((state) => state.setFontScale);
  const queryMode = usePreferencesStore((state) => state.queryMode);
  const setQueryMode = usePreferencesStore((state) => state.setQueryMode);
  const queryText = useQueryStore((state) => state.queryText);
  const queryResult = useQueryStore((state) => state.queryResult);
  const queryState = useQueryStore((state) => state.queryState);
  const setQueryText = useQueryStore((state) => state.setQueryText);
  const runQuery = useQueryStore((state) => state.runQuery);

  let content: React.ReactNode;
  if (showSettings) {
    content = (
      <SettingsPage
        connectionCount={profiles.length}
        onlineCount={profiles.filter((profile) => profile.connected).length}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
        fontScale={fontScale}
        onFontScaleChange={setFontScale}
        queryMode={queryMode}
        onQueryModeChange={setQueryMode}
      />
    );
  } else if (redisSelection) {
    content = <RedisWorkspace />;
  } else if (selectedTable) {
    content = <TableWorkspace />;
  } else {
    const cassandraCluster = findCassandraProfile(profiles, selectedProfileId);
    if (cassandraCluster) {
      content = (
        <ClusterWorkspace
          profile={cassandraCluster}
          queryText={queryText}
          queryResult={queryResult}
          queryLoading={queryState === "loading"}
          onQueryChange={setQueryText}
          onRun={runQuery}
        />
      );
    } else {
      content = (
        <WorkspaceHome
          profiles={profiles}
          busy={busy}
          onDetectLocal={detectLocal}
          onAddConnection={onAddConnection}
          onConnect={connect}
          onDisconnect={disconnect}
          onOpenTable={onOpenTable}
        />
      );
    }
  }

  return (
    <Suspense fallback={<RouteFallback />}>{content}</Suspense>
  );
}

function RouteFallback() {
  // Intentionally minimal — a flash of skeleton is worse than empty space for
  // a chunk that usually loads in <100 ms after the user's first interaction.
  return <div className="flex min-h-0 flex-1 items-center justify-center" />;
}

function findCassandraProfile(
  profiles: ProfileListItem[],
  profileId: string | undefined
): ProfileListItem | undefined {
  if (!profileId) return undefined;
  return profiles.find((profile) => profile.id === profileId && profile.type === "cassandra");
}
