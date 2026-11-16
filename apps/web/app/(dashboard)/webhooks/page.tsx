"use client";

import { CheckIcon, CopyIcon, Loader2Icon, PlusIcon, Trash2Icon, WebhookIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ApiError,
  apiFetch,
  formatDate,
  webhookEvents,
  type WebhookEndpoint,
} from "@/lib/api";

const developerRoles = ["OWNER", "ADMIN", "DEVELOPER"];

export default function WebhooksPage() {
  const { token, organization, handleApiError } = useAuth();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([...webhookEvents]);
  const [creating, setCreating] = useState(false);
  const [signingSecret, setSigningSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const canManage = organization ? developerRoles.includes(organization.role) : false;

  const load = useCallback(async () => {
    if (!token || !organization) return;
    try {
      const result = await apiFetch<WebhookEndpoint[]>("/api/v1/webhooks", {
        token,
        headers: { "x-organization-id": organization.id },
      });
      setEndpoints(result);
      setError(null);
    } catch (caught) {
      if (handleApiError(caught)) return;
      setError(caught instanceof ApiError ? caught.message : "Could not load webhook endpoints.");
    } finally {
      setLoading(false);
    }
  }, [token, organization, handleApiError]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function create() {
    if (!organization) return;
    setCreating(true);
    try {
      const created = await apiFetch<WebhookEndpoint & { signingSecret: string }>("/api/v1/webhooks", {
        method: "POST",
        token,
        body: { organizationId: organization.id, url: url.trim(), events },
      });
      setSigningSecret(created.signingSecret);
      setUrl("");
      setEvents([...webhookEvents]);
      toast.success("Webhook endpoint created");
      await load();
    } catch (caught) {
      if (!handleApiError(caught)) {
        toast.error(caught instanceof ApiError ? caught.message : "Could not create the endpoint.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!organization) return;
    setDeleting(id);
    try {
      await apiFetch(`/api/v1/webhooks/${id}`, {
        method: "DELETE",
        token,
        headers: { "x-organization-id": organization.id },
      });
      toast.success("Webhook deleted");
      await load();
    } catch (caught) {
      if (!handleApiError(caught)) {
        toast.error(caught instanceof ApiError ? caught.message : "Could not delete the endpoint.");
      }
    } finally {
      setDeleting(null);
    }
  }

  async function copySecret() {
    if (!signingSecret) return;
    await navigator.clipboard.writeText(signingSecret);
    setCopied(true);
    toast.success("Signing secret copied");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Receive signed notifications when a document finishes processing or fails.
          </p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) {
              setSigningSecret(null);
              setUrl("");
              setEvents([...webhookEvents]);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button disabled={!canManage}>
              <PlusIcon className="size-4" /> Add endpoint
            </Button>
          </DialogTrigger>
          <DialogContent>
            {signingSecret ? (
              <>
                <DialogHeader>
                  <DialogTitle>Store the signing secret</DialogTitle>
                  <DialogDescription>
                    Use it to verify the <code>x-docuflow-signature</code> header. It is shown only once.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                  <code className="min-w-0 flex-1 max-h-32 overflow-auto break-all text-xs">{signingSecret}</code>
                  <Button variant="outline" size="sm" onClick={() => void copySecret()}>
                    {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />} Copy
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={() => setCreateOpen(false)}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Add a webhook endpoint</DialogTitle>
                  <DialogDescription>
                    Endpoints must use HTTPS and must not target a local, private, or reserved address.
                    Deliveries are signed with the secret shown after creation.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="webhook-url">Endpoint URL</Label>
                    <Input
                      id="webhook-url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com/hooks/docuflow"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Events</Label>
                    <div className="space-y-2">
                      {webhookEvents.map((event) => (
                        <label key={event} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={events.includes(event)}
                            onCheckedChange={(checked) =>
                              setEvents((current) =>
                                checked === true ? [...current, event] : current.filter((item) => item !== event),
                              )
                            }
                          />
                          <code className="text-xs">{event}</code>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void create()}
                    disabled={creating || !url.trim() || events.length === 0}
                  >
                    {creating ? <Loader2Icon className="size-4 animate-spin" /> : null} Add endpoint
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {!canManage ? (
        <Alert>
          <AlertDescription>
            Your role is {organization?.role.toLowerCase()}. Only owners, admins, and developers can manage
            webhooks.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full" />
          ))}
        </div>
      ) : endpoints.length === 0 ? (
        <EmptyState
          icon={<WebhookIcon className="size-5" />}
          title="No webhook endpoints"
          description="Add an endpoint to be notified when processing completes or fails."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <PlusIcon className="size-4" /> Add endpoint
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {endpoints.map((endpoint) => (
            <Card key={endpoint.id}>
              <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="truncate text-base">{endpoint.url}</CardTitle>
                  <CardDescription className="flex flex-wrap gap-1">
                    {endpoint.eventTypes.map((event) => (
                      <Badge key={event} variant="secondary" className="font-mono text-[11px]">
                        {event}
                      </Badge>
                    ))}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={endpoint.active ? "default" : "secondary"}>
                    {endpoint.active ? "active" : "inactive"}
                  </Badge>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={!canManage || deleting === endpoint.id}>
                        {deleting === endpoint.id ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <Trash2Icon className="size-4" />
                        )}
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Future events will no longer be delivered to {endpoint.url}.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(endpoint.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>
              <CardContent>
                <p className="mb-2 text-xs text-muted-foreground">Recent deliveries</p>
                {endpoint.deliveries && endpoint.deliveries.length > 0 ? (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Event</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Attempts</TableHead>
                          <TableHead className="hidden sm:table-cell">Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {endpoint.deliveries.map((delivery) => (
                          <TableRow key={delivery.id}>
                            <TableCell className="font-mono text-xs">{delivery.eventType}</TableCell>
                            <TableCell>
                              <Badge variant={delivery.status === "DELIVERED" ? "default" : "secondary"}>
                                {delivery.status.toLowerCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>{delivery.attempts}</TableCell>
                            <TableCell className="hidden text-muted-foreground sm:table-cell">
                              {formatDate(delivery.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No deliveries yet.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
