//! Unified content store that aggregates Modrinth and CurseForge
//!
//! This module provides a single interface for searching and downloading
//! content from multiple sources.

use crate::curseforge::{self, CurseForgeClient, ModLoaderType};
use crate::modrinth::{ModrinthClient, ProjectType, SearchFacets};
use crate::paths::Paths;
use crate::store::store_from_url;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Content type for unified search
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Mod,
    ResourcePack,
    ShaderPack,
    ModPack,
}

impl ContentType {
    pub fn to_modrinth_type(self) -> ProjectType {
        match self {
            ContentType::Mod => ProjectType::Mod,
            ContentType::ResourcePack => ProjectType::Resourcepack,
            ContentType::ShaderPack => ProjectType::Shader,
            ContentType::ModPack => ProjectType::Modpack,
        }
    }

    pub fn to_curseforge_class(self) -> u32 {
        match self {
            ContentType::Mod => curseforge::CLASS_MODS,
            ContentType::ResourcePack => curseforge::CLASS_RESOURCEPACKS,
            ContentType::ShaderPack => curseforge::CLASS_SHADERS,
            ContentType::ModPack => curseforge::CLASS_MODPACKS,
        }
    }

    pub fn to_content_kind(self) -> crate::store::ContentKind {
        match self {
            ContentType::Mod => crate::store::ContentKind::Mod,
            ContentType::ResourcePack => crate::store::ContentKind::ResourcePack,
            ContentType::ShaderPack => crate::store::ContentKind::ShaderPack,
            ContentType::ModPack => crate::store::ContentKind::Mod, // Modpacks are stored as mods
        }
    }
}

/// Source platform
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Modrinth,
    CurseForge,
}

impl std::fmt::Display for Platform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Platform::Modrinth => write!(f, "modrinth"),
            Platform::CurseForge => write!(f, "curseforge"),
        }
    }
}

/// Unified search result item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentItem {
    /// Unique identifier (platform-specific)
    pub id: String,
    /// URL-friendly slug
    pub slug: String,
    /// Display name
    pub name: String,
    /// Short description
    pub description: String,
    /// Full description/body (optional, requires separate fetch)
    #[serde(default)]
    pub body: Option<String>,
    /// Icon/logo URL
    pub icon_url: Option<String>,
    /// Source platform
    pub platform: Platform,
    /// Content type
    pub content_type: ContentType,
    /// Total downloads
    pub downloads: u64,
    /// Last updated timestamp
    pub updated: String,
    /// Categories/tags
    #[serde(default)]
    pub categories: Vec<String>,
    /// Supported game versions
    #[serde(default)]
    pub game_versions: Vec<String>,
    /// Supported loaders
    #[serde(default)]
    pub loaders: Vec<String>,
}

/// A downloadable version/file of content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentVersion {
    /// Version ID
    pub id: String,
    /// Project/Mod ID
    pub project_id: String,
    /// Version display name
    pub name: String,
    /// Version number/string
    pub version: String,
    /// Download URL
    pub download_url: String,
    /// Filename
    pub filename: String,
    /// File size in bytes
    pub size: u64,
    /// SHA256 hash (if available)
    pub sha256: Option<String>,
    /// SHA1 hash (if available)
    pub sha1: Option<String>,
    /// Source platform
    pub platform: Platform,
    /// Supported game versions
    #[serde(default)]
    pub game_versions: Vec<String>,
    /// Supported loaders
    #[serde(default)]
    pub loaders: Vec<String>,
    /// Release type (release, beta, alpha)
    pub release_type: String,
    /// Required dependencies
    #[serde(default)]
    pub dependencies: Vec<ContentDependency>,
}

/// Dependency information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentDependency {
    /// Project ID on the platform
    pub project_id: String,
    /// Dependency type (required, optional)
    pub dependency_type: String,
}

/// Search options
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    pub query: String,
    pub content_type: Option<ContentType>,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub limit: u32,
    pub offset: u32,
}

/// Unified content store client
pub struct ContentStore {
    modrinth: ModrinthClient,
    curseforge: Option<CurseForgeClient>,
}

