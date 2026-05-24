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

export function NewMigrationDialog({
  open,
  folder,
  name,
  error,
  creating,
  onNameChange,
  onConfirm,
  onOpenChange
}: {
  open: boolean;
  folder: string | undefined;
  name: string;
  error: string | undefined;
  creating: boolean;
  onNameChange(name: string): void;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>New migration</AlertDialogTitle>
          <AlertDialogDescription>
            Creates a versioned <code className="font-mono text-[11.5px]">.cql</code> file in {folder ?? "the configured folder"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <label className="grid gap-1 text-[11.5px] font-medium text-muted">
            Name
            <input
              autoFocus
              className="w-full rounded-ui border border-line bg-panel px-2.5 py-1.5 text-[13px] text-text placeholder:text-subtle focus-visible:border-accent focus-visible:outline-none"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="add_orders_table"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onConfirm();
                }
              }}
            />
          </label>
          {error ? <p className="text-[11.5px] text-danger">{error}</p> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={creating}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="primary"
            disabled={creating || !name.trim()}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {creating ? "Creating…" : "Create"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
