# Shard Launcher (Codex Context)

## Sync note
If you update this file, also update `.claude/CLAUDE.md` and `.cursor/rules/context.mdx` to keep contexts aligned.

## Overview
Shard is a minimal, clean, CLI-first Minecraft launcher focused on stability, reproducibility, and low duplication. The core library and CLI are in Rust; the optional desktop UI is built with Tauri + React.

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

## Code map (Rust)
- `src/lib.rs`: core library entry point, re-exports all modules.
- `src/main.rs`: CLI entry point with subcommands.
- `src/profile.rs`: profile management and serialization.
- `src/template.rs`: profile templates for quick setup.
- `src/store.rs`: content-addressed store operations.
- `src/content_store.rs`: unified content store abstraction.
- `src/library.rs`: global library/content management.
- `src/instance.rs`: instance materialization from profiles.
- `src/minecraft.rs`: version/library/asset downloads.
- `src/modrinth.rs`: Modrinth API client for mod search/install.
- `src/curseforge.rs`: CurseForge API client for mod search/install.
- `src/ops.rs`: higher-level operations (download, install, launch).
- `src/auth.rs`: Microsoft OAuth device code flow.
- `src/accounts.rs`: account storage + selection.
- `src/skin.rs`: Minecraft skin fetching and upload.
- `src/java.rs`: Java runtime detection and management.
- `src/config.rs`: global configuration handling.
- `src/paths.rs`: data path helpers.
- `src/logs.rs`: logging infrastructure.
- `src/updates.rs`: update checking functionality.
- `src/util.rs`: shared helpers.

## Code map (UI)
- `ui/src/App.tsx`: main application component, routing, modal management.
- `ui/src/store.ts`: Zustand state management.
- `ui/src/styles.css`: design tokens, theme variables, component styles.
- `ui/src/components/Sidebar.tsx`: navigation sidebar with profile selector, drag-and-drop folders.
- `ui/src/components/ProfileView.tsx`: profile details, content management, launch controls.
- `ui/src/components/StoreView.tsx`: Modrinth/CurseForge mod browser with search and install.
- `ui/src/components/LibraryView.tsx`: global content library browser.
- `ui/src/components/AccountView.tsx`: account details and skin management.
- `ui/src/components/LogsView.tsx`: live game log viewer.
- `ui/src/components/SkinViewer.tsx`: 3D Minecraft skin renderer.
- `ui/src/components/PlatformIcon.tsx`: Modrinth/CurseForge/Local platform icons.
- `ui/src/components/modals/`: modal dialogs for various actions.

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

## Environment
- **Config location**: `~/.shard/`.
- **UI dev server**: `http://localhost:1420`.

## Build Profiles

| Profile | Command | Use Case |
|---------|---------|----------|
| `dev` | `cargo tauri dev` | Development, debugging (DEFAULT) |
| `dev-release` | `cargo tauri build --profile dev-release` | Testing builds (~30s) |
| `release` | `cargo tauri build --release` | Production only (~3-5min) |

## UI Design
- Design tokens in `ui/src/styles.css` (warm dark palette, Geist fonts).
- Custom CSS with CSS variables, not Tailwind.
- Border-radius scale: 4px (tiny), 6px (small), 8px (medium), 10px (standard), 12px (large).
