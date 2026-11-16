import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata = {
  title: "DocuFlow AI",
  description: "Upload documents, extract structured data, and track usage.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
