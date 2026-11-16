"use client";

import Link from "next/link";
import { FileImageIcon, FileTextIcon, RefreshCwIcon, SearchIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { UploadDialog } from "@/components/upload-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { activeStatus, ApiError, apiFetch, formatBytes, formatDate, type DocumentRecord } from "@/lib/api";

export default function DocumentsPage() {
  const { token, organization, handleApiError } = useAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!token || !organization) return;
    try {
      const result = await apiFetch<DocumentRecord[]>("/api/v1/documents", {
        token,
        headers: { "x-organization-id": organization.id },
      });
      setDocuments(result);
      setError(null);
    } catch (caught) {
      if (handleApiError(caught)) return;
      setError(caught instanceof ApiError ? caught.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }, [token, organization, handleApiError]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!documents.some((document) => activeStatus(document.status))) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [documents, load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter(
      (document) =>
        document.filename.toLowerCase().includes(needle) || document.status.toLowerCase().includes(needle),
    );
  }, [documents, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Upload a document, then follow extraction progress from queued to completed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <UploadDialog onUploaded={() => void load()} />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>All documents</CardTitle>
            <CardDescription>
              {documents.length} document{documents.length === 1 ? "" : "s"} in {organization?.name}
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Filter by name or status"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading && documents.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<UploadIcon className="size-5" />}
              title={documents.length === 0 ? "No documents yet" : "No matching documents"}
              description={
                documents.length === 0
                  ? "Upload a PDF, JPEG, or PNG. The API signs the upload, stores it privately, and queues extraction."
                  : "Try a different filename or status."
              }
              action={
                documents.length === 0 ? (
                  <UploadDialog
                    trigger={
                      <Button size="sm">
                        <UploadIcon className="size-4" /> Upload document
                      </Button>
                    }
                    onUploaded={() => void load()}
                  />
                ) : null
              }
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Size</TableHead>
                    <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {document.mimeType === "application/pdf" ? (
                            <FileTextIcon className="size-4 text-muted-foreground" />
                          ) : (
                            <FileImageIcon className="size-4 text-muted-foreground" />
                          )}
                          <Link href={`/documents/${document.id}`} className="max-w-56 truncate font-medium hover:underline">
                            {document.filename}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={document.status} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {formatBytes(document.size)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatDate(document.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/documents/${document.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
