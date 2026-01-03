# Shard Launcher

## Sync note
If you update this file, also update `.codex/CODEX.md` and `.cursor/rules/context.mdx` to keep contexts aligned.

## Overview
Shard is a minimal, clean, CLI-first Minecraft launcher focused on stability, reproducibility, and low duplication.

| Directory | Tech Stack | Purpose |
|-----------|------------|---------|
| `launcher/` | Rust | Core library + CLI (profiles, store, downloads, launching) |
| `desktop/` | Tauri 2, React, TypeScript, Vite | Desktop application UI |
| `desktop/src-tauri/` | Rust | Tauri backend (bridge to core library) |
| `web/` | Next.js 16, React 19, Nextra | Website + documentation |
| `companion/` | (placeholder) | Future companion mode |

## Philosophy
- **Single source of truth**: profiles are declarative manifests; instances are derived artifacts.
- **Deduplication first**: mods and packs live in a content-addressed store (SHA-256); profiles only reference hashes.
- **Stable + boring**: plain JSON on disk, predictable layout, no magic state.
- **Replaceable parts**: authentication, Minecraft data, and profile management are isolated modules.
- **CLI-first**: everything is designed to be scripted and composed.

## Architecture (core concepts)
- **Profiles** (`profiles/<id>/profile.json`): manifest for version + mod/pack selection + runtime flags.
- **Templates** (`templates/<id>/template.json`): reusable profile configurations (Fabric, Forge, etc.).
- **Stores** (`store/*/sha256/`): content-addressed blobs for mods, resourcepacks, shaderpacks.
- **Library** (global content cache): deduplicated content across all profiles.
- **Instances** (`instances/<id>/`): launchable game dirs (symlinked mods/packs + overrides).
- **Minecraft data** (`minecraft/`): versions, libraries, assets, natives.
- **Accounts** (`accounts.json`): multiple Microsoft accounts with refresh + access tokens.

## Code map (Rust - launcher/)
- `launcher/src/lib.rs`: core library entry point, re-exports all modules.
- `launcher/src/main.rs`: CLI entry point with subcommands.
- `launcher/src/profile.rs`: profile management and serialization.
- `launcher/src/template.rs`: profile templates for quick setup.
- `launcher/src/store.rs`: content-addressed store operations.
- `launcher/src/content_store.rs`: unified content store abstraction.
- `launcher/src/library.rs`: global library/content management, enrichment from profiles, unused content detection.
- `launcher/src/instance.rs`: instance materialization from profiles.
- `launcher/src/minecraft.rs`: version/library/asset downloads, loader version fetching (Fabric, Forge, Quilt, NeoForge).
- `launcher/src/modrinth.rs`: Modrinth API client for mod search/install.
- `launcher/src/curseforge.rs`: CurseForge API client for mod search/install.
- `launcher/src/ops.rs`: higher-level operations (download, install, launch).
- `launcher/src/auth.rs`: Microsoft OAuth device code flow.
- `launcher/src/accounts.rs`: account storage + selection.
- `launcher/src/skin.rs`: Minecraft skin fetching and upload.
- `launcher/src/java.rs`: Java runtime detection and management.
- `launcher/src/config.rs`: global configuration handling.
- `launcher/src/paths.rs`: data path helpers.
- `launcher/src/logs.rs`: logging infrastructure.
- `launcher/src/updates.rs`: update checking functionality.
- `launcher/src/util.rs`: shared helpers.

