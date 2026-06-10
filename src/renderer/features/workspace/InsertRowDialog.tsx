import { useEffect, useMemo, useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { TableSchemaPayload } from "../../../core/shared/messages";

/**
 * Schema-aware "add a row" form. Builds one field per column from the table
 * schema, marks primary-key columns as required, and inserts only the columns
 * the user actually filled — so DB-side defaults (serial ids, timestamps) are
 * left alone. Handy for seeding test data without hand-writing INSERT CQL/SQL.
 */
export function InsertRowDialog({
  open,
  schema,
  onOpenChange,
  onInserted
}: {
  open: boolean;
  schema: TableSchemaPayload;
  onOpenChange(open: boolean): void;
  onInserted(): void;
}) {
  const keyColumns = useMemo(
    () => new Set([...schema.partitionKeys, ...schema.clusteringKeys]),
    [schema]
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Clear the form whenever the dialog is closed, regardless of how (Cancel,
  // Esc, backdrop, the header X, or a successful insert). The component stays
  // mounted while a table is selected, so without this the next open would
  // show the previously abandoned values.
  useEffect(() => {
    if (!open) {
      setValues({});
      setError(undefined);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    const missing = [...keyColumns].filter((column) => !(values[column] ?? "").trim());
    if (missing.length > 0) {
      setError(`Primary key column${missing.length === 1 ? "" : "s"} required: ${missing.join(", ")}.`);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await window.cassandraDesk.insertTableRow(schema.table, values);
      onOpenChange(false);
      onInserted();
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
      title="Add row"
      description={
        <>
          Insert into <code className="font-mono text-[11.5px]">{schema.table.keyspace}.{schema.table.table}</code>.
          Leave a field empty to use its default / null.
        </>
      }
      onOpenChange={(next) => {
        // Don't let a stray Esc/backdrop click abort an in-flight insert.
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
                {isBoolean ? (
                  <select
                    value={values[column.name] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [column.name]: event.target.value }))
                    }
                    className="min-h-[28px] w-full rounded-ui border border-line bg-panel px-2 py-1 text-[12.5px] text-text focus-visible:border-accent focus-visible:outline-none"
                  >
                    <option value="">{isKey ? "—" : "default / null"}</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <Input
                    value={values[column.name] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [column.name]: event.target.value }))
                    }
                    placeholder={isKey ? "required" : "default / null"}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                  />
                )}
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
              {submitting ? "Inserting…" : "Insert row"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
