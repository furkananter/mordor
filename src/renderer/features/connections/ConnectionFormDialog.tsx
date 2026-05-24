import { CreateProfileInput, ProfileListItem } from "../../../core/ipc";
import { Dialog } from "../../components/ui/Dialog";
import { ConnectionForm } from "./ConnectionForm";

/**
 * Modal wrapper around ConnectionForm. Decides Add vs. Edit copy from whether
 * `editing` is provided. Calling `onClose` always clears the editing target
 * upstream — the caller controls visibility via `open`.
 */
export function ConnectionFormDialog({
  open,
  editing,
  onSubmit,
  onClose
}: {
  open: boolean;
  editing: ProfileListItem | undefined;
  onSubmit(input: CreateProfileInput): Promise<void>;
  onClose(): void;
}) {
  return (
    <Dialog
      open={open}
      title={editing ? "Edit Connection" : "Add Connection"}
      description={
        editing
          ? "Update the saved Cassandra connection profile."
          : "Create a saved Cassandra connection profile."
      }
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ConnectionForm editing={editing} onSubmit={onSubmit} onCancel={onClose} />
    </Dialog>
  );
}
