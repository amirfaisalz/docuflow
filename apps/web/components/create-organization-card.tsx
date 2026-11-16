"use client";

import { Loader2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

export function CreateOrganizationCard({ compact = false }: { compact?: boolean }) {
  const { createOrganization } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const created = await createOrganization(name.trim());
      setName("");
      toast.success(`Organization “${created.name}” created`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the organization.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className={compact ? "" : "w-full max-w-lg"}>
      <CardHeader>
        <CardTitle>Create an organization</CardTitle>
        <CardDescription>
          Documents, API keys, usage, and webhooks belong to an organization. You become its owner.
        </CardDescription>
      </CardHeader>
      <form onSubmit={(event) => void submit(event)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="organization-name">Organization name</Label>
            <Input
              id="organization-name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Inc."
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Create organization
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
