import { Badge } from "@/components/ui/badge";
import type { DocumentStatus, JobStatus } from "@/lib/api";

const styles: Record<string, { label: string; className: string }> = {
  PENDING_UPLOAD: { label: "Pending upload", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  UPLOADED: { label: "Uploaded", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  QUEUED: { label: "Queued", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  PROCESSING: { label: "Processing", className: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  COMPLETED: { label: "Completed", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  NEEDS_REVIEW: { label: "Needs review", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
  FAILED: { label: "Failed", className: "bg-destructive/15 text-destructive" },
};

export function StatusBadge({ status }: { status: DocumentStatus | JobStatus }) {
  const style = styles[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={`border-transparent ${style.className}`}>
      {style.label}
    </Badge>
  );
}
