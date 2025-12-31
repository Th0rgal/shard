//! Content update checking and storage statistics
//!
//! This module provides functionality for:
//! - Checking for updates to mods, resourcepacks, and shaderpacks
//! - Calculating storage usage statistics
//! - Deduplication savings tracking

use crate::content_store::{ContentStore, ContentType, Platform};
use crate::paths::Paths;
use crate::profile::{ContentRef, Profile, load_profile, save_profile, list_profiles};
use anyhow::{Result, Context};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;

/// Storage statistics for the launcher
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageStats {
    /// Total storage used by all content (bytes)
    pub total_bytes: u64,
    /// Storage used by mods
    pub mods_bytes: u64,
    /// Storage used by resource packs
    pub resourcepacks_bytes: u64,
    /// Storage used by shader packs
    pub shaderpacks_bytes: u64,
    /// Storage used by skins
    pub skins_bytes: u64,
    /// Storage used by Minecraft versions/libraries/assets
    pub minecraft_bytes: u64,
    /// Storage used by the library database
    pub database_bytes: u64,
    /// Number of unique content items
    pub unique_items: u32,
    /// Number of profile references to content
    pub total_references: u32,
    /// Bytes saved through deduplication (total_references - unique_items) * avg_size
    pub deduplication_savings: u64,
}

/// A content item that has an available update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentUpdate {
    /// The profile this content belongs to
    pub profile_id: String,
    /// The content reference
    pub content: ContentRef,
    /// Type of content (mod, resourcepack, shaderpack)
    pub content_type: String,
    /// The current version
    pub current_version: Option<String>,
    /// The latest available version
    pub latest_version: String,
    /// The latest version ID (for installation)
    pub latest_version_id: String,
    /// Changelog or release notes (if available)
    pub changelog: Option<String>,
}

/// Result of checking for updates across all profiles
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateCheckResult {
    /// Content items with available updates
    pub updates: Vec<ContentUpdate>,
    /// Number of items checked
    pub checked: u32,
    /// Number of items that couldn't be checked (manual imports, etc.)
    pub skipped: u32,
    /// Errors encountered during checking
    pub errors: Vec<String>,
}

/// Calculate storage statistics
pub fn get_storage_stats(paths: &Paths) -> Result<StorageStats> {
    let mut stats = StorageStats::default();

    // Calculate store sizes
    stats.mods_bytes = dir_size(&paths.store_mods)?;
    stats.resourcepacks_bytes = dir_size(&paths.store_resourcepacks)?;
    stats.shaderpacks_bytes = dir_size(&paths.store_shaderpacks)?;
    stats.skins_bytes = dir_size(&paths.store_skins)?;

    // Calculate Minecraft data size
    let minecraft_root = paths.minecraft_versions.parent().unwrap_or(&paths.minecraft_versions);
    stats.minecraft_bytes = dir_size(minecraft_root)?;

    // Database size
    if paths.library_db.exists() {
        stats.database_bytes = fs::metadata(&paths.library_db)
            .map(|m| m.len())
            .unwrap_or(0);
    }

    // Total bytes
    stats.total_bytes = stats.mods_bytes
        + stats.resourcepacks_bytes
        + stats.shaderpacks_bytes
        + stats.skins_bytes
        + stats.minecraft_bytes
        + stats.database_bytes;

    // Count unique items and references
    let mut unique_hashes: HashSet<String> = HashSet::new();
    let mut hash_counts: HashMap<String, u32> = HashMap::new();

    // Count items in stores
    for (store_path, _) in [
        (&paths.store_mods, "mod"),
        (&paths.store_resourcepacks, "resourcepack"),
        (&paths.store_shaderpacks, "shaderpack"),
        (&paths.store_skins, "skin"),
    ] {
        if store_path.exists() {
            if let Ok(entries) = fs::read_dir(store_path) {
                for entry in entries.flatten() {
                    if entry.path().is_file() {
                        let hash = entry.file_name().to_string_lossy().to_string();
                        unique_hashes.insert(hash);
                    }
                }
            }
        }
    }

    // Count references in profiles
    if let Ok(profile_ids) = list_profiles(paths) {
        for id in profile_ids {
            if let Ok(profile) = load_profile(paths, &id) {
                for m in &profile.mods {
                    let hash = normalize_hash(&m.hash);
                    *hash_counts.entry(hash).or_insert(0) += 1;
                    stats.total_references += 1;
                }
                for r in &profile.resourcepacks {
                    let hash = normalize_hash(&r.hash);
                    *hash_counts.entry(hash).or_insert(0) += 1;
                    stats.total_references += 1;
                }
                for s in &profile.shaderpacks {
                    let hash = normalize_hash(&s.hash);
                    *hash_counts.entry(hash).or_insert(0) += 1;
                    stats.total_references += 1;
                }
            }
        }
    }

    stats.unique_items = unique_hashes.len() as u32;

    // Calculate deduplication savings
    // For each hash referenced more than once, we save (ref_count - 1) * file_size
    if stats.unique_items > 0 && stats.total_references > stats.unique_items {
        let avg_size = (stats.mods_bytes + stats.resourcepacks_bytes + stats.shaderpacks_bytes)
            .checked_div(stats.unique_items as u64)
            .unwrap_or(0);
        let duplicated_refs = stats.total_references.saturating_sub(stats.unique_items);
        stats.deduplication_savings = (duplicated_refs as u64) * avg_size;
    }

    Ok(stats)
}

