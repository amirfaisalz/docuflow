"use client";

import { CheckCircle2Icon, FileUpIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptedMimeTypes, ApiError, apiFetch, formatBytes, maxUploadBytes, type UploadUrlResponse } from "@/lib/api";

type Stage = "idle" | "requesting" | "uploading" | "verifying" | "done";

const stageLabels: Record<Exclude<Stage, "idle" | "done">, string> = {
  requesting: "Requesting a signed upload…",
  uploading: "Uploading to Cloudinary…",
  verifying: "Verifying the file and queueing processing…",
};

function resolveMimeType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return "";
}

export function UploadDialog({
  trigger,
  onUploaded,
}: {
  trigger?: React.ReactNode;
  onUploaded?: () => void;
}) {
  const { token, organization } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const pending = stage === "requesting" || stage === "uploading" || stage === "verifying";

  function reset() {
    setFile(null);
    setStage("idle");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError(null);
    setStage("idle");
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      return;
    }
    const mimeType = resolveMimeType(selected);
    if (!acceptedMimeTypes.includes(mimeType as (typeof acceptedMimeTypes)[number])) {
      setError("Only PDF, JPEG, and PNG files are supported.");
      setFile(null);
      return;
    }
    if (selected.size > maxUploadBytes) {
      setError(`File is too large. The limit is ${formatBytes(maxUploadBytes)}.`);
      setFile(null);
      return;
    }
    setFile(selected);
  }

  async function upload() {
    if (!file || !organization || !token) return;
    setError(null);
    setStage("requesting");
    try {
      const created = await apiFetch<UploadUrlResponse>("/api/v1/documents/upload-url", {
        method: "POST",
        token,
        body: {
          organizationId: organization.id,
          filename: file.name,
          mimeType: resolveMimeType(file),
          size: file.size,
        },
      });

      setStage("uploading");
      const form = new FormData();
      form.append("file", file);
      form.append("apiKey", created.upload.apiKey);
      for (const [key, value] of Object.entries(created.upload.params)) form.append(key, value);

      const cloudResponse = await fetch(created.upload.url, { method: "POST", body: form });
      if (!cloudResponse.ok) {
        const payload = (await cloudResponse.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new ApiError(
          cloudResponse.status,
          payload?.error?.message ?? "Cloudinary rejected the upload. Check your storage credentials.",
        );
      }

      setStage("verifying");
      await apiFetch(`/api/v1/documents/${created.document.id}/complete-upload`, {
        method: "POST",
        token,
      });

      setStage("done");
      toast.success(`${file.name} queued for processing`);
      onUploaded?.();
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 900);
    } catch (caught) {
      setStage("idle");
      setError(caught instanceof ApiError ? caught.message : "Upload failed. Try again.");
      if (caught instanceof ApiError && caught.status === 401) toast.error("Session expired. Sign in again.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <UploadIcon className="size-4" /> Upload document
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            PDF, JPEG, or PNG up to {formatBytes(maxUploadBytes)}. The file is uploaded straight to
            Cloudinary with a short-lived signature; processing starts automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-file">File</Label>
            <Input
              id="document-file"
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={chooseFile}
              disabled={pending}
            />
            {file ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileUpIcon className="size-3.5" /> {file.name} · {formatBytes(file.size)}
              </p>
            ) : null}
          </div>

          {pending || stage === "done" ? (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              {(Object.keys(stageLabels) as Array<keyof typeof stageLabels>).map((key) => {
                const order = ["requesting", "uploading", "verifying"] as const;
                const currentIndex = stage === "done" ? order.length : order.indexOf(stage as (typeof order)[number]);
                const index = order.indexOf(key);
                const complete = stage === "done" || index < currentIndex;
                const active = index === currentIndex && stage !== "done";
                return (
                  <div key={key} className="flex items-center gap-2">
                    {complete ? (
                      <CheckCircle2Icon className="size-4 text-emerald-600" />
                    ) : active ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <span className="size-4 rounded-full border" />
                    )}
                    <span className={complete || active ? "" : "text-muted-foreground"}>{stageLabels[key]}</span>
                  </div>
                );
              })}
              {stage === "done" ? (
                <p className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle2Icon className="size-4" /> Done
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void upload()} disabled={!file || pending || stage === "done"}>
            {pending ? <Loader2Icon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
