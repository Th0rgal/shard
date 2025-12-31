//! Library management with SQLite database
//!
//! Tracks all content (mods, resourcepacks, shaderpacks, skins) with metadata,
//! tags, and profile relationships.

use crate::paths::Paths;
use crate::store::{hash_file, normalize_hash, ContentKind};
use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Content type in the library
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryContentType {
    Mod,
    ResourcePack,
    ShaderPack,
    Skin,
}

impl LibraryContentType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "mod" | "mods" => Some(Self::Mod),
            "resourcepack" | "resourcepacks" | "resource_pack" | "resource_packs" => {
                Some(Self::ResourcePack)
            }
            "shaderpack" | "shaderpacks" | "shader_pack" | "shader_packs" => Some(Self::ShaderPack),
            "skin" | "skins" => Some(Self::Skin),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Mod => "mod",
            Self::ResourcePack => "resourcepack",
            Self::ShaderPack => "shaderpack",
            Self::Skin => "skin",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Mod => "Mod",
            Self::ResourcePack => "Resource Pack",
            Self::ShaderPack => "Shader Pack",
            Self::Skin => "Skin",
        }
    }

    /// Convert from store ContentKind
    pub fn from_content_kind(kind: ContentKind) -> Self {
        match kind {
            ContentKind::Mod => Self::Mod,
            ContentKind::ResourcePack => Self::ResourcePack,
            ContentKind::ShaderPack => Self::ShaderPack,
            ContentKind::Skin => Self::Skin,
        }
    }
}

/// A tag for organizing library items
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

/// A library item with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItem {
    pub id: i64,
    pub hash: String,
    pub content_type: LibraryContentType,
    pub name: String,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub source_url: Option<String>,
    pub source_platform: Option<String>,
    pub source_project_id: Option<String>,
    pub source_version: Option<String>,
    pub added_at: String,
    pub updated_at: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub used_by_profiles: Vec<String>,
}

/// Input for creating/updating a library item
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryItemInput {
    pub hash: String,
    pub content_type: Option<String>,
    pub name: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub source_url: Option<String>,
    pub source_platform: Option<String>,
    pub source_project_id: Option<String>,
    pub source_version: Option<String>,
    pub notes: Option<String>,
}

/// Filter for listing library items
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryFilter {
    pub content_type: Option<String>,
    pub search: Option<String>,
    pub tags: Option<Vec<String>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Result of an import operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportResult {
    pub added: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// An unused item candidate for purging
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnusedItem {
    pub id: i64,
    pub hash: String,
    pub content_type: LibraryContentType,
    pub name: String,
    pub file_size: Option<i64>,
}

/// Result of a purge operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PurgeResult {
    pub deleted_count: usize,
    pub freed_bytes: u64,
    pub items: Vec<UnusedItem>,
    pub errors: Vec<String>,
}

/// Summary of unused items by category
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UnusedItemsSummary {
    pub mods: Vec<UnusedItem>,
    pub resourcepacks: Vec<UnusedItem>,
    pub shaderpacks: Vec<UnusedItem>,
    pub skins: Vec<UnusedItem>,
    pub total_count: usize,
    pub total_bytes: u64,
}

/// Library statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryStats {
    pub total_items: u32,
    pub mods_count: u32,
    pub resourcepacks_count: u32,
    pub shaderpacks_count: u32,
    pub skins_count: u32,
    pub total_size: u64,
    pub tags_count: u32,
}

/// Library manager
pub struct Library {
    conn: Connection,
}

