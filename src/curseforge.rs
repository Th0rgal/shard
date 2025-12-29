use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.curseforge.com/v1";
const MINECRAFT_GAME_ID: u32 = 432;
const USER_AGENT_VALUE: &str = "shard-launcher/1.0";

// Class IDs for different content types
pub const CLASS_MODS: u32 = 6;
pub const CLASS_RESOURCEPACKS: u32 = 12;
pub const CLASS_SHADERS: u32 = 6552;
pub const CLASS_MODPACKS: u32 = 4471;

/// CurseForge mod (project)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: u32,
    pub game_id: u32,
    pub name: String,
    pub slug: String,
    pub summary: String,
    #[serde(default)]
    pub links: ModLinks,
    pub status: u32,
    pub download_count: u64,
    pub is_featured: bool,
    pub primary_category_id: u32,
    pub class_id: Option<u32>,
    #[serde(default)]
    pub categories: Vec<Category>,
    #[serde(default)]
    pub authors: Vec<Author>,
    #[serde(default)]
    pub logo: Option<ModAsset>,
    #[serde(default)]
    pub screenshots: Vec<ModAsset>,
    pub main_file_id: u32,
    #[serde(default)]
    pub latest_files: Vec<File>,
    #[serde(default)]
    pub latest_files_indexes: Vec<FileIndex>,
    pub date_created: String,
    pub date_modified: String,
    pub date_released: String,
    #[serde(default)]
    pub allow_mod_distribution: Option<bool>,
    pub game_popularity_rank: u32,
    pub is_available: bool,
    pub thumbs_up_count: u32,
}

/// Mod links
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModLinks {
    pub website_url: Option<String>,
    pub wiki_url: Option<String>,
    pub issues_url: Option<String>,
    pub source_url: Option<String>,
}

/// Category information
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: u32,
    pub game_id: u32,
    pub name: String,
    pub slug: String,
    pub url: String,
    pub icon_url: String,
    pub date_modified: String,
    pub is_class: Option<bool>,
    pub class_id: Option<u32>,
    pub parent_category_id: Option<u32>,
    pub display_index: Option<u32>,
}

/// Author information
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub id: u32,
    pub name: String,
    pub url: String,
}

/// Mod asset (logo, screenshot)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModAsset {
    pub id: u32,
    pub mod_id: u32,
    pub title: String,
    pub description: String,
    pub thumbnail_url: String,
    pub url: String,
}

/// File (release) information
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub id: u32,
    pub game_id: u32,
    pub mod_id: u32,
    pub is_available: bool,
    pub display_name: String,
    pub file_name: String,
    pub release_type: u32, // 1=release, 2=beta, 3=alpha
    pub file_status: u32,
    pub hashes: Vec<FileHash>,
    pub file_date: String,
    pub file_length: u64,
    pub download_count: u64,
    pub download_url: Option<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub sortable_game_versions: Vec<SortableGameVersion>,
    #[serde(default)]
    pub dependencies: Vec<FileDependency>,
    #[serde(default)]
    pub expose_as_alternative: Option<bool>,
    #[serde(default)]
    pub parent_project_file_id: Option<u32>,
    #[serde(default)]
    pub alternate_file_id: Option<u32>,
    pub is_server_pack: Option<bool>,
    pub server_pack_file_id: Option<u32>,
    pub file_fingerprint: u64,
    #[serde(default)]
    pub modules: Vec<FileModule>,
}

/// File hash
#[derive(Debug, Clone, Deserialize)]
pub struct FileHash {
    pub value: String,
    pub algo: u32, // 1=sha1, 2=md5
}

/// Sortable game version info
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortableGameVersion {
    pub game_version_name: String,
    pub game_version_padded: String,
    pub game_version: String,
    pub game_version_release_date: String,
    pub game_version_type_id: Option<u32>,
}

/// File dependency
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDependency {
    pub mod_id: u32,
    pub relation_type: u32, // 1=embedded, 2=optional, 3=required, 4=tool, 5=incompatible, 6=include
}

/// File module (for modpacks)
#[derive(Debug, Clone, Deserialize)]
pub struct FileModule {
    pub name: String,
    pub fingerprint: u64,
}

