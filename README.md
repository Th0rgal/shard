<p align="center">
  <img src="logo.png" alt="Shard Launcher" width="256" height="256">
</p>

<h1 align="center">Shard</h1>

<p align="center">
  <strong>Reproducible profiles. One deduplicated library. Scriptable workflows.</strong><br>
  <em>Open source. Built in Rust with Tauri.</em>
</p>

<p align="center">
  <a href="https://github.com/Th0rgal/shard/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/Th0rgal/shard"><img src="https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri-orange.svg" alt="Built with Rust + Tauri"></a>
  <a href="https://github.com/Th0rgal/shard/releases"><img src="https://img.shields.io/github/v/release/Th0rgal/shard?include_prereleases" alt="Release"></a>
</p>

<p align="center">
  <a href="#what-is-shard">What is Shard?</a> •
  <a href="#why-shard">Why Shard?</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#commands">Commands</a>
</p>

---

## What is Shard?

Shard is an open-source Minecraft launcher with a global deduplicated library and declarative profiles (plain JSON). It materializes clean instances from a single source of truth, integrates with Modrinth and CurseForge, and supports scriptable workflows via a CLI while providing a polished desktop experience.

**Define profiles in plain JSON, install content from Modrinth/CurseForge, and launch clean instances without duplicating the same mods across every pack.**

## Why Shard?

### Performance & Polish

- **Fast, lightweight desktop app**: Built in Rust with Tauri for minimal resource usage
- **No hidden state**: Plain JSON on disk, predictable directory layout, fully inspectable
- **Global deduplication**: Mods stored once by SHA-256 hash, shared across all profiles

### Transparency & Trust

- **Open source**: Inspect every line of code, contribute, or fork
- **No telemetry**: Your data stays local, no launcher account required
- **Works offline**: Launch games without an internet connection (after initial setup)

### Features

| Feature | What it means for you |
|---------|----------------------|
| **Content-Addressed Store** | Install the same mod in 10 profiles, it's stored once. No wasted disk space. |
| **Declarative Profiles** | Your setup is a JSON file. Version control it, share it, restore it anytime. |
| **Multi-Account** | Switch between Microsoft accounts instantly with secure token storage. |
| **Modrinth + CurseForge** | Search and install from both platforms without leaving the app. |
| **Fabric, Forge, Quilt, NeoForge** | All major mod loaders with automatic version resolution. |
| **CLI + Desktop** | A polished desktop UI for everyday play, backed by a serious CLI for scripting. |

## Installation

### Prerequisites