impl ContentStore {
    /// Create a new content store
    pub fn new(curseforge_api_key: Option<&str>) -> Self {
        Self {
            modrinth: ModrinthClient::new(),
            curseforge: curseforge_api_key.map(CurseForgeClient::new),
        }
    }

    /// Create with only Modrinth (no API key required)
    pub fn modrinth_only() -> Self {
        Self {
            modrinth: ModrinthClient::new(),
            curseforge: None,
        }
    }

    /// Search across all available platforms
    pub fn search(&self, options: &SearchOptions) -> Result<Vec<ContentItem>> {
        let mut results = Vec::new();

        // Search Modrinth
        let modrinth_results = self.search_modrinth(options)?;
        results.extend(modrinth_results);

        // Search CurseForge if available
        if let Some(cf) = &self.curseforge {
            let cf_results = self.search_curseforge(cf, options)?;
            results.extend(cf_results);
        }

        // Sort by downloads
        results.sort_by(|a, b| b.downloads.cmp(&a.downloads));

        // Limit results
        if options.limit > 0 {
            results.truncate(options.limit as usize);
        }

        Ok(results)
    }

    /// Search only Modrinth
    pub fn search_modrinth(&self, options: &SearchOptions) -> Result<Vec<ContentItem>> {
        let mut facets = SearchFacets::default();

        if let Some(ct) = options.content_type {
            facets.project_type = Some(ct.to_modrinth_type());
        }
        if let Some(gv) = &options.game_version {
            facets.game_versions = vec![gv.clone()];
        }
        if let Some(loader) = &options.loader {
            facets.loaders = vec![loader.clone()];
        }

        let limit = if options.limit > 0 { options.limit } else { 20 };
        let result = self.modrinth.search(&options.query, &facets, limit, options.offset)?;

        Ok(result
            .hits
            .into_iter()
            .map(|hit| ContentItem {
                id: hit.project_id,
                slug: hit.slug,
                name: hit.title,
                description: hit.description,
                body: None,
                icon_url: hit.icon_url,
                platform: Platform::Modrinth,
                content_type: match hit.project_type {
                    ProjectType::Mod => ContentType::Mod,
                    ProjectType::Modpack => ContentType::ModPack,
                    ProjectType::Resourcepack => ContentType::ResourcePack,
                    ProjectType::Shader => ContentType::ShaderPack,
                },
                downloads: hit.downloads,
                updated: hit.date_modified,
                categories: hit.categories,
                game_versions: hit.versions,
                loaders: vec![],
            })
            .collect())
    }

    /// Check if CurseForge is available
    pub fn has_curseforge(&self) -> bool {
        self.curseforge.is_some()
    }

    /// Search only CurseForge (public API)
    pub fn search_curseforge_only(&self, options: &SearchOptions) -> Result<Vec<ContentItem>> {
        let cf = self
            .curseforge
            .as_ref()
            .context("CurseForge API key not configured")?;
        self.search_curseforge(cf, options)
    }

    /// Search only CurseForge (internal)
    fn search_curseforge(
        &self,
        cf: &CurseForgeClient,
        options: &SearchOptions,
    ) -> Result<Vec<ContentItem>> {
        let class_id = options.content_type.map(|ct| ct.to_curseforge_class());
        let mod_loader = options.loader.as_deref().map(ModLoaderType::parse);
        let limit = if options.limit > 0 { options.limit } else { 20 };

        let result = cf.search(
            &options.query,
            class_id,
            options.game_version.as_deref(),
            mod_loader,
            limit,
            options.offset,
            None,
        )?;

        Ok(result
            .data
            .into_iter()
            .map(|m| {
                let content_type = match m.class_id {
                    Some(curseforge::CLASS_MODS) => ContentType::Mod,
                    Some(curseforge::CLASS_RESOURCEPACKS) => ContentType::ResourcePack,
                    Some(curseforge::CLASS_SHADERS) => ContentType::ShaderPack,
                    Some(curseforge::CLASS_MODPACKS) => ContentType::ModPack,
                    _ => ContentType::Mod,
                };

                ContentItem {
                    id: m.id.to_string(),
                    slug: m.slug,
                    name: m.name,
                    description: m.summary,
                    body: None,
                    icon_url: m.logo.map(|l| l.url),
                    platform: Platform::CurseForge,
                    content_type,
                    downloads: m.download_count,
                    updated: m.date_modified,
                    categories: m.categories.into_iter().map(|c| c.name).collect(),
                    game_versions: m
                        .latest_files_indexes
                        .iter()
                        .map(|f| f.game_version.clone())
                        .collect(),
                    loaders: vec![],
                }
            })
            .collect())
    }

