use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.modrinth.com/v2";
const USER_AGENT_VALUE: &str = "shard-launcher/1.0 (https://github.com/oraxen/shard)";

/// Project types on Modrinth
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectType {
    Mod,
    Modpack,
    Resourcepack,
    Shader,
}

impl std::fmt::Display for ProjectType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectType::Mod => write!(f, "mod"),
            ProjectType::Modpack => write!(f, "modpack"),
            ProjectType::Resourcepack => write!(f, "resourcepack"),
            ProjectType::Shader => write!(f, "shader"),
        }
    }
}

/// Modrinth project (mod, resourcepack, shader, etc.)
#[derive(Debug, Clone, Deserialize)]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub project_type: ProjectType,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub body: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub followers: u32,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    pub updated: String,
    pub published: String,
}

/// Version of a project
#[derive(Debug, Clone, Deserialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    #[serde(default)]
    pub changelog: String,
    pub date_published: String,
    pub downloads: u64,
    pub version_type: String, // "release", "beta", "alpha"
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    pub files: Vec<VersionFile>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
}

/// A file within a version
#[derive(Debug, Clone, Deserialize)]
pub struct VersionFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
    pub hashes: FileHashes,
}

/// Hash values for a file
#[derive(Debug, Clone, Deserialize)]
pub struct FileHashes {
    pub sha1: String,
    pub sha512: String,
}

/// Dependency information
#[derive(Debug, Clone, Deserialize)]
pub struct Dependency {
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    pub dependency_type: String, // "required", "optional", "incompatible", "embedded"
}

/// Search result from Modrinth
#[derive(Debug, Clone, Deserialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub offset: u32,
    pub limit: u32,
    pub total_hits: u32,
}

/// A single search hit
#[derive(Debug, Clone, Deserialize)]
pub struct SearchHit {
    pub project_id: String,
    pub slug: String,
    pub project_type: ProjectType,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub follows: u32,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub versions: Vec<String>,
    pub latest_version: Option<String>,
    pub date_modified: String,
    pub date_created: String,
}

/// Facet filters for search
#[derive(Debug, Clone, Default)]
pub struct SearchFacets {
    pub project_type: Option<ProjectType>,
    pub categories: Vec<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
}

impl SearchFacets {
    pub fn to_facets_string(&self) -> String {
        let mut facets = Vec::new();

        if let Some(pt) = &self.project_type {
            facets.push(format!("[\"project_types:{}\"]", pt));
        }
        for cat in &self.categories {
            facets.push(format!("[\"categories:{}\"]", cat));
        }
        for ver in &self.game_versions {
            facets.push(format!("[\"game_versions:{}\"]", ver));
        }
        // Note: loaders is NOT a filterable attribute in Modrinth search API
        // Filtering by loader must be done post-search or via project/version endpoints

        if facets.is_empty() {
            String::new()
        } else {
            format!("[{}]", facets.join(","))
        }
    }
}

/// Modrinth API client
pub struct ModrinthClient {
    client: Client,
}

impl Default for ModrinthClient {
    fn default() -> Self {
        Self::new()
    }
}

