import { useEffect, useState } from "react";
import { ChevronDown, Database, Filter, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../../components/ui/DropdownMenu";
import { useRedisStore } from "../../../store/redis";

const TYPE_COLORS: Record<string, string> = {
  string: "text-accent",
  list: "text-warning",
  set: "text-success",
  zset: "text-success",
  hash: "text-text",
  stream: "text-danger",
  none: "text-subtle"
};

export function RedisKeyBrowser() {
  const selection = useRedisStore((state) => state.selection);
  const dbStats = useRedisStore((state) => state.dbStats);
  const pattern = useRedisStore((state) => state.pattern);
  const keys = useRedisStore((state) => state.keys);
  const loading = useRedisStore((state) => state.loading);
  const reachedEnd = useRedisStore((state) => state.reachedEnd);
  const selectedKey = useRedisStore((state) => state.selectedKey);
  const setPattern = useRedisStore((state) => state.setPattern);
  const reload = useRedisStore((state) => state.reload);
  const nextPage = useRedisStore((state) => state.nextPage);
  const selectKey = useRedisStore((state) => state.selectKey);
  const openDb = useRedisStore((state) => state.openDb);

  const [draftPattern, setDraftPattern] = useState(pattern);

  useEffect(() => {
    setDraftPattern(pattern);
  }, [pattern]);

  // openDb already kicks off a reload when the user picks a DB from the sidebar,
  // so we do NOT trigger another reload here on every selection mutation —
  // doing so would race the openDb scan and append duplicate keys.
  // The only case this effect needs to handle is the very first mount when the
  // selection was restored without going through openDb.
  useEffect(() => {
    if (selection && useRedisStore.getState().keys.length === 0) void reload();
    // Intentionally exclude `reload` and the full `selection` object; only react
    // to identity changes of the primitive fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.db, selection?.profileId]);

  if (!selection) return null;

  const submitFilter = (event?: React.FormEvent) => {
    event?.preventDefault();
    setPattern(draftPattern);
    void reload();
  };

  return (
    <aside className="flex min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-[12px] font-medium text-text">{selection.profileName}</span>
          <DbSwitcher
            currentDb={selection.db}
            stats={dbStats}
            onSelect={(db) => void openDb({ ...selection, db })}
          />
        </div>
        <Button variant="icon" onClick={() => void reload()} tooltip="Refresh">
          <RefreshCw size={12} strokeWidth={1.7} className={loading ? "animate-spin" : ""} />
        </Button>
      </header>

      <form className="border-b border-line-soft px-3 py-2" onSubmit={submitFilter}>
        <label className="grid gap-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-subtle">
          Pattern
          <div className="flex items-center gap-1">
            <Input
              value={draftPattern}
              onChange={(event) => setDraftPattern(event.target.value)}
              placeholder="* or user:*"
            />
            <Button variant="icon" type="submit" tooltip="Apply filter">
              <Filter size={12} strokeWidth={1.7} />
            </Button>
          </div>
        </label>
      </form>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {keys.length === 0 && !loading ? (
          <li className="px-3 py-4 text-center text-[11.5px] text-muted">No keys match.</li>
        ) : null}
        {keys.map((entry) => {
          const active = selectedKey?.key === entry.key;
          return (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => void selectKey(entry.key)}
                className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[12px] ${
                  active ? "bg-line-soft text-text" : "text-muted hover:bg-line-soft/50 hover:text-text"
                }`}
              >
                <span className="truncate font-mono">{entry.key}</span>
                <span className={`shrink-0 font-mono text-[10.5px] uppercase ${TYPE_COLORS[entry.type] ?? "text-subtle"}`}>
                  {entry.type}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-line-soft px-3 py-2 text-[11px] text-muted">
        <div className="flex items-center justify-between">
          <span>
            {keys.length} key{keys.length === 1 ? "" : "s"}
            {reachedEnd ? "" : "+"}
          </span>
          {!reachedEnd ? (
            <Button onClick={() => void nextPage()} disabled={loading}>
              Load more
            </Button>
          ) : null}
        </div>
      </footer>
    </aside>
  );
}

function DbSwitcher({
  currentDb,
  stats,
  onSelect
}: {
  currentDb: number;
  stats: { index: number; keys: number }[];
  onSelect(db: number): void;
}) {
  const current = stats.find((entry) => entry.index === currentDb);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-left text-[11.5px] text-muted hover:text-text"
        >
          <Database size={11} strokeWidth={1.7} />
          DB {currentDb}
          <span className="font-mono text-[10.5px] text-subtle">· {current?.keys ?? 0} keys</span>
          <ChevronDown size={11} strokeWidth={1.7} className="text-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[280px] overflow-y-auto">
        {stats.map((entry) => (
          <DropdownMenuItem key={entry.index} onSelect={() => onSelect(entry.index)}>
            <span className="font-mono text-[11.5px] text-text">DB {entry.index}</span>
            <span className="ml-auto font-mono text-[10.5px] text-subtle">{entry.keys}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
