"use client";

import { CheckIcon, CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ApiError, apiFetch, formatDate, type ApiKeyRecord } from "@/lib/api";

const developerRoles = ["OWNER", "ADMIN", "DEVELOPER"];

export default function ApiKeysPage() {
  const { token, organization, handleApiError } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const canManage = organization ? developerRoles.includes(organization.role) : false;

  const load = useCallback(async () => {
    if (!token || !organization) return;
    try {
      const result = await apiFetch<ApiKeyRecord[]>("/api/v1/api-keys", {
        token,
        headers: { "x-organization-id": organization.id },
      });
      setKeys(result);
      setError(null);
    } catch (caught) {
      if (handleApiError(caught)) return;
      setError(caught instanceof ApiError ? caught.message : "Could not load API keys.");
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
      const result = await apiFetch<ApiKeyRecord & { secret: string }>("/api/v1/api-keys", {
        method: "POST",
        token,
        body: { organizationId: organization.id, name: name.trim() },
      });
      setCreatedSecret(result.secret);
      setName("");
      toast.success("API key created");
      await load();
    } catch (caught) {
      if (!handleApiError(caught)) {
        toast.error(caught instanceof ApiError ? caught.message : "Could not create the key.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!organization) return;
    setRevoking(id);
    try {
      await apiFetch(`/api/v1/api-keys/${id}`, {
        method: "DELETE",
        token,
        headers: { "x-organization-id": organization.id },
      });
      toast.success("API key revoked");
      await load();
    } catch (caught) {
      if (!handleApiError(caught)) {
        toast.error(caught instanceof ApiError ? caught.message : "Could not revoke the key.");
      }
    } finally {
      setRevoking(null);
    }
  }

  async function copySecret() {
    if (!createdSecret) return;
    await navigator.clipboard.writeText(createdSecret);
    setCopied(true);
    toast.success("Secret copied");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Programmatic access for this organization. Keys are shown once and can be revoked at any time.
          </p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) {
              setCreatedSecret(null);
              setName("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button disabled={!canManage}>
              <PlusIcon className="size-4" /> Create API key
            </Button>
          </DialogTrigger>
          <DialogContent>
            {createdSecret ? (
              <>
                <DialogHeader>
                  <DialogTitle>Copy your API key now</DialogTitle>
                  <DialogDescription>
                    This secret is only displayed once. Store it in your secret manager.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                  <code className="min-w-0 flex-1 max-h-32 overflow-auto break-all text-xs">{createdSecret}</code>
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
                  <DialogTitle>Create an API key</DialogTitle>
                  <DialogDescription>
                    The key inherits the scope of {organization?.name}. Use it with{" "}
                    <code>Authorization: Bearer df_live_…</code>.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="api-key-name">Key name</Label>
                  <Input
                    id="api-key-name"
                    value={name}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Production server"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => void create()} disabled={creating || !name.trim()}>
                    {creating ? <Loader2Icon className="size-4 animate-spin" /> : null} Create key
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
            Your role is {organization?.role.toLowerCase()}. Only owners, admins, and developers can manage API keys.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Organization keys</CardTitle>
          <CardDescription>{keys.length} key{keys.length === 1 ? "" : "s"} in {organization?.name}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              icon={<KeyRoundIcon className="size-5" />}
              title="No API keys yet"
              description="Create a key to call the document and job endpoints from your backend."
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead className="hidden sm:table-cell">Last used</TableHead>
                    <TableHead className="hidden md:table-cell">Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id} className={key.revokedAt ? "opacity-60" : ""}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{key.name}</span>
                          {key.revokedAt ? (
                            <span className="text-xs text-muted-foreground">revoked</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{key.keyPrefix}…</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {formatDate(key.lastUsedAt)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatDate(key.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {key.revokedAt ? null : (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" disabled={revoking === key.id || !canManage}>
                                {revoking === key.id ? (
                                  <Loader2Icon className="size-4 animate-spin" />
                                ) : (
                                  <Trash2Icon className="size-4" />
                                )}
                                Revoke
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revoke “{key.name}”?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Requests using this key will fail immediately. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void revoke(key.id)}>Revoke key</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
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
