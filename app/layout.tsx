import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twofold | Post to X and LinkedIn",
  description: "A private, lightweight composer for publishing to X and LinkedIn.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
