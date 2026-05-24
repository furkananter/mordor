import { useEffect, useRef, useState } from "react";
import { ChevronUp, Send, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { useRedisStore } from "../../../store/redis";

interface HistoryEntry {
  id: number;
  command: string;
  ok: boolean;
  output: string;
}

let entryId = 0;

export function RedisCommandPalette() {
  const selection = useRedisStore((state) => state.selection);
  const refreshKeys = useRedisStore((state) => state.reload);
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [running, setRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [history.length]);

  if (!selection) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || running) return;
    setRunning(true);
    try {
      const result = await window.cassandraDesk.redisCommand(selection.profileId, selection.db, trimmed);
      setHistory((prev) => [
        ...prev,
        {
          id: ++entryId,
          command: trimmed,
          ok: result.ok,
          output: result.ok ? result.result ?? "(empty)" : result.error ?? "Error"
        }
      ]);
      setCommand("");
      // Mutating commands invalidate the key list
      if (/^\s*(set|del|hset|lpush|rpush|sadd|zadd|xadd|expire|rename|flushdb|flushall)\b/i.test(trimmed)) {
        void refreshKeys();
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="shrink-0 border-t border-line-soft bg-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-subtle hover:bg-line-soft/40"
      >
        <span className="flex items-center gap-2">
          <TerminalIcon size={11} strokeWidth={1.7} />
          Command palette
        </span>
        <ChevronUp size={11} strokeWidth={1.7} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open ? (
        <div className="grid gap-2 border-t border-line-soft px-3 py-2">
          <div
            ref={outputRef}
            className="max-h-[220px] overflow-y-auto rounded-ui border border-line-soft bg-panel-soft px-2 py-1 font-mono text-[11.5px]"
          >
            {history.length === 0 ? (
              <p className="px-1 py-2 text-subtle">Run a Redis command: <span className="text-text">GET key</span>, <span className="text-text">INFO</span>, <span className="text-text">CONFIG GET maxmemory</span>.</p>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="border-b border-line-soft/70 px-1 py-1.5 last:border-b-0">
                  <div className="text-[11px] text-accent">{`> ${entry.command}`}</div>
                  <pre className={`whitespace-pre-wrap break-words ${entry.ok ? "text-text" : "text-danger"}`}>{entry.output}</pre>
                </div>
              ))
            )}
          </div>
          <form className="flex items-center gap-1" onSubmit={(event) => void handleSubmit(event)}>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="GET key"
              className="w-full rounded-ui border border-line bg-panel px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-subtle focus-visible:border-accent focus-visible:outline-none"
              disabled={running}
              autoFocus
            />
            <Button variant="primary" type="submit" disabled={running || !command.trim()}>
              <Send size={11} strokeWidth={1.7} />
              <span>Run</span>
            </Button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