    /// Get detailed information about a project
    pub fn get_project(&self, platform: Platform, id: &str) -> Result<ContentItem> {
        match platform {
            Platform::Modrinth => {
                let project = self.modrinth.get_project(id)?;
                Ok(ContentItem {
                    id: project.id,
                    slug: project.slug,
                    name: project.title,
                    description: project.description,
                    body: Some(project.body),
                    icon_url: project.icon_url,
                    platform: Platform::Modrinth,
                    content_type: match project.project_type {
                        ProjectType::Mod => ContentType::Mod,
                        ProjectType::Modpack => ContentType::ModPack,
                        ProjectType::Resourcepack => ContentType::ResourcePack,
                        ProjectType::Shader => ContentType::ShaderPack,
                    },
                    downloads: project.downloads,
                    updated: project.updated,
                    categories: project.categories,
                    game_versions: project.game_versions,
                    loaders: project.loaders,
                })
            }
            Platform::CurseForge => {
                let cf = self
                    .curseforge
                    .as_ref()
                    .context("CurseForge not configured")?;
                let mod_id: u32 = id.parse().context("invalid CurseForge mod ID")?;
                let m = cf.get_mod(mod_id)?;

                let content_type = match m.class_id {
                    Some(curseforge::CLASS_MODS) => ContentType::Mod,
                    Some(curseforge::CLASS_RESOURCEPACKS) => ContentType::ResourcePack,
                    Some(curseforge::CLASS_SHADERS) => ContentType::ShaderPack,
                    Some(curseforge::CLASS_MODPACKS) => ContentType::ModPack,
                    _ => ContentType::Mod,
                };

                Ok(ContentItem {
                    id: m.id.to_string(),
                    slug: m.slug,
                    name: m.name,
                    description: m.summary,
                    body: None,
                    icon_url: m.logo.map(|l| l.url),
                    platform: Platform::CurseForge,
                    content_type,
                    downloads: m.download_count,
                    updated: m.date_modified,
                    categories: m.categories.into_iter().map(|c| c.name).collect(),
                    game_versions: m
                        .latest_files_indexes
                        .iter()
                        .map(|f| f.game_version.clone())
                        .collect(),
                    loaders: vec![],
                })
            }
        }
    }

