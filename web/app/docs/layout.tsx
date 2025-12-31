import type { ReactNode } from "react";
import { Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import "./docs.css";

// Custom logo component
function Logo() {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          fontWeight: 600,
          fontSize: 16,
          color: "rgba(245, 240, 235, 0.95)",
        }}
      >
        Shard
      </span>
    </div>
  );
}

export default async function DocsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const navbar = (
    <Navbar
      logo={<Logo />}
      logoLink="/docs"
      projectLink="https://github.com/Th0rgal/shard"
    />
  );
  // Get only the docs page map
  const pageMap = await getPageMap("/docs");
  return (
    <Layout
      navbar={navbar}
      editLink="Edit this page on GitHub"
      docsRepositoryBase="https://github.com/Th0rgal/shard/blob/main/web"
      sidebar={{ defaultMenuCollapseLevel: 1 }}
      pageMap={pageMap}
      footer={<DocsFooter />}
    >
      {children}
    </Layout>
  );
}

// Minimal footer
function DocsFooter() {
  return (
    <div
      style={{
        padding: "1.5rem 0",
        marginTop: "2rem",
        borderTop: "1px solid rgba(255, 248, 240, 0.06)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "0.75rem",
        color: "rgba(245, 240, 235, 0.3)",
      }}
    >
      <span>Shard Launcher</span>
      <a
        href="/"
        style={{
          color: "rgb(232, 168, 85)",
          textDecoration: "none",
          transition: "color 150ms ease",
        }}
      >
        Back to Home →
      </a>
    </div>
  );
}
