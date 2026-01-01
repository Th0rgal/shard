# Package Manager Manifests

This directory contains manifest templates for various package managers. After each release, update these manifests with the new version and SHA256 hashes from `SHA256SUMS.txt` in the release.

## Status

| Package Manager | Type | Status | Installation Command |
|-----------------|------|--------|---------------------|
| **Homebrew** | CLI + Desktop | Ready | `brew tap th0rgal/shard && brew install shard` |
| **Winget** | Desktop | Template | `winget install Th0rgal.ShardLauncher` |
| **Scoop** | CLI | Template | `scoop bucket add shard https://github.com/th0rgal/scoop-shard && scoop install shard` |
| **AUR** | CLI + Desktop | Template | `yay -S shard` / `yay -S shard-launcher-bin` |
| **Flathub** | Desktop | Template | `flatpak install flathub sh.shard.launcher` |

## Updating After Release

### Homebrew (th0rgal/homebrew-shard)

1. Get SHA256 hashes from the release's `SHA256SUMS.txt`
2. Update `Formula/shard.rb` and `Casks/shard-launcher.rb` with new version and hashes
3. Push to the tap repository

### Winget

1. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
2. Copy `winget/` manifest to `manifests/t/Th0rgal/ShardLauncher/<version>/`
3. Update version, URLs, and SHA256 hashes
4. Submit PR

### Scoop

1. Create a `scoop-shard` bucket repository (similar to homebrew tap)
2. Update `shard.json` with new version and hash
3. Push to bucket repository

### AUR

1. Update PKGBUILDs with new version and hashes
2. Use `makepkg --printsrcinfo > .SRCINFO` to regenerate
3. Push to AUR git repositories

### Flathub

1. Fork [flathub/flathub](https://github.com/flathub/flathub) for initial submission
2. Update manifest with new version and hash
3. Submit PR
