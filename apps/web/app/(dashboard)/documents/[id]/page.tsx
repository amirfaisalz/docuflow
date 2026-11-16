"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  FileJsonIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  TextIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  activeStatus,
  ApiError,
  apiFetch,
  formatBytes,
  formatDate,
  type DocumentRecord,
  type ProcessingJob,
} from "@/lib/api";

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const { token, handleApiError } = useAuth();
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [latestJob, setLatestJob] = useState<ProcessingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token || !params.id) return;
    try {
      const record = await apiFetch<DocumentRecord>(`/api/v1/documents/${params.id}`, { token });
      const jobList = await apiFetch<ProcessingJob[]>(`/api/v1/documents/${params.id}/jobs`, { token });
      setDocument(record);
      setJobs(jobList);
      const newest = jobList[0];
      if (newest) {
        const detail = await apiFetch<ProcessingJob>(`/api/v1/jobs/${newest.id}`, { token });
        setLatestJob(detail);
      } else {
        setLatestJob(null);
      }
      setError(null);
    } catch (caught) {
      if (handleApiError(caught)) return;
      setError(caught instanceof ApiError ? caught.message : "Could not load this document.");
    } finally {
      setLoading(false);
    }
  }, [token, params.id, handleApiError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!document || !(activeStatus(document.status) || activeStatus(latestJob?.status ?? "COMPLETED"))) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [document, latestJob, load]);

  async function retry() {
    if (!latestJob) return;
    setActing(true);
    try {
      await apiFetch(`/api/v1/jobs/${latestJob.id}/retry`, { method: "POST", token });
      toast.success("Job re-queued");
      await load();
    } catch (caught) {
      if (!handleApiError(caught)) {
        toast.error(caught instanceof ApiError ? caught.message : "Could not retry the job.");
      }
    } finally {
      setActing(false);
    }
  }

  async function processNow() {
    if (!document) return;
    setActing(true);
    try {
      await apiFetch(`/api/v1/documents/${document.id}/process`, { method: "POST", token });
      toast.success("Processing queued");
      await load();
    } catch (caught) {
      if (!handleApiError(caught)) {
        toast.error(caught instanceof ApiError ? caught.message : "Could not start processing.");
      }
    } finally {
      setActing(false);
    }
  }

  async function copyResult() {
    if (!latestJob?.result) return;
    await navigator.clipboard.writeText(JSON.stringify(latestJob.result.data, null, 2));
    setCopied(true);
    toast.success("Extracted data copied");
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/documents">
            <ArrowLeftIcon className="size-4" /> Documents
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error ?? "Document not found."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const result = latestJob?.result ?? null;
  const working = activeStatus(document.status) || activeStatus(latestJob?.status ?? "COMPLETED");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" asChild>
            <Link href="/documents">
              <ArrowLeftIcon className="size-4" /> Documents
            </Link>
          </Button>
          <h1 className="max-w-2xl truncate text-2xl font-semibold tracking-tight">{document.filename}</h1>
          <p className="text-sm text-muted-foreground">
            {document.mimeType} · {formatBytes(document.size)} · uploaded {formatDate(document.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={document.status} />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={working ? false : acting}>
            <RefreshCwIcon className={`size-4 ${working ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {latestJob?.status === "FAILED" ? (
            <Button size="sm" onClick={() => void retry()} disabled={acting}>
              <RotateCcwIcon className="size-4" /> Retry
            </Button>
          ) : null}
          {document.status === "UPLOADED" && !latestJob ? (
            <Button size="sm" onClick={() => void processNow()} disabled={acting}>
              {acting ? <Loader2Icon className="size-4 animate-spin" /> : null} Start processing
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Extraction result</CardTitle>
            <CardDescription>
              {working
                ? "Processing is still running. This page refreshes automatically."
                : result
                  ? `Model ${result.model} · confidence ${result.confidence === null ? "n/a" : result.confidence.toFixed(2)}`
                  : "No extraction result yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result ? (
              <Tabs defaultValue="json">
                <div className="flex items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="json">
                      <FileJsonIcon className="size-4" /> Structured data
                    </TabsTrigger>
                    <TabsTrigger value="text">
                      <TextIcon className="size-4" /> Raw text
                    </TabsTrigger>
                  </TabsList>
                  <Button variant="outline" size="sm" onClick={() => void copyResult()}>
                    {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />} Copy JSON
                  </Button>
                </div>
                <TabsContent value="json" className="mt-3">
                  <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-4 text-xs">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </TabsContent>
                <TabsContent value="text" className="mt-3">
                  <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-4 text-xs whitespace-pre-wrap">
                    {result.extractedText || "No text extracted."}
                  </pre>
                </TabsContent>
              </Tabs>
            ) : working ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Waiting for the worker to finish extraction…
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No result stored for this document.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Processing jobs</CardTitle>
            <CardDescription>{jobs.length} job{jobs.length === 1 ? "" : "s"} recorded</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div key={job.id} className="space-y-1 rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={job.status} />
                      <span className="text-xs text-muted-foreground">attempts {job.attempts}</span>
                    </div>
                    <p className="font-mono text-xs break-all text-muted-foreground">{job.id}</p>
                    <p className="text-xs text-muted-foreground">created {formatDate(job.createdAt)}</p>
                    {job.errorCode || job.errorMessage ? (
                      <p className="text-xs text-destructive">
                        {job.errorCode ? `${job.errorCode}: ` : ""}
                        {job.errorMessage}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Document metadata</CardTitle>
          <CardDescription>Identifiers exposed by the document API.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableHead className="w-48">Document ID</TableHead>
                <TableCell className="font-mono text-xs">{document.id}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableCell className="font-mono text-xs">{document.organizationId}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead>Last updated</TableHead>
                <TableCell>{formatDate(document.updatedAt)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
