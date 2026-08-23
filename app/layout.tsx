import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bookly Concierge",
  description: "Bookly customer support concierge prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