## Code map (Desktop - desktop/)
- `desktop/src/App.tsx`: main application component, routing, modal management.
- `desktop/src/store/index.ts`: Zustand state management.
- `desktop/src/styles.css`: design tokens, theme variables, component styles.
- `desktop/src/components/Sidebar.tsx`: navigation sidebar with profile selector, drag-and-drop folders.
- `desktop/src/components/ProfileView.tsx`: profile details, content management, launch controls.
- `desktop/src/components/StoreView.tsx`: Modrinth/CurseForge mod browser with search and install.
- `desktop/src/components/LibraryView.tsx`: global content library browser with collapsible search and sticky details panel.
- `desktop/src/components/AccountView.tsx`: account details, skin management, skin URL import, cape preview.
- `desktop/src/components/AccountsView.tsx`: account list and switching.
- `desktop/src/components/LogsView.tsx`: live game log viewer.
- `desktop/src/components/SettingsView.tsx`: application settings with storage cleanup section.
- `desktop/src/components/SkinViewer.tsx`: 3D Minecraft skin and cape renderer.
- `desktop/src/components/SkinThumbnail.tsx`: compact skin preview thumbnail component.
- `desktop/src/components/ContentItemRow.tsx`: compact content item display with platform links.
- `desktop/src/components/PlatformIcon.tsx`: Modrinth/CurseForge/Local platform icons.
- `desktop/src/components/Modal.tsx`: base modal component with close button.
- `desktop/src/components/modals/`: modal dialogs for various actions.
- `desktop/src/components/modals/PurgeStorageModal.tsx`: unused content detection and cleanup.
- `desktop/src/components/modals/ProfileJsonModal.tsx`: profile JSON viewer with syntax highlighting and copy button.

## Code map (Web - web/)
- `web/app/page.tsx`: homepage with launcher preview hero and rotating taglines.
- `web/app/layout.tsx`: root layout with theme provider, JSON-LD, and analytics.
- `web/app/sitemap.ts`: dynamic sitemap generation for SEO.
- `web/app/opengraph-image.tsx`: dynamic Open Graph image generation.
- `web/app/twitter-image.tsx`: dynamic Twitter card image generation.
- `web/app/docs/[[...mdxPath]]/page.tsx`: Nextra documentation routing.
- `web/content/`: MDX documentation files.
- `web/components/launcher-hero/`: Interactive launcher preview component.
- `web/components/theme-provider.tsx`: Next-themes provider.
- `web/components/JsonLd.tsx`: JSON-LD structured data for SEO.
- `web/components/GoogleAnalytics.tsx`: Google Analytics integration.
- `web/public/robots.txt`: crawler directives.
- `web/public/fonts/`: Geist font files.

## Launch flow
1. Read profile manifest.
2. Resolve Minecraft version (vanilla or loader like Fabric/Forge).
3. Download version JSON + client jar (cached).
4. Download libraries + extract natives.
5. Download asset index + assets.
6. Materialize instance (mods/packs + overrides from store).
7. Build JVM + game args from version JSON.
8. Launch Java process.

## Data layout
```
~/.shard/
  store/
    mods/sha256/<hash>
    resourcepacks/sha256/<hash>
    shaderpacks/sha256/<hash>
  profiles/
    <profile-id>/profile.json
    <profile-id>/overrides/
  templates/
    <template-id>/template.json
  instances/
    <profile-id>/
  minecraft/
    versions/<version>/<version>.json
    versions/<version>/<version>.jar
    libraries/
    assets/objects/<hash>
    assets/indexes/<index>.json
  caches/
    downloads/
    manifests/
  accounts.json
  config.json
  logs/
```

## Commands

### Core Library (CLI)
```bash
cd launcher

# Development (fast, debug symbols)
cargo build
cargo run -- <args>

# Testing with optimization
cargo build --profile dev-release

# Production (full optimization)
cargo build --release
```

### Desktop Application
```bash
cd desktop

# Install frontend dependencies
bun install

# Development mode (fast iteration)
cargo tauri dev

# Build for testing (faster compile)
cargo tauri build --profile dev-release

# Production build (full optimization)
cargo tauri build --release
```

### Local Installation

When asked to rebuild and reinstall locally, install **both** components:

```bash
# 1. Install CLI to ~/.cargo/bin (available system-wide)
cd launcher && cargo install --path . --force

# 2. Build and install Desktop app
cd desktop && bun install && cargo tauri build --release
# Then copy desktop/src-tauri/target/release/bundle/macos/*.app to /Applications/
```

**Important**: The CLI (`shard`) and Desktop app (`Shard Launcher.app`) are separate binaries. Always install both when updating locally.

### Website
```bash
cd web

# Install dependencies
bun install

# Development mode
bun run dev

# Build for production
bun run build

# Run tests
bun run test
```

## Build Profiles

| Profile | Command | Build Time | Use Case |
|---------|---------|------------|----------|
| `dev` | `cargo build` / `cargo tauri dev` | ~10s | Development, hot reload, debugging |
| `dev-release` | `cargo build --profile dev-release` | ~30s | Testing, iteration, quick validation |
| `release` | `cargo build --release` | ~3-5min | Production, final builds |

