import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Pair deliberately: Inter for body/UI (clean, boring, legible -- the right
// choice when the display face is already carrying personality) + JetBrains
// Mono for display and every identifier (emails, paths, hashes, keyIds).
// Mono as the display face signals "this product counts bytes", which is
// what an envelope-encryption control plane is actually about.

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SecretOps",
  description: "Self-hosted secrets management control plane.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-theme="dark" locks the dark token set. The light block in
  // globals.css is a documented no-op until a future toggle flips it.
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-slab text-ink">{children}</body>
    </html>
  );
}