- **Rust** (1.75+): Install via [rustup.rs](https://rustup.rs)
- **Bun** (or Node.js 18+): For the desktop UI frontend
- **Platform tools:**
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `build-essential`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`
  - Windows: Visual Studio Build Tools with C++ workload

### Build from Source

```bash
# Clone the repository
git clone https://github.com/Th0rgal/shard.git
cd shard

# Build CLI only
cd launcher
cargo build --release
# Binary: target/release/shard

# Build Desktop App
cd desktop
bun install              # Install frontend dependencies
cargo tauri build        # Build production app
# App bundle: desktop/src-tauri/target/release/bundle/
```

### Install or Update

**CLI (all platforms):**
```bash
# Install to ~/.local/bin (add to PATH if needed)
mkdir -p ~/.local/bin
cp target/release/shard ~/.local/bin/

# Or install system-wide (requires sudo)
sudo cp target/release/shard /usr/local/bin/

# Verify installation
shard --version
```

**Desktop App (macOS):**
```bash
# The app bundle is at:
# target/release/bundle/macos/Shard Launcher.app

# Install to Applications (replaces existing)
rm -rf "/Applications/Shard Launcher.app"
cp -r "target/release/bundle/macos/Shard Launcher.app" /Applications/

# Or open directly
open "target/release/bundle/macos/Shard Launcher.app"
```

**Desktop App (Linux):**
```bash
# AppImage (portable)
chmod +x desktop/src-tauri/target/release/bundle/appimage/shard_*.AppImage
./desktop/src-tauri/target/release/bundle/appimage/shard_*.AppImage

# Or install .deb package
sudo dpkg -i desktop/src-tauri/target/release/bundle/deb/shard_*.deb
```

**Desktop App (Windows):**
```powershell
# Run the MSI installer
desktop\src-tauri\target\release\bundle\msi\Shard_*.msi

# Or run the executable directly
desktop\src-tauri\target\release\Shard.exe
```

### Development Mode

```bash
# Run CLI in development
cd launcher && cargo run -- --help

# Run Desktop App with hot reload
cd desktop && bun install && cargo tauri dev
```

## Quick Start

```bash
# Add your Microsoft account
shard account add

# Create a Fabric 1.21.4 profile
shard profile create my-profile --mc 1.21.4 --loader fabric

# Add a mod from Modrinth
shard mod add my-profile sodium

# Launch
shard launch my-profile
```

## Architecture

Shard treats your game setup like code: **declarative**, **reproducible**, and **efficient**.

| Principle | Implementation |
|-----------|----------------|
| **Single source of truth** | Profiles are JSON manifests. Instances are derived artifacts, regenerated on demand. |
| **Deduplication** | SHA-256 content-addressed store. One file, infinite profiles. |
| **No magic** | Plain JSON on disk. Predictable layout. Fully inspectable state. |
| **Modular** | Auth, Minecraft data, and profiles are isolated. Swap or extend without breaking everything. |
| **CLI-first** | Every feature works from the command line. Script it, automate it, pipe it. |

## Commands

### Profiles
```bash
shard list                                    # List all profiles
shard profile create <id> --mc <version>      # Create profile
shard profile create <id> --mc 1.21.4 --loader fabric
shard profile clone <src> <dst>               # Clone profile
shard profile show <id>                       # Show profile details
shard profile diff <a> <b>                    # Compare profiles
```

### Content
```bash
shard mod add <profile> <file|url|slug>       # Add mod
shard mod remove <profile> <name|hash>        # Remove mod
shard mod list <profile>                      # List mods

shard resourcepack add <profile> <input>      # Add resourcepack
shard shaderpack add <profile> <input>        # Add shaderpack
```

### Store
```bash
shard store search <query>                    # Search Modrinth + CurseForge
shard store search <query> --platform modrinth
shard store info <platform> <project-id>      # Project details
shard store install <profile> <platform> <project-id>
```

### Accounts
```bash
shard account add                             # Add Microsoft account
shard account list                            # List accounts
shard account use <username>                  # Set active account
shard account remove <username>               # Remove account
```

### Launch
```bash
shard launch <profile>                        # Launch game
shard launch <profile> --account <username>   # Launch with specific account
shard launch <profile> --prepare-only         # Prepare without launching
```

## Data Layout

```
~/.shard/
├── store/                    # Content-addressed storage
│   ├── mods/sha256/
│   ├── resourcepacks/sha256/
│   └── shaderpacks/sha256/
├── profiles/                 # Profile manifests
│   └── <id>/profile.json
├── instances/                # Materialized game directories
├── minecraft/                # Versions, libraries, assets
├── accounts.json             # Account tokens (keep private)
└── config.json               # Launcher settings
```

## Configuration

Shard uses Microsoft OAuth for authentication. Set your client credentials via environment or config:

```bash
# Environment variables
export SHARD_MS_CLIENT_ID="your-client-id"
export SHARD_MS_CLIENT_SECRET="your-client-secret"  # if required

# Or via CLI
shard config set-client-id <your-client-id>
```

For CurseForge API access:
```bash
export SHARD_CURSEFORGE_API_KEY="your-api-key"
```

## License

MIT

---

<p align="center">
  <sub>Built by <a href="https://thomas.md">@Th0rgal</a></sub><br>
  <sub>
    <a href="https://oraxen.com">Oraxen</a> •
    <a href="https://hackedserver.org">HackedServer</a> •
    <a href="https://asyncanticheat.com">AsyncAntiCheat</a>
  </sub>
</p>
