import { useEffect, useState } from "react";
import { Clock, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { RedisKeyValue } from "../../../../core/ipc";
import { useRedisStore } from "../../../store/redis";
import { usePreferencesStore } from "../../../store/preferences";

export function RedisKeyViewer() {
  const selectedKey = useRedisStore((state) => state.selectedKey);
  const refresh = useRedisStore((state) => state.refreshSelectedKey);
  const deleteKey = useRedisStore((state) => state.deleteSelectedKey);
  const queryMode = usePreferencesStore((state) => state.queryMode);

  if (!selectedKey) return null;

  const writable = queryMode !== "read";

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] text-text">{selectedKey.key}</span>
            <span className="rounded-full bg-line-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
              {selectedKey.type}
            </span>
          </span>
          <span className="flex items-center gap-1 text-[11px] text-subtle">
            <Clock size={10} strokeWidth={1.7} />
            {formatTtl(selectedKey.ttl)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="icon" onClick={() => void refresh()} tooltip="Reload">
            <RefreshCw size={12} strokeWidth={1.7} />
          </Button>
          <Button
            variant="icon"
            onClick={() => {
              if (window.confirm(`Delete "${selectedKey.key}"?`)) void deleteKey();
            }}
            tooltip={writable ? "Delete key" : "Read-only mode"}
            disabled={!writable}
          >
            <Trash2 size={12} strokeWidth={1.7} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <ValueRenderer value={selectedKey} writable={writable} />
      </div>
    </section>
  );
}

function ValueRenderer({ value, writable }: { value: RedisKeyValue; writable: boolean }) {
  if (value.value.kind === "string") return <StringValue value={value} writable={writable} />;
  if (value.value.kind === "list") return <ListView entries={value.value.data} />;
  if (value.value.kind === "set") return <ListView entries={value.value.data} />;
  if (value.value.kind === "zset")
    return (
      <KeyValueTable
        columns={["Member", "Score"]}
        rows={value.value.data.map((entry) => [entry.member, String(entry.score)])}
      />
    );
  if (value.value.kind === "hash")
    return (
      <KeyValueTable
        columns={["Field", "Value"]}
        rows={value.value.data.map((entry) => [entry.field, entry.value])}
      />
    );
  if (value.value.kind === "stream")
    return (
      <div className="grid gap-2 p-3">
        {value.value.data.map((entry) => (
          <div key={entry.id} className="rounded-ui border border-line-soft px-3 py-2">
            <div className="font-mono text-[11px] text-subtle">{entry.id}</div>
            <KeyValueTable
              columns={["Field", "Value"]}
              rows={entry.fields.map((field) => [field.field, field.value])}
            />
          </div>
        ))}
      </div>
    );
  return <div className="p-4 text-[12px] text-muted">Key not found.</div>;
}

function StringValue({ value, writable }: { value: RedisKeyValue; writable: boolean }) {
  const setStringValue = useRedisStore((state) => state.setStringValue);
  const data = value.value.kind === "string" ? value.value.data : "";
  const [draft, setDraft] = useState(data);
  const [ttl, setTtl] = useState(value.ttl > 0 ? String(value.ttl) : "");
  const dirty = draft !== data;

  useEffect(() => {
    setDraft(data);
    setTtl(value.ttl > 0 ? String(value.ttl) : "");
  }, [data, value.ttl, value.key]);

  return (
    <div className="grid gap-2 p-3">
      <textarea
        className="min-h-[200px] w-full resize-y rounded-ui border border-line bg-panel px-3 py-2 font-mono text-[12px] text-text focus-visible:border-accent focus-visible:outline-none"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        readOnly={!writable}
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
          TTL (seconds)
          <Input value={ttl} onChange={(event) => setTtl(event.target.value)} placeholder="∞" disabled={!writable} />
        </label>
        <Button
          variant="primary"
          disabled={!writable || !dirty}
          onClick={() => {
            const parsedTtl = ttl.trim() ? Number.parseInt(ttl, 10) : undefined;
            void setStringValue(draft, parsedTtl && parsedTtl > 0 ? parsedTtl : undefined);
          }}
        >
          <Save size={12} strokeWidth={1.7} />
          <span>Save</span>
        </Button>
      </div>
    </div>
  );
}

function ListView({ entries }: { entries: string[] }) {
  return (
    <ol className="grid divide-y divide-line-soft text-[12px] font-mono">
      {entries.map((entry, index) => (
        <li key={index} className="flex gap-2 px-3 py-1.5">
          <span className="shrink-0 text-subtle">{index + 1}.</span>
          <span className="min-w-0 flex-1 break-all text-text">{entry}</span>
        </li>
      ))}
    </ol>
  );
}

function KeyValueTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <table className="w-full border-collapse text-[12px] font-mono">
      <thead className="bg-line-soft text-[11px] uppercase tracking-[0.06em] text-muted">
        <tr>
          {columns.map((col) => (
            <th key={col} className="px-3 py-1.5 text-left">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-t border-line-soft">
            {row.map((cell, idx) => (
              <td key={idx} className="break-all px-3 py-1.5 text-text">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatTtl(ttl: number): string {
  if (ttl === -1) return "no TTL";
  if (ttl === -2) return "expired";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.round(ttl / 60)}m`;
  if (ttl < 86400) return `${Math.round(ttl / 3600)}h`;
  return `${Math.round(ttl / 86400)}d`;
}
