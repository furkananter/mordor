import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { RedisDbStat } from "../../../core/ipc";
import { RedisSelection } from "../../store/redis";

export function RedisDbList({
  profileId,
  profileName,
  connected,
  selected,
  onSelect
}: {
  profileId: string;
  profileName: string;
  connected: boolean;
  selected: RedisSelection | undefined;
  onSelect(selection: RedisSelection): void;
}) {
  const [stats, setStats] = useState<RedisDbStat[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!connected) {
      setStats([]);
      return;
    }
    void window.cassandraDesk
      .redisDbStats(profileId)
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch(() => {
        if (!cancelled) setStats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, profileId]);

  const visibleDbs = (() => {
    if (showAll) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const fromStats = stats.filter((entry) => entry.keys > 0).map((entry) => entry.index);
    const set = new Set<number>([0, ...fromStats]);
    if (selected?.profileId === profileId) set.add(selected.db);
    return [...set].sort((a, b) => a - b);
  })();

  const hiddenCount = 16 - visibleDbs.length;

  return (
    <>
      {visibleDbs.map((db) => {
        const active = selected?.profileId === profileId && selected.db === db;
        const stat = stats.find((entry) => entry.index === db);
        return (
          <li key={db}>
            <button
              type="button"
              onClick={() => onSelect({ profileId, profileName, db })}
              className={`flex w-full items-center gap-1.5 rounded-ui px-1.5 py-1 text-left text-[12px] ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-line-soft/60 hover:text-text"
              }`}
            >
              <Database size={11} strokeWidth={1.7} className="shrink-0" />
              <span className="flex-1">DB {db}</span>
              {stat && stat.keys > 0 ? (
                <span className="font-mono text-[10.5px] text-subtle">{stat.keys}</span>
              ) : null}
            </button>
          </li>
        );
      })}
      {!showAll && hiddenCount > 0 ? (
        <li>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex w-full items-center justify-between gap-1.5 rounded-ui px-1.5 py-1 text-left text-[11px] text-subtle hover:bg-line-soft/60 hover:text-muted"
          >
            <span>Show {hiddenCount} empty DBs</span>
          </button>
        </li>
      ) : null}
    </>
  );
}
