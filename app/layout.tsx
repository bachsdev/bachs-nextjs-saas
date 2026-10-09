import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Acme Pro",
  description: "A Next.js SaaS starter with Bachs subscriptions.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
