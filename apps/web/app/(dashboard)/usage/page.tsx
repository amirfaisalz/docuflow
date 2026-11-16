"use client";

import { BarChart3Icon, ClockIcon, CoinsIcon, FileCheck2Icon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ApiError,
  apiFetch,
  formatDate,
  formatDuration,
  type UsageSummary,
} from "@/lib/api";

function toIso(value: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function UsagePage() {
  const { token, organization, handleApiError } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(
    async (range?: { from?: string; to?: string }) => {
      if (!token || !organization) return;
      setLoading(true);
      const query = new URLSearchParams();
      if (range?.from) query.set("from", range.from);
      if (range?.to) query.set("to", range.to);
      try {
        const result = await apiFetch<UsageSummary>(`/api/v1/usage${query.size ? `?${query}` : ""}`, {
          token,
          headers: { "x-organization-id": organization.id },
        });
        setUsage(result);
        setError(null);
      } catch (caught) {
        if (handleApiError(caught)) return;
        setError(caught instanceof ApiError ? caught.message : "Could not load usage.");
      } finally {
        setLoading(false);
      }
    },
    [token, organization, handleApiError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const tokens = (usage?.totals.inputTokens ?? 0) + (usage?.totals.outputTokens ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Metered AI processing for {organization?.name}. Filter by processing date.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Date range</CardTitle>
          <CardDescription>Leave both fields empty to include all records.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="usage-from">From</Label>
              <Input id="usage-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="usage-to">To</Label>
              <Input id="usage-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void load({ from: toIso(from), to: toIso(to, true) })} disabled={loading}>
                {loading ? <RefreshCwIcon className="size-4 animate-spin" /> : <BarChart3Icon className="size-4" />}
                Apply
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setFrom("");
                  setTo("");
                  void load();
                }}
              >
                Reset
              </Button>
            </div>
          </div>
          {usage?.period.from || usage?.period.to ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {usage?.period.from ? formatDate(usage.period.from) : "the beginning"} →{" "}
              {usage?.period.to ? formatDate(usage.period.to) : "now"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Processed documents",
            value: usage?.totals.processedDocuments ?? 0,
            icon: FileCheck2Icon,
            hint: "metered jobs",
          },
          { label: "Total tokens", value: tokens, icon: CoinsIcon, hint: "input + output" },
          {
            label: "Input tokens",
            value: usage?.totals.inputTokens ?? 0,
            icon: CoinsIcon,
            hint: "prompt tokens",
          },
          {
            label: "Processing time",
            value: formatDuration(usage?.totals.processingDurationMs ?? 0),
            icon: ClockIcon,
            hint: "model execution",
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-semibold">
                  {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent usage records</CardTitle>
          <CardDescription>Most recent metered processing jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : !usage || usage.recent.length === 0 ? (
            <EmptyState
              icon={<BarChart3Icon className="size-5" />}
              title="No usage recorded"
              description="Processed documents appear here once the worker finishes a job."
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Input</TableHead>
                    <TableHead>Output</TableHead>
                    <TableHead className="hidden sm:table-cell">Duration</TableHead>
                    <TableHead className="hidden md:table-cell">Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.recent.map((record) => (
                    <TableRow key={record.jobId}>
                      <TableCell className="max-w-48 truncate font-mono text-xs">{record.jobId}</TableCell>
                      <TableCell>{(record.inputTokens ?? 0).toLocaleString()}</TableCell>
                      <TableCell>{(record.outputTokens ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {formatDuration(record.processingDuration ?? 0)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatDate(record.createdAt)}
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
