import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Head } from "nextra/components";
import { ThemeProvider } from "@/components/theme-provider";
import { JsonLd } from "@/components/JsonLd";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0c0b0a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://shard.sh"),
  title: {
    default: "Shard Launcher",
    template: "%s | Shard Launcher",
  },
  description:
    "A minimal, content-addressed Minecraft launcher focused on stability and reproducibility. One library. Infinite profiles.",
  applicationName: "Shard Launcher",
  generator: "Next.js",
  keywords: [
    "minecraft",
    "launcher",
    "mod manager",
    "fabric",
    "forge",
    "quilt",
    "neoforge",
    "modrinth",
    "curseforge",
    "open source",
  ],
  authors: [{ name: "Thomas Marchand", url: "https://thomas.md" }],
  creator: "Thomas Marchand",
  publisher: "Shard",
  robots: {
    index: true,
    follow: true,
  },
  twitter: {
    card: "summary_large_image",
    title: "Shard Launcher",
    description:
      "A minimal, content-addressed Minecraft launcher. One library. Infinite profiles.",
    creator: "@music_music_yo",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://shard.sh",
    siteName: "Shard Launcher",
    title: "Shard Launcher",
    description:
      "A minimal, content-addressed Minecraft launcher focused on stability and reproducibility. One library. Infinite profiles.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  // Safari-specific
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Shard",
  },
  // Additional meta for better integration
  other: {
    "msapplication-TileColor": "#0c0b0a",
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <JsonLd />
        {/* Additional theme-color variants for different contexts */}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#0c0b0a"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#0c0b0a"
        />
      </Head>
      <body className="min-h-dvh bg-mesh-subtle">
        <GoogleAnalytics />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