/// Check for updates for all content in all profiles
pub fn check_all_updates(paths: &Paths, curseforge_api_key: Option<&str>) -> Result<UpdateCheckResult> {
    let mut result = UpdateCheckResult::default();
    let store = ContentStore::new(curseforge_api_key);

    let profile_ids = list_profiles(paths)?;

    for profile_id in profile_ids {
        let profile = match load_profile(paths, &profile_id) {
            Ok(p) => p,
            Err(e) => {
                result.errors.push(format!("Failed to load profile {}: {}", profile_id, e));
                continue;
            }
        };

        // Check mods
        check_content_updates(
            &store,
            &profile,
            &profile.mods,
            "mod",
            &mut result,
        );

        // Check resourcepacks
        check_content_updates(
            &store,
            &profile,
            &profile.resourcepacks,
            "resourcepack",
            &mut result,
        );

        // Check shaderpacks
        check_content_updates(
            &store,
            &profile,
            &profile.shaderpacks,
            "shaderpack",
            &mut result,
        );
    }

    Ok(result)
}

/// Check for updates for a specific profile
pub fn check_profile_updates(
    paths: &Paths,
    profile_id: &str,
    curseforge_api_key: Option<&str>,
) -> Result<UpdateCheckResult> {
    let mut result = UpdateCheckResult::default();
    let store = ContentStore::new(curseforge_api_key);

    let profile = load_profile(paths, profile_id)?;

    // Check mods
    check_content_updates(&store, &profile, &profile.mods, "mod", &mut result);

    // Check resourcepacks
    check_content_updates(
        &store,
        &profile,
        &profile.resourcepacks,
        "resourcepack",
        &mut result,
    );

    // Check shaderpacks
    check_content_updates(
        &store,
        &profile,
        &profile.shaderpacks,
        "shaderpack",
        &mut result,
    );

    Ok(result)
}

fn check_content_updates(
    store: &ContentStore,
    profile: &Profile,
    content_list: &[ContentRef],
    content_type: &str,
    result: &mut UpdateCheckResult,
) {
    let loader = profile.loader.as_ref().map(|l| l.loader_type.as_str());

    for content in content_list {
        // Skip pinned content
        if content.pinned {
            result.skipped += 1;
            continue;
        }

        // Can only check updates if we have platform info
        let (platform, project_id) = match (&content.platform, &content.project_id) {
            (Some(p), Some(id)) => (p.as_str(), id.as_str()),
            _ => {
                // No platform info - manual import
                result.skipped += 1;
                continue;
            }
        };

        // Parse platform
        let platform = match platform.to_lowercase().as_str() {
            "modrinth" => Platform::Modrinth,
            "curseforge" => Platform::CurseForge,
            _ => {
                result.skipped += 1;
                continue;
            }
        };

        // Item will be checked - count it now
        result.checked += 1;

        // Get the latest version for this MC version and loader
        let latest = match store.get_latest_version(
            platform,
            project_id,
            Some(&profile.mc_version),
            loader,
        ) {
            Ok(v) => v,
            Err(e) => {
                result.errors.push(format!(
                    "Failed to check {} ({}): {}",
                    content.name, project_id, e
                ));
                continue;
            }
        };

        // Compare versions
        let current_version_id = content.version_id.as_deref().unwrap_or("");
        if latest.id != current_version_id {
            // There's an update available
            result.updates.push(ContentUpdate {
                profile_id: profile.id.clone(),
                content: content.clone(),
                content_type: content_type.to_string(),
                current_version: content.version.clone(),
                latest_version: latest.version.clone(),
                latest_version_id: latest.id.clone(),
                changelog: None, // Could fetch changelog from API if needed
            });
        }
    }
}

