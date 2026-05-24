import { useEffect } from "react";
import { useRedisStore } from "../../../store/redis";
import { RedisKeyBrowser } from "./RedisKeyBrowser";
import { RedisKeyViewer } from "./RedisKeyViewer";
import { RedisCommandPalette } from "./RedisCommandPalette";

export function RedisWorkspace() {
  const selection = useRedisStore((state) => state.selection);
  const selectedKey = useRedisStore((state) => state.selectedKey);
  const refreshDbStats = useRedisStore((state) => state.refreshDbStats);

  useEffect(() => {
    void refreshDbStats();
  }, [selection?.profileId, refreshDbStats]);

  if (!selection) return null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,360px)_minmax(0,1fr)] bg-panel">
      <RedisKeyBrowser />
      <div className="flex min-h-0 flex-col overflow-hidden border-l border-line-soft">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {selectedKey ? <RedisKeyViewer /> : <EmptyKeyPane />}
        </div>
        <RedisCommandPalette />
      </div>
    </div>
  );
}

function EmptyKeyPane() {
  return (
    <div className="grid flex-1 place-items-center text-[12px] text-muted">
      <div className="grid gap-1 text-center">
        <strong className="text-text">Select a key</strong>
        <span>Pick a key from the list to inspect or edit it.</span>
      </div>
    </div>
  );
}
