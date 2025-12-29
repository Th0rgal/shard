# Shard Launcher (Codex Context)

## Sync note
If you update this file, also update `.claude/CLAUDE.md` to keep Claude/Codex context aligned.

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

## Code map
- `src/lib.rs`: core library entry point.
- `src/main.rs`: CLI entry point.
- `src/profile.rs`: profile management.
- `src/store.rs`: content-addressed store.
- `src/instance.rs`: instance materialization.
- `src/minecraft.rs`: version/library/asset downloads.
- `src/ops.rs`: higher-level operations (download, install, launch).
- `src/auth.rs`: Microsoft auth flow.
- `src/accounts.rs`: account storage + selection.
- `src/config.rs`: configuration handling.
- `src/paths.rs`: data path helpers.
- `src/util.rs`: shared helpers.
- `ui/src/`: React frontend.
- `ui/src-tauri/`: Tauri backend + command bridge.

## Environment
- **Config location**: `~/.shard/`.
- **UI dev server**: `http://localhost:1420`.
