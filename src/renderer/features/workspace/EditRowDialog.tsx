import { useEffect, useMemo, useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { TableSchemaPayload } from "../../../core/shared/messages";

/**
 * Schema-aware "edit a row" form. Pre-fills one field per column from the row's
 * current values, keeps primary-key columns read-only (they identify the row in
 * the WHERE clause and can't be mutated), and sends only the non-key columns the
 * user actually changed — leaving everything else untouched. A cleared field is
 * written as null, mirroring InsertRowDialog's "blank = default / null".
 */
export function EditRowDialog({
  open,
  schema,
  row,
  onOpenChange,
  onUpdated
}: {
  open: boolean;
  schema: TableSchemaPayload;
  row: Record<string, string>;
  onOpenChange(open: boolean): void;
  onUpdated(): void;
}) {
  const keyColumns = useMemo(
    () => new Set([...schema.partitionKeys, ...schema.clusteringKeys]),
    [schema]
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Seed the form from the row whenever the dialog opens. The component stays
  // mounted while a row is selected, so without re-seeding on open the next
  // edit would show the previously abandoned values. Default missing cells to
  // "" so every column has a defined string to diff against on submit.
  useEffect(() => {
    if (open) {
      setValues(
        schema.columns.reduce<Record<string, string>>((acc, column) => {
          acc[column.name] = row[column.name] ?? "";
          return acc;
        }, {})
      );
      setError(undefined);
      setSubmitting(false);
    }
  }, [open, schema, row]);

  const handleSubmit = async () => {
    // The original primary-key values locate the row (WHERE clause). PKs are
    // read-only, so these come straight from the untouched row.
    const keys = [...keyColumns].reduce<Record<string, string>>((acc, column) => {
      acc[column] = row[column] ?? "";
      return acc;
    }, {});
    // Only send non-key columns whose value actually changed — unchanged fields
    // and PKs are excluded, so the UPDATE touches exactly what the user edited.
    const changed: Record<string, string> = {};
    for (const column of schema.columns) {
      if (keyColumns.has(column.name)) continue;
      const next = values[column.name] ?? "";
      if (next !== (row[column.name] ?? "")) {
        changed[column.name] = next;
      }
    }
    if (Object.keys(changed).length === 0) {
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await window.cassandraDesk.updateTableRow(schema.table, keys, changed);
      onOpenChange(false);
      onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      size="lg"
      title="Edit row"
      description={
        <>
          Update a row in <code className="font-mono text-[11.5px]">{schema.table.keyspace}.{schema.table.table}</code>.
          Primary key columns identify the row and can&apos;t be changed; clear a field to set it to null.
        </>
      }
      onOpenChange={(next) => {
        // Don't let a stray Esc/backdrop click abort an in-flight update.
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <form
        className="grid min-h-0 flex-1 grid-rows-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="grid gap-3 overflow-y-auto px-5 pb-4 pt-1">
          {schema.columns.map((column) => {
            const isKey = keyColumns.has(column.name);
            const isBoolean = column.type.toLowerCase() === "boolean" || column.type.toLowerCase() === "bool";
            return (
              <label key={column.name} className="grid gap-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[12px] font-medium text-text">{column.name}</span>
                  <span className="font-mono text-[10.5px] text-subtle">{column.type}</span>
                  {isKey ? (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.05em] text-accent">
                      key
                    </span>
                  ) : null}
                </span>
                {isKey ? (
                  <Input
                    value={values[column.name] ?? ""}
                    readOnly
                    disabled
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                  />
                ) : isBoolean ? (
                  <select
                    value={values[column.name] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [column.name]: event.target.value }))
                    }
                    disabled={submitting}
                    className="min-h-[28px] w-full rounded-ui border border-line bg-panel px-2 py-1 text-[12.5px] text-text focus-visible:border-accent focus-visible:outline-none"
                  >
                    <option value="">null</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <Input
                    value={values[column.name] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [column.name]: event.target.value }))
                    }
                    placeholder="default / null"
                    disabled={submitting}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                  />
                )}
                {isKey ? (
                  <span className="text-[10.5px] text-subtle">
                    Identifies the row — can&apos;t be changed.
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>

        <div className="grid gap-2 border-t border-line-soft px-5 py-3">
          {error ? (
            <div className="rounded-ui border border-danger/40 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
