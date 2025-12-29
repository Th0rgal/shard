# Shard Launcher

## Sync note
If you update this file, also update `.codex/CODEX.md` to keep Claude/Codex context aligned.

## Overview
Shard is a minimal, clean, CLI-first Minecraft launcher focused on stability, reproducibility, and low duplication. The core library and CLI are in Rust; the optional desktop UI is built with Tauri + React.

| Directory | Tech Stack | Purpose |
|-----------|------------|---------|
| `/` (root) | Rust | Core library + CLI (profiles, store, downloads, launching) |
| `ui/` | Tauri 2, React, TypeScript, Tailwind, Vite | Desktop application UI |
| `ui/src-tauri/` | Rust | Tauri backend (bridge to core library) |

## Philosophy
- **Single source of truth**: profiles are declarative manifests; instances are derived artifacts.
- **Deduplication first**: mods and packs live in a content-addressed store (SHA-256); profiles only reference hashes.
- **Stable + boring**: plain JSON on disk, predictable layout, no magic state.
- **Replaceable parts**: authentication, Minecraft data, and profile management are isolated modules.
- **CLI-first**: everything is designed to be scripted and composed.

## Architecture (core concepts)
- **Profiles** (`profiles/<id>/profile.json`): manifest for version + mod/pack selection + runtime flags.
- **Stores** (`store/*/sha256/`): content-addressed blobs for mods, resourcepacks, shaderpacks.
- **Instances** (`instances/<id>/`): launchable game dirs (symlinked mods/packs + overrides).
- **Minecraft data** (`minecraft/`): versions, libraries, assets, natives.
- **Accounts** (`accounts.json`): multiple Microsoft accounts with refresh + access tokens.

## Launch flow
1. Read profile manifest.
2. Resolve Minecraft version (vanilla or Fabric loader).
3. Download version JSON + client jar (cached).
4. Download libraries + extract natives.
5. Download asset index + assets.
6. Materialize instance (mods/packs + overrides).
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
# Development (fast, debug symbols)
cargo build
cargo run -- <args>

# Testing with optimization
cargo build --profile dev-release

# Production (full optimization)
cargo build --release
```

### UI Application
```bash
cd ui

# Install frontend dependencies
bun install

# Development mode (fast iteration)
cargo tauri dev

# Build for testing (faster compile)
cargo tauri build --profile dev-release

# Production build (full optimization)
cargo tauri build --release
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
- **UI dev server**: `http://localhost:1420`

## UI Design

- Design tokens and theme variables live in `ui/src/styles.css` (warm dark palette, Geist fonts).
- Keep UI visuals aligned with the CSS variables in that file.

## AI Agent Guidelines

1. **Build commands**: Always use `cargo tauri dev` for UI development, not `cargo build`.
2. **Profile usage**: Default to `dev` profile for iteration; use `dev-release` for quick test builds; `release` for production.
3. **Avoid generated dirs**: `**/target/`, `**/node_modules/`, `**/dist/`.
4. **Frontend changes**: Edit `ui/src/` files; Tauri backend in `ui/src-tauri/`.
5. **Core library**: Edit root `src/` files; shared between CLI and UI.
6. **Keep contexts aligned**: Update `.codex/CODEX.md` when this file changes.

## Testing

```bash
# Core library
cargo check
cargo test

# UI (check Rust compilation)
cd ui && cargo tauri dev

# Frontend only
cd ui && bun run dev
```
