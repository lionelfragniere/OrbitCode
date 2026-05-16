import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrbitCode - Local AI Coding Workspace",
  description: "OrbitCode - local AI coding workspace with pluggable providers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
