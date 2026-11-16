"use client";

import { Loader2Icon, PlusIcon, UserPlusIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { CreateOrganizationCard } from "@/components/create-organization-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiFetch, formatDate, type Member } from "@/lib/api";

const assignableRoles = ["ADMIN", "MEMBER", "DEVELOPER"] as const;
const managerRoles = ["OWNER", "ADMIN"];

export default function SettingsPage() {
  const { token, user, organization, organizations, handleApiError, logout } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof assignableRoles)[number]>("MEMBER");
  const [adding, setAdding] = useState(false);

  const canManage = organization ? managerRoles.includes(organization.role) : false;

  const load = useCallback(async () => {
    if (!token || !organization) return;
    setLoading(true);
    try {
      const result = await apiFetch<Member[]>(`/api/v1/organizations/${organization.id}/members`, { token });
      setMembers(result);
      setError(null);
    } catch (caught) {
      if (handleApiError(caught)) return;
      setError(caught instanceof ApiError ? caught.message : "Could not load members.");
    } finally {
      setLoading(false);
    }
  }, [token, organization, handleApiError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;
    setAdding(true);
    try {
      await apiFetch(`/api/v1/organizations/${organization.id}/members`, {
        method: "POST",
        token,
        body: { email: email.trim(), role },
      });
      toast.success("Member added");
      setEmail("");
      setRole("MEMBER");
      await load();
    } catch (caught) {
      if (!handleApiError(caught)) {
        toast.error(caught instanceof ApiError ? caught.message : "Could not add the member.");
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage organizations, members, and your account.</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {organization ? (
        <Card>
          <CardHeader>
            <CardTitle>{organization.name}</CardTitle>
            <CardDescription>
              Slug <code>{organization.slug}</code> · you are {organization.role.toLowerCase()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableHead className="w-40">Organization ID</TableHead>
                  <TableCell className="font-mono text-xs">{organization.id}</TableCell>
                </TableRow>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableCell>{formatDate(organization.createdAt)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableHead>Your memberships</TableHead>
                  <TableCell>{organizations.map((item) => item.name).join(", ") || "—"}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {organization ? `People with access to ${organization.name}.` : "Select an organization first."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="hidden sm:table-cell">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium">{member.name || member.email}</p>
                            {member.name ? (
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize">
                            {member.role.toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {formatDate(member.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => void addMember(event)}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserPlusIcon className="size-4" /> Add an existing user
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="member-email">Email</Label>
                  <Input
                    id="member-email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="teammate@company.com"
                    disabled={!canManage}
                  />
                </div>
                <div className="w-full space-y-2 sm:w-40">
                  <Label>Role</Label>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as (typeof assignableRoles)[number])}
                    disabled={!canManage}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableRoles.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item.toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={!canManage || adding || !email.trim()}>
                  {adding ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
                  Add
                </Button>
              </div>
              {!canManage ? (
                <p className="text-xs text-muted-foreground">
                  Only owners and admins can add members. The user must already have a DocuFlow account.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Your account</CardTitle>
              <CardDescription>{user?.email}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Name</span>
                <span className="truncate">{user?.name || "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">User ID</span>
                <span className="truncate font-mono text-xs">{user?.id}</span>
              </div>
              <Button variant="outline" className="w-full" onClick={logout}>
                Sign out
              </Button>
            </CardContent>
          </Card>

          <CreateOrganizationCard compact />
        </div>
      </div>
    </div>
  );
}