impl ModrinthClient {
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));

        let client = Client::builder()
            .default_headers(headers)
            .build()
            .expect("failed to build HTTP client");

        Self { client }
    }

    /// Search for projects
    pub fn search(
        &self,
        query: &str,
        facets: &SearchFacets,
        limit: u32,
        offset: u32,
    ) -> Result<SearchResult> {
        let mut url = format!("{}/search?query={}&limit={}&offset={}", API_BASE, urlencoding::encode(query), limit, offset);

        let facets_str = facets.to_facets_string();
        if !facets_str.is_empty() {
            url.push_str(&format!("&facets={}", urlencoding::encode(&facets_str)));
        }

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to search Modrinth")?
            .error_for_status()
            .context("Modrinth search failed")?;

        resp.json().context("failed to parse search results")
    }

    /// Get a project by slug or ID
    pub fn get_project(&self, id_or_slug: &str) -> Result<Project> {
        let url = format!("{}/project/{}", API_BASE, urlencoding::encode(id_or_slug));

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch project")?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            bail!("project not found: {}", id_or_slug);
        }

        resp.error_for_status()
            .context("Modrinth request failed")?
            .json()
            .context("failed to parse project")
    }

    /// Get all versions of a project
    pub fn get_project_versions(&self, id_or_slug: &str) -> Result<Vec<Version>> {
        let url = format!("{}/project/{}/version", API_BASE, urlencoding::encode(id_or_slug));

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch project versions")?
            .error_for_status()
            .context("Modrinth request failed")?;

        resp.json().context("failed to parse versions")
    }

    /// Get versions filtered by game version and loader
    pub fn get_compatible_versions(
        &self,
        id_or_slug: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<Version>> {
        let mut url = format!("{}/project/{}/version", API_BASE, urlencoding::encode(id_or_slug));
        let mut params = Vec::new();

        if let Some(gv) = game_version {
            params.push(format!("game_versions=[\"{}\"]", gv));
        }
        if let Some(l) = loader {
            params.push(format!("loaders=[\"{}\"]", l));
        }

        if !params.is_empty() {
            url.push('?');
            url.push_str(&params.join("&"));
        }

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch versions")?
            .error_for_status()
            .context("Modrinth request failed")?;

        resp.json().context("failed to parse versions")
    }

    /// Get a specific version by ID
    pub fn get_version(&self, version_id: &str) -> Result<Version> {
        let url = format!("{}/version/{}", API_BASE, version_id);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch version")?
            .error_for_status()
            .context("Modrinth request failed")?;

        resp.json().context("failed to parse version")
    }

    /// Get multiple versions by IDs
    pub fn get_versions(&self, version_ids: &[&str]) -> Result<Vec<Version>> {
        if version_ids.is_empty() {
            return Ok(Vec::new());
        }

        let ids_json = serde_json::to_string(version_ids).context("failed to serialize version IDs")?;
        let url = format!("{}/versions?ids={}", API_BASE, urlencoding::encode(&ids_json));

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch versions")?
            .error_for_status()
            .context("Modrinth request failed")?;

        resp.json().context("failed to parse versions")
    }

    /// Get the latest compatible version for a project
    pub fn get_latest_version(
        &self,
        id_or_slug: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Version> {
        let versions = self.get_compatible_versions(id_or_slug, game_version, loader)?;

        // Prefer release versions, then by date
        let mut release_versions: Vec<_> = versions
            .iter()
            .filter(|v| v.version_type == "release")
            .collect();

        if release_versions.is_empty() {
            release_versions = versions.iter().collect();
        }

        release_versions
            .into_iter()
            .next()
            .cloned()
            .with_context(|| format!("no compatible version found for {}", id_or_slug))
    }

    /// Get the primary download file for a version
    pub fn get_primary_file(version: &Version) -> Option<&VersionFile> {
        version.files.iter().find(|f| f.primary).or_else(|| version.files.first())
    }

    /// Download a file to a path
    pub fn download_file(&self, file: &VersionFile, path: &std::path::Path) -> Result<()> {
        let resp = self
            .client
            .get(&file.url)
            .send()
            .context("failed to download file")?
            .error_for_status()
            .context("download failed")?;

        let bytes = resp.bytes().context("failed to read file content")?;
        std::fs::write(path, &bytes)
            .with_context(|| format!("failed to write file: {}", path.display()))?;

        Ok(())
    }

    /// Get categories (for browsing)
    pub fn get_categories(&self) -> Result<Vec<Category>> {
        let url = format!("{}/tag/category", API_BASE);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch categories")?
            .error_for_status()
            .context("Modrinth request failed")?;

        resp.json().context("failed to parse categories")
    }

    /// Get available game versions
    pub fn get_game_versions(&self) -> Result<Vec<GameVersion>> {
        let url = format!("{}/tag/game_version", API_BASE);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch game versions")?
            .error_for_status()
            .context("Modrinth request failed")?;

        resp.json().context("failed to parse game versions")
    }

    /// Get available loaders
    pub fn get_loaders(&self) -> Result<Vec<Loader>> {
        let url = format!("{}/tag/loader", API_BASE);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch loaders")?
            .error_for_status()
            .context("Modrinth request failed")?;

        resp.json().context("failed to parse loaders")
    }
}

/// Category tag
#[derive(Debug, Clone, Deserialize)]
pub struct Category {
    pub name: String,
    pub project_type: String,
    #[serde(default)]
    pub header: String,
    pub icon: String,
}

/// Game version tag
#[derive(Debug, Clone, Deserialize)]
pub struct GameVersion {
    pub version: String,
    pub version_type: String, // "release", "snapshot", etc.
    pub date: String,
    pub major: bool,
}

/// Loader tag
#[derive(Debug, Clone, Deserialize)]
pub struct Loader {
    pub name: String,
    #[serde(default)]
    pub supported_project_types: Vec<String>,
    pub icon: String,
}
