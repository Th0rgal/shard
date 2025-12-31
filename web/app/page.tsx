"use client";

import Link from "next/link";
import { useState } from "react";
import {
  RiGithubFill,
  RiDiscordFill,
  RiBookOpenLine,
  RiArrowRightLine,
  RiMenuLine,
  RiCloseLine,
  RiShieldCheckLine,
  RiAppleFill,
  RiSaveLine,
} from "@remixicon/react";
import { LauncherPreview } from "@/components/launcher-hero";

// Feature Card Component
function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="group rounded-lg surface-1 p-5 border border-[rgb(var(--border))] hover:border-[rgb(var(--border-elevated))] transition-colors">
      <div className="mb-3 inline-flex rounded-md bg-[rgb(var(--accent))]/10 p-2">
        <Icon className="h-5 w-5 text-[rgb(var(--accent))]" />
      </div>
      <h3 className="mb-1.5 text-sm font-semibold text-[rgb(var(--foreground))]">
        {title}
      </h3>
      <p className="text-sm text-[rgb(var(--foreground-secondary))] leading-relaxed">
        {description}
      </p>
    </div>
  );
}

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen surface-0">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-[rgb(var(--border))]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-lg font-semibold text-[rgb(var(--foreground))]">
              Shard
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="https://github.com/Th0rgal/shard"
              className="text-xs font-medium text-[rgb(var(--foreground-secondary))] hover:text-[rgb(var(--foreground))] transition-colors"
            >
              GitHub
            </Link>
            <Link
              href="https://discord.gg/2ng6q3JNQ7"
              className="text-xs font-medium text-[rgb(var(--foreground-secondary))] hover:text-[rgb(var(--foreground))] transition-colors"
            >
              Discord
            </Link>
            <Link
              href="/docs"
              className="text-xs font-medium text-[rgb(var(--foreground-secondary))] hover:text-[rgb(var(--foreground))] transition-colors"
            >
              Documentation
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/docs"
              className="hidden sm:inline-flex items-center rounded-md bg-[rgb(var(--accent))] px-3 py-1.5 text-xs font-medium text-white hover:bg-[rgb(var(--accent-hover))] transition-colors"
            >
              View Docs
            </Link>
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-md hover:bg-[rgb(var(--foreground))]/10 transition-colors"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? (
                <RiCloseLine className="h-5 w-5 text-[rgb(var(--foreground))]" />
              ) : (
                <RiMenuLine className="h-5 w-5 text-[rgb(var(--foreground))]" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[rgb(var(--border))] surface-1 animate-fade-in">
            <nav className="mx-auto max-w-5xl px-4 py-3 flex flex-col gap-1">
              <Link
                href="https://github.com/Th0rgal/shard"
                className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-[rgb(var(--foreground-secondary))] hover:text-[rgb(var(--foreground))] hover:bg-[rgb(var(--foreground))]/5 transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                <RiGithubFill className="h-4 w-4" />
                GitHub
              </Link>
              <Link
                href="https://discord.gg/2ng6q3JNQ7"
                className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-[rgb(var(--foreground-secondary))] hover:text-[rgb(var(--foreground))] hover:bg-[rgb(var(--foreground))]/5 transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                <RiDiscordFill className="h-4 w-4" />
                Discord
              </Link>
              <Link
                href="/docs"
                className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-[rgb(var(--foreground-secondary))] hover:text-[rgb(var(--foreground))] hover:bg-[rgb(var(--foreground))]/5 transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                <RiBookOpenLine className="h-4 w-4" />
                Documentation
              </Link>
              <div className="mt-2 pt-2 border-t border-[rgb(var(--border))]">
                <Link
                  href="/docs"
                  className="flex items-center justify-center rounded-md bg-[rgb(var(--accent))] px-3 py-2.5 text-sm font-medium text-white hover:bg-[rgb(var(--accent-hover))] transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  View Docs
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main>
        {/* Hero Section */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold text-[rgb(var(--foreground))] mb-4">
              A Minecraft Launcher Built Different
            </h1>
            <p className="text-lg text-[rgb(var(--foreground-secondary))] max-w-2xl mx-auto mb-8">
              Your mods, organized. Your disk space, respected.
            </p>

            {/* Download buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
              <Link
                href="https://github.com/Th0rgal/shard/releases/latest"
                className="inline-flex items-center gap-2 rounded-md bg-[rgb(var(--accent))] px-5 py-2.5 text-sm font-medium text-white hover:bg-[rgb(var(--accent-hover))] transition-colors"
              >
                <RiAppleFill className="h-4 w-4" />
                Download for macOS
              </Link>
              <Link
                href="https://thomas.md/beta"
                className="inline-flex items-center gap-2 rounded-md border border-[rgb(var(--border))] surface-1 px-5 py-2.5 text-sm font-medium text-[rgb(var(--foreground-secondary))] hover:border-[rgb(var(--border-elevated))] hover:text-[rgb(var(--foreground))] transition-colors"
              >
                <RiArrowRightLine className="h-4 w-4" />
                Join the Beta
              </Link>
            </div>
          </div>

          {/* Launcher Preview */}
          <LauncherPreview />
        </section>

        {/* Features Section */}
        <section className="mx-auto max-w-5xl px-4 py-12">
          <div className="text-center mb-8">
            <span className="inline-block rounded-md bg-[rgb(var(--accent))]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--accent))]">
              Features
            </span>
            <h2 className="mt-3 text-xl font-semibold text-[rgb(var(--foreground))]">
              Why choose Shard?
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 max-w-2xl mx-auto">
            <FeatureCard
              icon={RiSaveLine}
              title="Save Disk Space"
              description="Mods are stored once and shared across profiles. No more duplicate files eating up your drive."
            />
            <FeatureCard
              icon={RiShieldCheckLine}
              title="Always Works"
              description="Your setup is saved as a profile. Share it, back it up, restore it—it just works."
            />
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-[rgb(var(--border))]">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="flex flex-col items-center justify-between gap-3 md:flex-row">
            <p className="text-xs text-[rgb(var(--foreground-muted))]">
              © {new Date().getFullYear()}{" "}
              <Link
                href="https://thomas.md"
                className="text-[rgb(var(--foreground-tertiary))] hover:text-[rgb(var(--foreground-secondary))] transition-colors"
              >
                Thomas Marchand
              </Link>
            </p>
            <Link
              href="https://github.com/Th0rgal/shard"
              className="text-[rgb(var(--foreground-muted))] hover:text-[rgb(var(--foreground-tertiary))] transition-colors"
            >
              <RiGithubFill className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