/// File index for quick lookup
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndex {
    pub game_version: String,
    pub file_id: u32,
    pub filename: String,
    pub release_type: u32,
    pub game_version_type_id: Option<u32>,
    pub mod_loader: Option<u32>, // 0=any, 1=forge, 2=cauldron, 3=liteloader, 4=fabric, 5=quilt, 6=neoforge
}

/// Search result wrapper
#[derive(Debug, Clone, Deserialize)]
pub struct SearchResponse {
    pub data: Vec<Mod>,
    pub pagination: Pagination,
}

/// Mod response wrapper
#[derive(Debug, Clone, Deserialize)]
pub struct ModResponse {
    pub data: Mod,
}

/// Files response wrapper
#[derive(Debug, Clone, Deserialize)]
pub struct FilesResponse {
    pub data: Vec<File>,
    pub pagination: Pagination,
}

/// File response wrapper
#[derive(Debug, Clone, Deserialize)]
pub struct FileResponse {
    pub data: File,
}

/// Pagination info
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pagination {
    pub index: u32,
    pub page_size: u32,
    pub result_count: u32,
    pub total_count: u32,
}

/// Mod loader type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModLoaderType {
    Any = 0,
    Forge = 1,
    Cauldron = 2,
    LiteLoader = 3,
    Fabric = 4,
    Quilt = 5,
    NeoForge = 6,
}

impl ModLoaderType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "forge" => ModLoaderType::Forge,
            "fabric" => ModLoaderType::Fabric,
            "quilt" => ModLoaderType::Quilt,
            "neoforge" => ModLoaderType::NeoForge,
            "liteloader" => ModLoaderType::LiteLoader,
            "cauldron" => ModLoaderType::Cauldron,
            _ => ModLoaderType::Any,
        }
    }
}

/// Sort field for search
#[derive(Debug, Clone, Copy)]
pub enum SearchSortField {
    Featured = 1,
    Popularity = 2,
    LastUpdated = 3,
    Name = 4,
    Author = 5,
    TotalDownloads = 6,
    Category = 7,
    GameVersion = 8,
}

/// CurseForge API client
pub struct CurseForgeClient {
    client: Client,
    api_key: String,
}