    /// Get available versions for a project
    pub fn get_versions(
        &self,
        platform: Platform,
        id: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<ContentVersion>> {
        match platform {
            Platform::Modrinth => {
                let versions = self
                    .modrinth
                    .get_compatible_versions(id, game_version, loader)?;

                Ok(versions
                    .into_iter()
                    .filter_map(|v| {
                        let file = ModrinthClient::get_primary_file(&v)?.clone();
                        Some(ContentVersion {
                            id: v.id,
                            project_id: v.project_id,
                            name: v.name,
                            version: v.version_number,
                            download_url: file.url,
                            filename: file.filename,
                            size: file.size,
                            sha256: None,
                            sha1: Some(file.hashes.sha1),
                            platform: Platform::Modrinth,
                            game_versions: v.game_versions,
                            loaders: v.loaders,
                            release_type: v.version_type,
                            dependencies: v
                                .dependencies
                                .into_iter()
                                .filter_map(|d| {
                                    Some(ContentDependency {
                                        project_id: d.project_id?,
                                        dependency_type: d.dependency_type,
                                    })
                                })
                                .collect(),
                        })
                    })
                    .collect())
            }
            Platform::CurseForge => {
                let cf = self
                    .curseforge
                    .as_ref()
                    .context("CurseForge not configured")?;
                let mod_id: u32 = id.parse().context("invalid CurseForge mod ID")?;
                let mod_loader = loader.map(ModLoaderType::parse);

                let files = cf.get_mod_files(mod_id, game_version, mod_loader, 50, 0)?;

                Ok(files
                    .data
                    .into_iter()
                    .filter_map(|f| {
                        let download_url = f.download_url.clone()?;
                        let sha1 = curseforge::get_sha1_hash(&f).map(String::from);

                        let release_type = match f.release_type {
                            1 => "release",
                            2 => "beta",
                            3 => "alpha",
                            _ => "unknown",
                        }
                        .to_string();

                        Some(ContentVersion {
                            id: f.id.to_string(),
                            project_id: f.mod_id.to_string(),
                            name: f.display_name,
                            version: f.file_name.clone(),
                            download_url,
                            filename: f.file_name,
                            size: f.file_length,
                            sha256: None,
                            sha1,
                            platform: Platform::CurseForge,
                            game_versions: f.game_versions,
                            loaders: vec![],
                            release_type,
                            dependencies: f
                                .dependencies
                                .into_iter()
                                .filter(|d| d.relation_type == 3) // Required only
                                .map(|d| ContentDependency {
                                    project_id: d.mod_id.to_string(),
                                    dependency_type: "required".to_string(),
                                })
                                .collect(),
                        })
                    })
                    .collect())
            }
        }
    }

    /// Get the latest compatible version
    pub fn get_latest_version(
        &self,
        platform: Platform,
        id: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<ContentVersion> {
        let versions = self.get_versions(platform, id, game_version, loader)?;

        // Prefer release versions
        let release = versions.iter().find(|v| v.release_type == "release");
        if let Some(v) = release {
            return Ok(v.clone());
        }

        versions
            .into_iter()
            .next()
            .context("no compatible versions found")
    }

    /// Download content to the store and return a ContentRef
    pub fn download_to_store(
        &self,
        paths: &Paths,
        version: &ContentVersion,
        content_type: ContentType,
    ) -> Result<crate::profile::ContentRef> {
        let (download_path, file_name) = store_from_url(paths, &version.download_url)?;
        let stored = crate::store::store_content(
            paths,
            content_type.to_content_kind(),
            &download_path,
            Some(version.download_url.clone()),
            Some(file_name),
        )?;

        Ok(crate::profile::ContentRef {
            name: stored.name,
            hash: stored.hash,
            version: Some(version.version.clone()),
            source: stored.source,
            file_name: Some(stored.file_name),
            platform: None, // Set by caller after download
            project_id: None,
            version_id: None,
            enabled: true,
            pinned: false,
        })
    }
}

/// Convenience functions for direct Modrinth access
pub mod modrinth_helpers {
    use super::*;

    pub fn search_mods(query: &str, game_version: Option<&str>, loader: Option<&str>) -> Result<Vec<ContentItem>> {
        let store = ContentStore::modrinth_only();
        store.search_modrinth(&SearchOptions {
            query: query.to_string(),
            content_type: Some(ContentType::Mod),
            game_version: game_version.map(String::from),
            loader: loader.map(String::from),
            limit: 20,
            offset: 0,
        })
    }

    pub fn search_shaders(query: &str, game_version: Option<&str>) -> Result<Vec<ContentItem>> {
        let store = ContentStore::modrinth_only();
        store.search_modrinth(&SearchOptions {
            query: query.to_string(),
            content_type: Some(ContentType::ShaderPack),
            game_version: game_version.map(String::from),
            loader: None,
            limit: 20,
            offset: 0,
        })
    }

    pub fn search_resourcepacks(query: &str, game_version: Option<&str>) -> Result<Vec<ContentItem>> {
        let store = ContentStore::modrinth_only();
        store.search_modrinth(&SearchOptions {
            query: query.to_string(),
            content_type: Some(ContentType::ResourcePack),
            game_version: game_version.map(String::from),
            loader: None,
            limit: 20,
            offset: 0,
        })
    }

    pub fn get_project(id_or_slug: &str) -> Result<ContentItem> {
        let store = ContentStore::modrinth_only();
        store.get_project(Platform::Modrinth, id_or_slug)
    }

    pub fn get_latest_version(
        id_or_slug: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<ContentVersion> {
        let store = ContentStore::modrinth_only();
        store.get_latest_version(Platform::Modrinth, id_or_slug, game_version, loader)
    }
}
