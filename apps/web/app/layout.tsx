import type { ReactNode } from "react";

export const metadata = {
  title: "DocuFlow AI",
  description: "AI-powered document processing platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