impl CurseForgeClient {
    pub fn new(api_key: &str) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(api_key).expect("invalid API key"),
        );

        let client = Client::builder()
            .default_headers(headers)
            .build()
            .expect("failed to build HTTP client");

        Self {
            client,
            api_key: api_key.to_string(),
        }
    }

    /// Search for mods
    pub fn search(
        &self,
        query: &str,
        class_id: Option<u32>,
        game_version: Option<&str>,
        mod_loader: Option<ModLoaderType>,
        page_size: u32,
        index: u32,
        sort: Option<SearchSortField>,
    ) -> Result<SearchResponse> {
        let mut url = format!(
            "{}/mods/search?gameId={}&searchFilter={}&pageSize={}&index={}",
            API_BASE,
            MINECRAFT_GAME_ID,
            urlencoding::encode(query),
            page_size,
            index
        );

        if let Some(class) = class_id {
            url.push_str(&format!("&classId={}", class));
        }
        if let Some(gv) = game_version {
            url.push_str(&format!("&gameVersion={}", gv));
        }
        if let Some(ml) = mod_loader {
            url.push_str(&format!("&modLoaderType={}", ml as u32));
        }
        if let Some(s) = sort {
            url.push_str(&format!("&sortField={}&sortOrder=desc", s as u32));
        }

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to search CurseForge")?
            .error_for_status()
            .context("CurseForge search failed")?;

        resp.json().context("failed to parse search results")
    }

    /// Get a mod by ID
    pub fn get_mod(&self, mod_id: u32) -> Result<Mod> {
        let url = format!("{}/mods/{}", API_BASE, mod_id);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch mod")?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            bail!("mod not found: {}", mod_id);
        }

        let response: ModResponse = resp
            .error_for_status()
            .context("CurseForge request failed")?
            .json()
            .context("failed to parse mod")?;

        Ok(response.data)
    }

    /// Get multiple mods by IDs
    pub fn get_mods(&self, mod_ids: &[u32]) -> Result<Vec<Mod>> {
        if mod_ids.is_empty() {
            return Ok(Vec::new());
        }

        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct GetModsBody {
            mod_ids: Vec<u32>,
        }

        let url = format!("{}/mods", API_BASE);

        let resp = self
            .client
            .post(&url)
            .json(&GetModsBody {
                mod_ids: mod_ids.to_vec(),
            })
            .send()
            .context("failed to fetch mods")?
            .error_for_status()
            .context("CurseForge request failed")?;

        #[derive(Deserialize)]
        struct ModsResponse {
            data: Vec<Mod>,
        }

        let response: ModsResponse = resp.json().context("failed to parse mods")?;
        Ok(response.data)
    }

    /// Get files for a mod
    pub fn get_mod_files(
        &self,
        mod_id: u32,
        game_version: Option<&str>,
        mod_loader: Option<ModLoaderType>,
        page_size: u32,
        index: u32,
    ) -> Result<FilesResponse> {
        let mut url = format!(
            "{}/mods/{}/files?pageSize={}&index={}",
            API_BASE, mod_id, page_size, index
        );

        if let Some(gv) = game_version {
            url.push_str(&format!("&gameVersion={}", gv));
        }
        if let Some(ml) = mod_loader {
            url.push_str(&format!("&modLoaderType={}", ml as u32));
        }

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch mod files")?
            .error_for_status()
            .context("CurseForge request failed")?;

        resp.json().context("failed to parse files")
    }

    /// Get a specific file
    pub fn get_file(&self, mod_id: u32, file_id: u32) -> Result<File> {
        let url = format!("{}/mods/{}/files/{}", API_BASE, mod_id, file_id);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch file")?
            .error_for_status()
            .context("CurseForge request failed")?;

        let response: FileResponse = resp.json().context("failed to parse file")?;
        Ok(response.data)
    }

    /// Get the latest file for a mod
    pub fn get_latest_file(
        &self,
        mod_id: u32,
        game_version: Option<&str>,
        mod_loader: Option<ModLoaderType>,
    ) -> Result<File> {
        let files = self.get_mod_files(mod_id, game_version, mod_loader, 1, 0)?;

        files
            .data
            .into_iter()
            .next()
            .with_context(|| format!("no compatible files found for mod {}", mod_id))
    }

    /// Download a file
    pub fn download_file(&self, file: &File, path: &std::path::Path) -> Result<()> {
        let url = file
            .download_url
            .as_ref()
            .context("file has no download URL (distribution may be disabled)")?;

        let resp = self
            .client
            .get(url)
            .send()
            .context("failed to download file")?
            .error_for_status()
            .context("download failed")?;

        let bytes = resp.bytes().context("failed to read file content")?;
        std::fs::write(path, &bytes)
            .with_context(|| format!("failed to write file: {}", path.display()))?;

        Ok(())
    }

    /// Get categories
    pub fn get_categories(&self) -> Result<Vec<Category>> {
        let url = format!("{}/categories?gameId={}", API_BASE, MINECRAFT_GAME_ID);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch categories")?
            .error_for_status()
            .context("CurseForge request failed")?;

        #[derive(Deserialize)]
        struct CategoriesResponse {
            data: Vec<Category>,
        }

        let response: CategoriesResponse = resp.json().context("failed to parse categories")?;
        Ok(response.data)
    }

    /// Get game versions
    pub fn get_game_versions(&self) -> Result<Vec<GameVersion>> {
        let url = format!("{}/games/{}/versions", API_BASE, MINECRAFT_GAME_ID);

        let resp = self
            .client
            .get(&url)
            .send()
            .context("failed to fetch game versions")?
            .error_for_status()
            .context("CurseForge request failed")?;

        #[derive(Deserialize)]
        struct VersionsResponse {
            data: Vec<GameVersions>,
        }

        #[derive(Deserialize)]
        struct GameVersions {
            #[serde(rename = "type")]
            version_type: u32,
            versions: Vec<String>,
        }

        let response: VersionsResponse = resp.json().context("failed to parse game versions")?;

        // Flatten and return unique versions
        let versions: Vec<GameVersion> = response
            .data
            .into_iter()
            .flat_map(|gv| {
                gv.versions.into_iter().map(move |v| GameVersion {
                    version: v,
                    version_type: gv.version_type,
                })
            })
            .collect();

        Ok(versions)
    }
}

/// Simple game version info
#[derive(Debug, Clone)]
pub struct GameVersion {
    pub version: String,
    pub version_type: u32,
}

/// Get SHA1 hash from file hashes
pub fn get_sha1_hash(file: &File) -> Option<&str> {
    file.hashes
        .iter()
        .find(|h| h.algo == 1)
        .map(|h| h.value.as_str())
}
