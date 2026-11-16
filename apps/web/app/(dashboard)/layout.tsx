"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { CreateOrganizationCard } from "@/components/create-organization-card";
import { useAuth } from "@/components/auth-provider";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const titles: Array<{ prefix: string; title: string; href: string }> = [
  { prefix: "/documents", title: "Documents", href: "/documents" },
  { prefix: "/api-keys", title: "API keys", href: "/api-keys" },
  { prefix: "/usage", title: "Usage", href: "/usage" },
  { prefix: "/webhooks", title: "Webhooks", href: "/webhooks" },
  { prefix: "/settings", title: "Settings", href: "/settings" },
  { prefix: "/dashboard", title: "Overview", href: "/dashboard" },
];

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2Icon className="size-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, token, organizations, organizationsLoading, organization } = useAuth();

  useEffect(() => {
    if (ready && !token) router.replace("/login");
  }, [ready, token, router]);

  if (!ready || (token && organizationsLoading && organizations.length === 0)) {
    return <Splash label="Loading your workspace…" />;
  }

  if (!token) return <Splash label="Redirecting to sign in…" />;

  const current = titles.find((item) => pathname.startsWith(item.prefix)) ?? titles[titles.length - 1];

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <Link href="/dashboard">{organization?.name ?? "Workspace"}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{current.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          {organization ? (
            <Badge variant="secondary" className="mr-4 capitalize">
              {organization.role.toLowerCase()}
            </Badge>
          ) : null}
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          {organizations.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <CreateOrganizationCard />
            </div>
          ) : (
            children
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
