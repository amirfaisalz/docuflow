"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  FileTextIcon,
  KeyRoundIcon,
  Loader2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { UploadDialog } from "@/components/upload-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ApiError,
  apiFetch,
  formatBytes,
  formatDate,
  type DocumentRecord,
  type UsageSummary,
} from "@/lib/api";

export default function OverviewPage() {
  const { token, organization, handleApiError } = useAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !organization) return;
    try {
      const [documentList, usageSummary] = await Promise.all([
        apiFetch<DocumentRecord[]>("/api/v1/documents", {
          token,
          headers: { "x-organization-id": organization.id },
        }),
        apiFetch<UsageSummary>("/api/v1/usage", {
          token,
          headers: { "x-organization-id": organization.id },
        }),
      ]);
      setDocuments(documentList);
      setUsage(usageSummary);
      setError(null);
    } catch (caught) {
      if (handleApiError(caught)) return;
      setError(caught instanceof ApiError ? caught.message : "Could not load the overview.");
    } finally {
      setLoading(false);
    }
  }, [token, organization, handleApiError]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const active = documents.filter((document) => document.status === "QUEUED" || document.status === "PROCESSING");
  const completed = documents.filter((document) => document.status === "COMPLETED").length;
  const failed = documents.filter((document) => document.status === "FAILED").length;
  const tokens = (usage?.totals.inputTokens ?? 0) + (usage?.totals.outputTokens ?? 0);

  const stats = [
    { label: "Documents", value: documents.length, icon: FileTextIcon, hint: "in this organization" },
    { label: "In progress", value: active.length, icon: Loader2Icon, hint: "queued or processing" },
    { label: "Completed", value: completed, icon: CheckCircle2Icon, hint: "with extraction result" },
    { label: "Failed", value: failed, icon: TriangleAlertIcon, hint: "needs attention" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            {organization ? `Workspace activity for ${organization.name}.` : "Your workspace activity."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/api-keys">
              <KeyRoundIcon className="size-4" /> API keys
            </Link>
          </Button>
          <UploadDialog onUploaded={() => void load()} />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-12" /> : <p className="text-3xl font-semibold">{stat.value}</p>}
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Recent documents</CardTitle>
              <CardDescription>The five most recent uploads.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/documents">
                View all <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : documents.length === 0 ? (
              <EmptyState
                icon={<UploadIcon className="size-5" />}
                title="No documents yet"
                description="Upload your first PDF or image to see extraction results here."
                action={
                  <UploadDialog
                    trigger={
                      <Button size="sm">
                        <UploadIcon className="size-4" /> Upload document
                      </Button>
                    }
                    onUploaded={() => void load()}
                  />
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Size</TableHead>
                    <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.slice(0, 5).map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>
                        <Link href={`/documents/${document.id}`} className="font-medium hover:underline">
                          {document.filename}
                        </Link>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Metered AI processing for this organization.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Processed documents</p>
                  <p className="text-2xl font-semibold">{usage?.totals.processedDocuments ?? 0}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Total tokens</p>
                  <p className="text-2xl font-semibold">{tokens.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">
                    {(usage?.totals.inputTokens ?? 0).toLocaleString()} in ·{" "}
                    {(usage?.totals.outputTokens ?? 0).toLocaleString()} out
                  </p>
                </div>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href="/usage">
                    <BarChart3Icon className="size-4" /> Open usage report
                  </Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
