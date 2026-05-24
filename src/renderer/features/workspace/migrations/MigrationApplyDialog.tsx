import { useEffect, useState } from "react";
import { MigrationPreview } from "../../../../core/shared/messages";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../../../components/ui/AlertDialog";
import { PreviewItem } from "./PreviewItem";

export interface PendingApply {
  scope: "single" | "all";
  versions: string[];
}

export function MigrationApplyDialog({
  pending,
  folder,
  profileLabel,
  keyspace,
  applying,
  onConfirm,
  onCancel
}: {
  pending: PendingApply | undefined;
  folder: string | undefined;
  profileLabel: string | undefined;
  keyspace: string | undefined;
  applying: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const [previews, setPreviews] = useState<MigrationPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!pending || !folder) {
      setPreviews([]);
      setPreviewError(undefined);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(undefined);
    Promise.all(pending.versions.map((version) => window.cassandraDesk.previewMigration(folder, version)))
      .then((results) => {
        if (!cancelled) setPreviews(results);
      })
      .catch((caught) => {
        if (!cancelled) setPreviewError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pending, folder]);

  return (
    <AlertDialog
      open={Boolean(pending)}
      onOpenChange={(open) => {
        if (!open && !applying) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apply migrations?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.scope === "all"
              ? `Execute ${pending.versions.length} pending migration${pending.versions.length === 1 ? "" : "s"}. This cannot be undone.`
              : "Execute the selected migration. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <div className="rounded-ui border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            <strong className="font-medium">Cluster:</strong> {profileLabel} ·{" "}
            <strong className="font-medium">Keyspace:</strong> {keyspace}
          </div>
          <div className="max-h-[280px] overflow-y-auto rounded-ui border border-line-soft">
            {previewError ? (
              <div className="px-3 py-2 text-[11.5px] text-danger">{previewError}</div>
            ) : previewLoading ? (
              <div className="px-3 py-2 text-[11.5px] text-muted">Parsing statements…</div>
            ) : previews.length === 0 ? (
              <div className="px-3 py-2 text-[11.5px] text-muted">No statements parsed.</div>
            ) : (
              <ul className="grid">
                {previews.map((preview) => (
                  <PreviewItem key={preview.version} preview={preview} defaultOpen={previews.length === 1} />
                ))}
              </ul>
            )}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            disabled={applying}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {applying ? "Applying..." : `Apply ${pending?.versions.length ?? 0}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
