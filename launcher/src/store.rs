use crate::paths::Paths;
use crate::util::sanitize_filename;
use anyhow::{Context, Result, bail};
use reqwest::Url;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
pub enum ContentKind {
    Mod,
    ResourcePack,
    ShaderPack,
    Skin,
}

#[derive(Debug, Clone)]
pub struct StoredContent {
    pub hash: String,
    pub name: String,
    pub file_name: String,
    pub source: Option<String>,
}

impl ContentKind {
    pub fn label(self) -> &'static str {
        match self {
            ContentKind::Mod => "mod",
            ContentKind::ResourcePack => "resourcepack",
            ContentKind::ShaderPack => "shaderpack",
            ContentKind::Skin => "skin",
        }
    }
}

pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("failed to open file for hashing: {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 64];
    loop {
        let read = file
            .read(&mut buf)
            .context("failed to read file for hashing")?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let digest = hasher.finalize();
    Ok(hex::encode(digest))
}

pub fn normalize_hash(input: &str) -> &str {
    input.strip_prefix("sha256:").unwrap_or(input)
}

pub fn store_content(
    paths: &Paths,
    kind: ContentKind,
    input_path: &Path,
    source: Option<String>,
    file_name_override: Option<String>,
) -> Result<StoredContent> {
    if !input_path.exists() {
        bail!("file not found: {}", input_path.display());
    }

    let hash_hex = hash_file(input_path)?;
    let store_path = content_store_path(paths, kind, &hash_hex);
    if !store_path.exists() {
        fs::copy(input_path, &store_path).with_context(|| {
            format!(
                "failed to copy {} to store {}",
                input_path.display(),
                store_path.display()
            )
        })?;
    }

    let file_name = file_name_override
        .or_else(|| {
            input_path
                .file_name()
                .and_then(|s| s.to_str())
                .map(sanitize_filename)
        })
        .unwrap_or_else(|| format!("{}-{}.zip", kind.label(), &hash_hex[..8]));
    let name = Path::new(&file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}-{}", kind.label(), &hash_hex[..8]));

    Ok(StoredContent {
        hash: format!("sha256:{hash_hex}"),
        name,
        file_name,
        source,
    })
}

pub fn store_from_url(paths: &Paths, url: &str) -> Result<(PathBuf, String)> {
    let parsed = Url::parse(url).context("invalid url")?;
    let file_name = parsed
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.is_empty())
        .unwrap_or("download.zip");

    let file_name = sanitize_filename(file_name);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .context("time went backwards")?
        .as_secs();
    let download_path = paths
        .cache_downloads
        .join(format!("{}-{}", timestamp, file_name));

    let mut response = reqwest::blocking::get(parsed)?.error_for_status()?;
    let mut out = fs::File::create(&download_path).with_context(|| {
        format!(
            "failed to create download file: {}",
            download_path.display()
        )
    })?;
    std::io::copy(&mut response, &mut out).context("failed to write download file")?;
    out.flush().context("failed to flush download file")?;

    Ok((download_path, file_name))
}

pub fn content_store_path(paths: &Paths, kind: ContentKind, hash: &str) -> PathBuf {
    let hash_hex = normalize_hash(hash);
    match kind {
        ContentKind::Mod => paths.store_mod_path(hash_hex),
        ContentKind::ResourcePack => paths.store_resourcepack_path(hash_hex),
        ContentKind::ShaderPack => paths.store_shaderpack_path(hash_hex),
        ContentKind::Skin => paths.store_skin_path(hash_hex),
    }
}
