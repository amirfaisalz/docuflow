"use client";

import { FileTextIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const { ready, token, login, register } = useAuth();
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && token) router.replace("/dashboard");
  }, [ready, token, router]);

  async function submit(event: FormEvent<HTMLFormElement>, mode: "login" | "register") {
    event.preventDefault();
    setError(null);
    if (mode === "register" && password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    setPending(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password, name.trim() || undefined);
      router.replace("/dashboard");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10">
            <FileTextIcon className="size-5" />
          </span>
          DocuFlow AI
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight">
            Turn documents into structured data.
          </h1>
          <p className="max-w-md text-primary-foreground/70">
            Upload PDFs and images, let AI extract the fields you need, and track every job, API call,
            and webhook delivery from one dashboard.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/60">Multi-tenant by design. API-first underneath.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-0 shadow-none sm:border sm:shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Welcome to DocuFlow</CardTitle>
            <CardDescription>Sign in or create an account to reach your dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={tab}
              onValueChange={(value) => {
                setTab(value);
                setError(null);
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Sign in</TabsTrigger>
                <TabsTrigger value="register">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-4">
                <form className="space-y-4" onSubmit={(event) => void submit(event, "login")}>
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                  {error ? (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button type="submit" className="w-full" disabled={pending}>
                    {pending ? <Loader2Icon className="size-4 animate-spin" /> : null}
                    Sign in
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register" className="mt-4">
                <form className="space-y-4" onSubmit={(event) => void submit(event, "register")}>
                  <div className="space-y-2">
                    <Label htmlFor="register-name">Name (optional)</Label>
                    <Input
                      id="register-name"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Ada Lovelace"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <Input
                      id="register-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">Password</Label>
                    <Input
                      id="register-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">At least 12 characters.</p>
                  </div>
                  {error ? (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button type="submit" className="w-full" disabled={pending}>
                    {pending ? <Loader2Icon className="size-4 animate-spin" /> : null}
                    Create account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