**When to use each:**
- **dev**: Use for all development with `cargo tauri dev`. Fast incremental builds, debug symbols, no optimization.
- **dev-release**: Use when you need a build to test but don't need full optimization. Good for sharing test builds.
- **release**: Use only for final production builds or performance-critical testing.

## Environment

- **Config location**: `~/.shard/` (profiles, store, caches)
- **Desktop dev server**: `http://localhost:1420`
- **Web dev server**: `http://localhost:3000`

## UI Design

### Desktop
- Design tokens and theme variables live in `desktop/src/styles.css` (warm dark palette, Geist fonts).
- Uses custom CSS with CSS variables, not Tailwind.
- Glassmorphism with `backdrop-filter: blur()` on elevated surfaces.
- Accent colors: `--accent-primary` (warm amber #e8a855).
- Border-radius scale: 4px (tiny), 6px (small), 8px (medium), 10px (standard), 12px (large containers).

### Web
- Design tokens in `web/app/globals.css` (warm dark palette matching desktop).
- Uses Tailwind CSS v4.
- Same warm amber accent colors as desktop.

## AI Agent Guidelines

1. **Build commands**: Always use `cargo tauri dev` for desktop development, not `cargo build`.
2. **Profile usage**: Default to `dev` profile for iteration; use `dev-release` for quick test builds; `release` for production.
3. **Avoid generated dirs**: `**/target/`, `**/node_modules/`, `**/dist/`, `**/.next/`.
4. **Desktop changes**: Edit `desktop/src/` files; Tauri backend in `desktop/src-tauri/`.
5. **Core library**: Edit `launcher/src/` files; shared between CLI and desktop.
6. **Website changes**: Edit `web/` files; docs content in `web/content/`.
7. **CSS**: Use CSS variables, maintain consistent border-radius and spacing.
8. **Keep contexts aligned**: Update `.codex/CODEX.md` and `.cursor/rules/context.mdx` when this file changes.

## Testing

```bash
# Core library
cd launcher && cargo check && cargo test

# Desktop (check Rust compilation)
cd desktop && cargo tauri dev

# Desktop frontend only
cd desktop && bun run dev

# Website
cd web && bun run dev

# Website tests (Playwright)
cd web && bun run test
```

## Releasing

### Release Workflow

Releases are automated via `.github/workflows/release.yml`. Pushing a tag triggers the build:

```bash
# Create and push a release tag
git tag v0.1.2
git push origin v0.1.2
```

The workflow builds:
- **CLI**: `shard-cli-{platform}.{tar.gz,zip}` for macOS (arm64/x64), Windows, Linux
- **Desktop**: `shard-launcher-{platform}.{dmg,msi,exe,AppImage,deb}`
- **Checksums**: `SHA256SUMS.txt`

### Release Artifacts

| Component | Platforms | Formats |
|-----------|-----------|---------|
| CLI | macOS ARM/Intel, Windows, Linux | `.tar.gz` (Unix), `.zip` (Windows) |
| Desktop | macOS ARM/Intel | `.dmg` |
| Desktop | Windows | `.msi`, `-setup.exe` |
| Desktop | Linux | `.AppImage`, `.deb` |

### Package Managers

| Manager | Package | Repository |
|---------|---------|------------|
| **Homebrew** | CLI + Desktop | [th0rgal/homebrew-shard](https://github.com/th0rgal/homebrew-shard) |
| **Winget** | Desktop | Template in `packaging/winget/` |
| **Scoop** | CLI | Template in `packaging/scoop/` |
| **AUR** | CLI + Desktop | Templates in `packaging/aur/` |
| **Flathub** | Desktop | Template in `packaging/flathub/` |

### Post-Release Checklist

1. Download `SHA256SUMS.txt` from the release
2. Update Homebrew tap with new version and hashes
3. Submit Winget PR to `microsoft/winget-pkgs`
4. Update Scoop bucket (if created)
5. Update AUR packages
6. Update Flathub manifest (if submitted)

### Links

- **Website**: https://shard.thomas.md
- **Repository**: https://github.com/th0rgal/shard
- **Releases**: https://github.com/th0rgal/shard/releases
- **Homebrew Tap**: https://github.com/th0rgal/homebrew-shard