impl Library {
    /// Open (or create) the library database
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("failed to open library database: {}", path.display()))?;

        // Enable foreign key constraints (SQLite requires this per-connection)
        conn.execute("PRAGMA foreign_keys = ON", [])
            .context("failed to enable foreign key constraints")?;

        let library = Self { conn };
        library.init_schema()?;
        Ok(library)
    }

    /// Open the library from Paths
    pub fn from_paths(paths: &Paths) -> Result<Self> {
        Self::open(&paths.library_db)
    }

    /// Initialize the database schema
    fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS library_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL UNIQUE,
                content_type TEXT NOT NULL,
                name TEXT NOT NULL,
                file_name TEXT,
                file_size INTEGER,
                source_url TEXT,
                source_platform TEXT,
                source_project_id TEXT,
                source_version TEXT,
                added_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT
            );

            CREATE TABLE IF NOT EXISTS item_tags (
                item_id INTEGER REFERENCES library_items(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (item_id, tag_id)
            );

            CREATE TABLE IF NOT EXISTS profile_items (
                profile_id TEXT NOT NULL,
                item_id INTEGER REFERENCES library_items(id) ON DELETE CASCADE,
                content_type TEXT NOT NULL,
                added_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (profile_id, item_id)
            );

            CREATE INDEX IF NOT EXISTS idx_library_items_hash ON library_items(hash);
            CREATE INDEX IF NOT EXISTS idx_library_items_content_type ON library_items(content_type);
            CREATE INDEX IF NOT EXISTS idx_profile_items_profile ON profile_items(profile_id);
            "#,
        )
        .context("failed to initialize library schema")?;

        Ok(())
    }

    // ========== Item CRUD ==========

    /// Add an item to the library
    pub fn add_item(&self, input: &LibraryItemInput) -> Result<LibraryItem> {
        let hash = normalize_hash(&input.hash);
        let content_type = input
            .content_type
            .as_ref()
            .and_then(|s| LibraryContentType::from_str(s))
            .unwrap_or(LibraryContentType::Mod);
        // Compute default name only for INSERT (not for upsert update)
        let default_name = input
            .file_name
            .clone()
            .unwrap_or_else(|| format!("item-{}", &hash[..hash.len().min(8)]));

        self.conn.execute(
            r#"
            INSERT INTO library_items (hash, content_type, name, file_name, file_size, source_url, source_platform, source_project_id, source_version, notes)
            VALUES (?1, ?2, COALESCE(?3, ?11), ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(hash) DO UPDATE SET
                name = COALESCE(?3, name),
                file_name = COALESCE(?4, file_name),
                file_size = COALESCE(?5, file_size),
                source_url = COALESCE(?6, source_url),
                source_platform = COALESCE(?7, source_platform),
                source_project_id = COALESCE(?8, source_project_id),
                source_version = COALESCE(?9, source_version),
                notes = COALESCE(?10, notes),
                updated_at = datetime('now')
            "#,
            params![
                hash,
                content_type.as_str(),
                input.name,
                input.file_name,
                input.file_size,
                input.source_url,
                input.source_platform,
                input.source_project_id,
                input.source_version,
                input.notes,
                default_name,
            ],
        )
        .context("failed to add library item")?;

        self.get_item_by_hash(hash)?
            .ok_or_else(|| anyhow::anyhow!("item not found after insert"))
    }

    /// Get an item by ID
    pub fn get_item(&self, id: i64) -> Result<Option<LibraryItem>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, hash, content_type, name, file_name, file_size, source_url,
                   source_platform, source_project_id, source_version, added_at, updated_at, notes
            FROM library_items WHERE id = ?1
            "#,
        )?;

        let item = stmt
            .query_row(params![id], |row| {
                Ok(LibraryItem {
                    id: row.get(0)?,
                    hash: row.get(1)?,
                    content_type: LibraryContentType::from_str(&row.get::<_, String>(2)?)
                        .unwrap_or(LibraryContentType::Mod),
                    name: row.get(3)?,
                    file_name: row.get(4)?,
                    file_size: row.get(5)?,
                    source_url: row.get(6)?,
                    source_platform: row.get(7)?,
                    source_project_id: row.get(8)?,
                    source_version: row.get(9)?,
                    added_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    notes: row.get(12)?,
                    tags: vec![],
                    used_by_profiles: vec![],
                })
            })
            .optional()?;

        if let Some(mut item) = item {
            item.tags = self.get_item_tags(item.id)?;
            item.used_by_profiles = self.get_item_profiles(item.id)?;
            Ok(Some(item))
        } else {
            Ok(None)
        }
    }

    /// Get an item by hash
    pub fn get_item_by_hash(&self, hash: &str) -> Result<Option<LibraryItem>> {
        let hash = normalize_hash(hash);
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, hash, content_type, name, file_name, file_size, source_url,
                   source_platform, source_project_id, source_version, added_at, updated_at, notes
            FROM library_items WHERE hash = ?1
            "#,
        )?;

        let item = stmt
            .query_row(params![hash], |row| {
                Ok(LibraryItem {
                    id: row.get(0)?,
                    hash: row.get(1)?,
                    content_type: LibraryContentType::from_str(&row.get::<_, String>(2)?)
                        .unwrap_or(LibraryContentType::Mod),
                    name: row.get(3)?,
                    file_name: row.get(4)?,
                    file_size: row.get(5)?,
                    source_url: row.get(6)?,
                    source_platform: row.get(7)?,
                    source_project_id: row.get(8)?,
                    source_version: row.get(9)?,
                    added_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    notes: row.get(12)?,
                    tags: vec![],
                    used_by_profiles: vec![],
                })
            })
            .optional()?;

        if let Some(mut item) = item {
            item.tags = self.get_item_tags(item.id)?;
            item.used_by_profiles = self.get_item_profiles(item.id)?;
            Ok(Some(item))
        } else {
            Ok(None)
        }
    }

    /// Update an item
    pub fn update_item(&self, id: i64, input: &LibraryItemInput) -> Result<LibraryItem> {
        self.conn.execute(
            r#"
            UPDATE library_items SET
                name = COALESCE(?2, name),
                file_name = COALESCE(?3, file_name),
                notes = COALESCE(?4, notes),
                updated_at = datetime('now')
            WHERE id = ?1
            "#,
            params![id, input.name, input.file_name, input.notes],
        )?;

        self.get_item(id)?
            .ok_or_else(|| anyhow::anyhow!("item not found"))
    }

    /// Update item metadata (source platform, project id, etc.)
    pub fn update_item_metadata(
        &self,
        id: i64,
        name: Option<&str>,
        file_name: Option<&str>,
        source_url: Option<&str>,
        source_platform: Option<&str>,
        source_project_id: Option<&str>,
        source_version: Option<&str>,
    ) -> Result<LibraryItem> {
        self.conn.execute(
            r#"
            UPDATE library_items SET
                name = COALESCE(?2, name),
                file_name = COALESCE(?3, file_name),
                source_url = COALESCE(?4, source_url),
                source_platform = COALESCE(?5, source_platform),
                source_project_id = COALESCE(?6, source_project_id),
                source_version = COALESCE(?7, source_version),
                updated_at = datetime('now')
            WHERE id = ?1
            "#,
            params![id, name, file_name, source_url, source_platform, source_project_id, source_version],
        )?;

        self.get_item(id)?
            .ok_or_else(|| anyhow::anyhow!("item not found"))
    }

    /// Enrich library item metadata from a ContentRef (e.g., from a profile)
    pub fn enrich_item_from_content_ref(
        &self,
        hash: &str,
        name: &str,
        file_name: Option<&str>,
        source: Option<&str>,
        platform: Option<&str>,
        project_id: Option<&str>,
        version: Option<&str>,
    ) -> Result<Option<LibraryItem>> {
        let normalized_hash = normalize_hash(hash);
        if let Some(item) = self.get_item_by_hash(&normalized_hash)? {
            // Only update if the item has generic/store metadata
            let needs_update = item.source_platform.as_deref() == Some("store")
                || item.source_platform.is_none()
                || item.name.starts_with("mod-")
                || item.name.starts_with("resourcepack-")
                || item.name.starts_with("shaderpack-");

            if needs_update {
                return Ok(Some(self.update_item_metadata(
                    item.id,
                    Some(name),
                    file_name,
                    source,
                    platform,
                    project_id,
                    version,
                )?));
            }
            return Ok(Some(item));
        }
        Ok(None)
    }

    /// Delete an item
    pub fn delete_item(&self, id: i64) -> Result<bool> {
        let rows = self
            .conn
            .execute("DELETE FROM library_items WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    /// Delete an item by hash
    pub fn delete_item_by_hash(&self, hash: &str) -> Result<bool> {
        let hash = normalize_hash(hash);
        let rows = self
            .conn
            .execute("DELETE FROM library_items WHERE hash = ?1", params![hash])?;
        Ok(rows > 0)
    }

    /// List items with optional filtering
    pub fn list_items(&self, filter: &LibraryFilter) -> Result<Vec<LibraryItem>> {
        let mut sql = String::from(
            r#"
            SELECT DISTINCT li.id, li.hash, li.content_type, li.name, li.file_name, li.file_size,
                   li.source_url, li.source_platform, li.source_project_id, li.source_version,
                   li.added_at, li.updated_at, li.notes
            FROM library_items li
            "#,
        );

        let mut conditions = Vec::new();
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        // Tag filtering requires a join
        if let Some(tags) = &filter.tags {
            if !tags.is_empty() {
                sql.push_str(
                    r#"
                    JOIN item_tags it ON li.id = it.item_id
                    JOIN tags t ON it.tag_id = t.id
                    "#,
                );
                let placeholders: Vec<_> = tags.iter().map(|_| "?").collect();
                conditions.push(format!("t.name IN ({})", placeholders.join(", ")));
                for tag in tags {
                    params_vec.push(Box::new(tag.clone()));
                }
            }
        }

        // Content type filter
        if let Some(content_type) = &filter.content_type {
            if let Some(ct) = LibraryContentType::from_str(content_type) {
                conditions.push("li.content_type = ?".to_string());
                params_vec.push(Box::new(ct.as_str().to_string()));
            }
        }

        // Search filter
        if let Some(search) = &filter.search {
            if !search.is_empty() {
                conditions.push("(li.name LIKE ? OR li.file_name LIKE ?)".to_string());
                let pattern = format!("%{}%", search);
                params_vec.push(Box::new(pattern.clone()));
                params_vec.push(Box::new(pattern));
            }
        }

        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }

        sql.push_str(" ORDER BY li.updated_at DESC");

        if let Some(limit) = filter.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }
        if let Some(offset) = filter.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(LibraryItem {
                id: row.get(0)?,
                hash: row.get(1)?,
                content_type: LibraryContentType::from_str(&row.get::<_, String>(2)?)
                    .unwrap_or(LibraryContentType::Mod),
                name: row.get(3)?,
                file_name: row.get(4)?,
                file_size: row.get(5)?,
                source_url: row.get(6)?,
                source_platform: row.get(7)?,
                source_project_id: row.get(8)?,
                source_version: row.get(9)?,
                added_at: row.get(10)?,
                updated_at: row.get(11)?,
                notes: row.get(12)?,
                tags: vec![],
                used_by_profiles: vec![],
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            let mut item = row?;
            item.tags = self.get_item_tags(item.id)?;
            item.used_by_profiles = self.get_item_profiles(item.id)?;
            items.push(item);
        }

        Ok(items)
    }

    // ========== Tag CRUD ==========

    /// Create a tag
    pub fn create_tag(&self, name: &str, color: Option<&str>) -> Result<Tag> {
        self.conn.execute(
            "INSERT INTO tags (name, color) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET color = COALESCE(?2, color)",
            params![name, color],
        )?;

        self.get_tag_by_name(name)?
            .ok_or_else(|| anyhow::anyhow!("tag not found after insert"))
    }

    /// Get a tag by name
    pub fn get_tag_by_name(&self, name: &str) -> Result<Option<Tag>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, color FROM tags WHERE name = ?1")?;
        stmt.query_row(params![name], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .optional()
        .context("failed to get tag")
    }

    /// List all tags
    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, color FROM tags ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to list tags")
    }

    /// Delete a tag
    pub fn delete_tag(&self, id: i64) -> Result<bool> {
        let rows = self
            .conn
            .execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    /// Delete a tag by name
    pub fn delete_tag_by_name(&self, name: &str) -> Result<bool> {
        let rows = self
            .conn
            .execute("DELETE FROM tags WHERE name = ?1", params![name])?;
        Ok(rows > 0)
    }

    /// Get tags for an item
    fn get_item_tags(&self, item_id: i64) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.id, t.name, t.color
            FROM tags t
            JOIN item_tags it ON t.id = it.tag_id
            WHERE it.item_id = ?1
            ORDER BY t.name
            "#,
        )?;

        let rows = stmt.query_map(params![item_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to get item tags")
    }

    /// Add a tag to an item
    pub fn add_tag_to_item(&self, item_id: i64, tag_name: &str) -> Result<()> {
        // Ensure tag exists
        let tag = self
            .create_tag(tag_name, None)?;

        self.conn.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
            params![item_id, tag.id],
        )?;

        Ok(())
    }

    /// Remove a tag from an item
    pub fn remove_tag_from_item(&self, item_id: i64, tag_name: &str) -> Result<()> {
        if let Some(tag) = self.get_tag_by_name(tag_name)? {
            self.conn.execute(
                "DELETE FROM item_tags WHERE item_id = ?1 AND tag_id = ?2",
                params![item_id, tag.id],
            )?;
        }
        Ok(())
    }

    /// Set all tags for an item (replace existing)
    pub fn set_item_tags(&self, item_id: i64, tag_names: &[String]) -> Result<()> {
        // Remove all existing tags
        self.conn.execute(
            "DELETE FROM item_tags WHERE item_id = ?1",
            params![item_id],
        )?;

        // Add new tags
        for name in tag_names {
            self.add_tag_to_item(item_id, name)?;
        }

        Ok(())
    }

    // ========== Profile Relationships ==========

    /// Get profiles that use an item
    fn get_item_profiles(&self, item_id: i64) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT profile_id FROM profile_items WHERE item_id = ?1 ORDER BY profile_id",
        )?;

        let rows = stmt.query_map(params![item_id], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to get item profiles")
    }

    /// Link an item to a profile
    pub fn link_item_to_profile(
        &self,
        item_id: i64,
        profile_id: &str,
        content_type: LibraryContentType,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO profile_items (profile_id, item_id, content_type) VALUES (?1, ?2, ?3)",
            params![profile_id, item_id, content_type.as_str()],
        )?;
        Ok(())
    }

    /// Unlink an item from a profile
    pub fn unlink_item_from_profile(&self, item_id: i64, profile_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM profile_items WHERE profile_id = ?1 AND item_id = ?2",
            params![profile_id, item_id],
        )?;
        Ok(())
    }

    /// Sync profile items (update all items used by a profile)
    pub fn sync_profile_items(
        &self,
        profile_id: &str,
        hashes: &[String],
        content_type: LibraryContentType,
    ) -> Result<()> {
        // Remove existing links for this content type
        self.conn.execute(
            "DELETE FROM profile_items WHERE profile_id = ?1 AND content_type = ?2",
            params![profile_id, content_type.as_str()],
        )?;

        // Add new links
        for hash in hashes {
            if let Some(item) = self.get_item_by_hash(hash)? {
                self.link_item_to_profile(item.id, profile_id, content_type)?;
            }
        }

        Ok(())
    }

    // ========== Import ==========

    /// Import a file into the library
    pub fn import_file(
        &self,
        paths: &Paths,
        file_path: &Path,
        content_type: LibraryContentType,
    ) -> Result<LibraryItem> {
        if !file_path.exists() {
            bail!("file not found: {}", file_path.display());
        }

        // Hash the file
        let hash = hash_file(file_path)?;

        // Get file metadata
        let metadata = fs::metadata(file_path)?;
        let file_size = metadata.len() as i64;
        let file_name = file_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(String::from);
        let name = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(String::from)
            .unwrap_or_else(|| format!("item-{}", &hash[..hash.len().min(8)]));

        // Copy to content store
        let store_path = self.content_store_path(paths, content_type, &hash);
        if !store_path.exists() {
            fs::copy(file_path, &store_path).with_context(|| {
                format!(
                    "failed to copy {} to store {}",
                    file_path.display(),
                    store_path.display()
                )
            })?;
        }

        // Add to library
        self.add_item(&LibraryItemInput {
            hash,
            content_type: Some(content_type.as_str().to_string()),
            name: Some(name),
            file_name,
            file_size: Some(file_size),
            source_platform: Some("local".to_string()),
            ..Default::default()
        })
    }

    /// Import a folder into the library (optionally recursive)
    pub fn import_folder(
        &self,
        paths: &Paths,
        folder_path: &Path,
        content_type: LibraryContentType,
        recursive: bool,
    ) -> Result<ImportResult> {
        let mut result = ImportResult::default();

        if !folder_path.exists() {
            bail!("folder not found: {}", folder_path.display());
        }

        self.import_folder_inner(paths, folder_path, content_type, recursive, &mut result)?;
        Ok(result)
    }

    fn import_folder_inner(
        &self,
        paths: &Paths,
        folder_path: &Path,
        content_type: LibraryContentType,
        recursive: bool,
        result: &mut ImportResult,
    ) -> Result<()> {
        for entry in fs::read_dir(folder_path)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                if recursive {
                    self.import_folder_inner(paths, &path, content_type, recursive, result)?;
                }
            } else if self.is_importable_file(&path, content_type) {
                match self.import_file(paths, &path, content_type) {
                    Ok(_) => result.added += 1,
                    Err(e) => {
                        // Check if it's a duplicate
                        if e.to_string().contains("UNIQUE constraint failed") {
                            result.skipped += 1;
                        } else {
                            result.errors.push(format!("{}: {}", path.display(), e));
                        }
                    }
                }
            }
        }

        Ok(())
    }

    fn is_importable_file(&self, path: &Path, content_type: LibraryContentType) -> bool {
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase());

        match content_type {
            LibraryContentType::Mod => {
                matches!(ext.as_deref(), Some("jar"))
            }
            LibraryContentType::ResourcePack | LibraryContentType::ShaderPack => {
                matches!(ext.as_deref(), Some("zip") | Some("jar"))
            }
            LibraryContentType::Skin => {
                matches!(ext.as_deref(), Some("png"))
            }
        }
    }

    fn content_store_path(
        &self,
        paths: &Paths,
        content_type: LibraryContentType,
        hash: &str,
    ) -> PathBuf {
        match content_type {
            LibraryContentType::Mod => paths.store_mod_path(hash),
            LibraryContentType::ResourcePack => paths.store_resourcepack_path(hash),
            LibraryContentType::ShaderPack => paths.store_shaderpack_path(hash),
            LibraryContentType::Skin => paths.store_skin_path(hash),
        }
    }

    // ========== Statistics ==========

    /// Get library statistics
    pub fn stats(&self) -> Result<LibraryStats> {
        let total_items: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM library_items", [], |row| row.get(0))?;

        let mods_count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM library_items WHERE content_type = 'mod'",
            [],
            |row| row.get(0),
        )?;

        let resourcepacks_count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM library_items WHERE content_type = 'resourcepack'",
            [],
            |row| row.get(0),
        )?;

        let shaderpacks_count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM library_items WHERE content_type = 'shaderpack'",
            [],
            |row| row.get(0),
        )?;

        let skins_count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM library_items WHERE content_type = 'skin'",
            [],
            |row| row.get(0),
        )?;

        let total_size: u64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(file_size), 0) FROM library_items",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let tags_count: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))?;

        Ok(LibraryStats {
            total_items,
            mods_count,
            resourcepacks_count,
            shaderpacks_count,
            skins_count,
            total_size,
            tags_count,
        })
    }

    /// Sync library with content store (find items in store not in library)
    pub fn sync_with_store(&self, paths: &Paths) -> Result<ImportResult> {
        let mut result = ImportResult::default();

        // Sync each content type
        for (store_dir, content_type) in [
            (&paths.store_mods, LibraryContentType::Mod),
            (&paths.store_resourcepacks, LibraryContentType::ResourcePack),
            (&paths.store_shaderpacks, LibraryContentType::ShaderPack),
            (&paths.store_skins, LibraryContentType::Skin),
        ] {
            if !store_dir.exists() {
                continue;
            }

            for entry in fs::read_dir(store_dir)? {
                let entry = entry?;
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                let hash = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default();

                // Check if already in library
                if self.get_item_by_hash(hash)?.is_some() {
                    result.skipped += 1;
                    continue;
                }

                // Add to library
                let metadata = fs::metadata(&path)?;
                let hash_prefix = hash.get(..8).unwrap_or(hash);
                match self.add_item(&LibraryItemInput {
                    hash: hash.to_string(),
                    content_type: Some(content_type.as_str().to_string()),
                    name: Some(format!("{}-{}", content_type.as_str(), hash_prefix)),
                    file_size: Some(metadata.len() as i64),
                    source_platform: Some("store".to_string()),
                    ..Default::default()
                }) {
                    Ok(_) => result.added += 1,
                    Err(e) => result.errors.push(format!("{}: {}", hash, e)),
                }
            }
        }

        Ok(result)
    }

    // ========== Purge Unused Items ==========

    /// Get all unused items (items not referenced by any profile)
    /// Note: Skins are excluded from unused detection since they may be in use by accounts
    /// and are not tracked via profile_items like mods/resourcepacks/shaderpacks.
    pub fn get_unused_items(&self) -> Result<UnusedItemsSummary> {
        let mut summary = UnusedItemsSummary::default();

        // Query items that have no entries in profile_items
        // Exclude skins since they may be actively used by accounts
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, hash, content_type, name, file_size
            FROM library_items
            WHERE id NOT IN (SELECT DISTINCT item_id FROM profile_items)
              AND content_type != 'skin'
            ORDER BY content_type, name
            "#,
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(UnusedItem {
                id: row.get(0)?,
                hash: row.get(1)?,
                content_type: LibraryContentType::from_str(&row.get::<_, String>(2)?)
                    .unwrap_or(LibraryContentType::Mod),
                name: row.get(3)?,
                file_size: row.get(4)?,
            })
        })?;

        for row in rows {
            let item = row?;
            let size = item.file_size.unwrap_or(0) as u64;
            summary.total_bytes += size;
            summary.total_count += 1;

            match item.content_type {
                LibraryContentType::Mod => summary.mods.push(item),
                LibraryContentType::ResourcePack => summary.resourcepacks.push(item),
                LibraryContentType::ShaderPack => summary.shaderpacks.push(item),
                LibraryContentType::Skin => summary.skins.push(item),
            }
        }

        Ok(summary)
    }

    /// Purge unused items from the library and optionally from the store
    pub fn purge_unused_items(
        &self,
        paths: &Paths,
        content_types: &[LibraryContentType],
        delete_files: bool,
    ) -> Result<PurgeResult> {
        let mut result = PurgeResult::default();
        let unused = self.get_unused_items()?;

        // Collect items to delete based on selected content types
        let items_to_delete: Vec<UnusedItem> = if content_types.is_empty() {
            // Delete all unused if no filter specified
            unused.mods.into_iter()
                .chain(unused.resourcepacks)
                .chain(unused.shaderpacks)
                .chain(unused.skins)
                .collect()
        } else {
            let mut items = Vec::new();
            for ct in content_types {
                match ct {
                    LibraryContentType::Mod => items.extend(unused.mods.clone()),
                    LibraryContentType::ResourcePack => items.extend(unused.resourcepacks.clone()),
                    LibraryContentType::ShaderPack => items.extend(unused.shaderpacks.clone()),
                    LibraryContentType::Skin => items.extend(unused.skins.clone()),
                }
            }
            items
        };

        for item in items_to_delete {
            // Delete file from store if requested
            if delete_files {
                let store_path = self.content_store_path(paths, item.content_type, &item.hash);
                if store_path.exists() {
                    if let Err(e) = fs::remove_file(&store_path) {
                        result.errors.push(format!("Failed to delete {}: {}", item.name, e));
                        continue;
                    }
                }
            }

            // Delete from library database
            match self.delete_item(item.id) {
                Ok(true) => {
                    result.freed_bytes += item.file_size.unwrap_or(0) as u64;
                    result.deleted_count += 1;
                    result.items.push(item);
                }
                Ok(false) => {
                    result.errors.push(format!("Item {} not found in database", item.name));
                }
                Err(e) => {
                    result.errors.push(format!("Failed to delete {} from library: {}", item.name, e));
                }
            }
        }

        Ok(result)
    }
}
