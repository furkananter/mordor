import { AlertTriangle, CheckCircle2, Circle, XCircle } from "lucide-react";
import { MigrationFile } from "../../../../core/shared/messages";

export function StatusIcon({ status }: { status: MigrationFile["status"] }) {
  if (status === "applied") return <CheckCircle2 size={14} strokeWidth={1.7} className="text-success" />;
  if (status === "applied-modified") return <AlertTriangle size={14} strokeWidth={1.7} className="text-warning" />;
  if (status === "failed") return <XCircle size={14} strokeWidth={1.7} className="text-danger" />;
  return <Circle size={14} strokeWidth={1.7} className="text-subtle" />;
}