/// Apply a specific update to a profile
pub fn apply_update(
    paths: &Paths,
    profile_id: &str,
    content_name: &str,
    content_type: &str,
    new_version_id: &str,
    curseforge_api_key: Option<&str>,
) -> Result<Profile> {
    let store = ContentStore::new(curseforge_api_key);
    let mut profile = load_profile(paths, profile_id)?;

    // Find the content to update
    let content_list = match content_type {
        "mod" => &mut profile.mods,
        "resourcepack" => &mut profile.resourcepacks,
        "shaderpack" => &mut profile.shaderpacks,
        _ => return Err(anyhow::anyhow!("invalid content type: {}", content_type)),
    };

    let content = content_list
        .iter_mut()
        .find(|c| c.name == content_name)
        .ok_or_else(|| anyhow::anyhow!("content not found: {}", content_name))?;

    // Get platform info
    let platform = content
        .platform
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("content has no platform info"))?;
    let project_id = content
        .project_id
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("content has no project ID"))?;

    let platform = match platform.to_lowercase().as_str() {
        "modrinth" => Platform::Modrinth,
        "curseforge" => Platform::CurseForge,
        _ => return Err(anyhow::anyhow!("unsupported platform: {}", platform)),
    };

    // Get all versions and find the requested one
    let versions = store.get_versions(platform, project_id, None, None)?;
    let version = versions
        .into_iter()
        .find(|v| v.id == new_version_id)
        .ok_or_else(|| anyhow::anyhow!("version not found: {}", new_version_id))?;

    // Download and store the new version
    let ct = match content_type {
        "mod" => ContentType::Mod,
        "resourcepack" => ContentType::ResourcePack,
        "shaderpack" => ContentType::ShaderPack,
        _ => ContentType::Mod,
    };

    let new_ref = store.download_to_store(paths, &version, ct)?;

    // Update the content reference
    content.hash = new_ref.hash;
    content.version = new_ref.version;
    content.version_id = Some(new_version_id.to_string());
    content.file_name = new_ref.file_name;
    content.source = new_ref.source;

    save_profile(paths, &profile)?;
    Ok(profile)
}

/// Set pinned state for a content item
pub fn set_content_pinned(
    paths: &Paths,
    profile_id: &str,
    content_name: &str,
    content_type: &str,
    pinned: bool,
) -> Result<Profile> {
    let mut profile = load_profile(paths, profile_id)?;

    let content_list = match content_type {
        "mod" => &mut profile.mods,
        "resourcepack" => &mut profile.resourcepacks,
        "shaderpack" => &mut profile.shaderpacks,
        _ => return Err(anyhow::anyhow!("invalid content type: {}", content_type)),
    };

    let content = content_list
        .iter_mut()
        .find(|c| c.name == content_name)
        .ok_or_else(|| anyhow::anyhow!("content not found: {}", content_name))?;

    content.pinned = pinned;
    save_profile(paths, &profile)?;
    Ok(profile)
}

/// Set enabled state for a content item
pub fn set_content_enabled(
    paths: &Paths,
    profile_id: &str,
    content_name: &str,
    content_type: &str,
    enabled: bool,
) -> Result<Profile> {
    let mut profile = load_profile(paths, profile_id)?;

    let content_list = match content_type {
        "mod" => &mut profile.mods,
        "resourcepack" => &mut profile.resourcepacks,
        "shaderpack" => &mut profile.shaderpacks,
        _ => return Err(anyhow::anyhow!("invalid content type: {}", content_type)),
    };

    let content = content_list
        .iter_mut()
        .find(|c| c.name == content_name)
        .ok_or_else(|| anyhow::anyhow!("content not found: {}", content_name))?;

    content.enabled = enabled;
    save_profile(paths, &profile)?;
    Ok(profile)
}

/// Helper to normalize a hash (strip sha256: prefix if present)
fn normalize_hash(hash: &str) -> String {
    hash.strip_prefix("sha256:").unwrap_or(hash).to_string()
}

/// Calculate the total size of a directory recursively
fn dir_size(path: &std::path::Path) -> Result<u64> {
    if !path.exists() {
        return Ok(0);
    }

    let mut total = 0u64;
    for entry in fs::read_dir(path).with_context(|| format!("failed to read dir: {}", path.display()))? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            total += dir_size(&entry.path())?;
        } else {
            total += metadata.len();
        }
    }
    Ok(total)
}
