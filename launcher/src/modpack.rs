use crate::paths::Paths;
use crate::profile::{ContentRef, Loader, Profile, Runtime, create_profile, load_profile, save_profile, upsert_mod, upsert_resourcepack, upsert_shaderpack};
use crate::store::{ContentKind, store_content, store_from_url};
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use sha1::{Sha1, Digest};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::ZipArchive;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ModrinthIndex {
    #[serde(rename = "formatVersion")]
    format_version: u32,
    game: String,
    #[serde(rename = "versionId")]
    version_id: String,
    name: String,
    #[serde(default)]
    summary: Option<String>,
    files: Vec<ModrinthFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct ModrinthFile {
    path: String,
    hashes: ModrinthHashes,
    downloads: Vec<String>,
    #[serde(default)]
    env: Option<ModrinthEnv>,
    #[serde(rename = "fileSize")]
    file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ModrinthHashes {
    sha1: String,
    sha512: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ModrinthEnv {
    client: Option<String>,
    server: Option<String>,
}

pub fn import_mrpack(paths: &Paths, pack_path: &Path, profile_id: Option<&str>) -> Result<Profile> {
    let file = fs::File::open(pack_path)
        .with_context(|| format!("failed to open modpack: {}", pack_path.display()))?;
    let mut zip = ZipArchive::new(file).context("failed to read modpack zip")?;

    let index = read_modrinth_index(&mut zip)?;
    validate_index(&index)?;

    let (mc_version, loader) = resolve_dependencies(&index.dependencies)?;

    let profile_id = resolve_profile_id(paths, &index.name, profile_id)?;
    if paths.is_profile_present(&profile_id) {
        bail!("profile already exists: {}", profile_id);
    }

    create_profile(paths, &profile_id, &mc_version, loader, Runtime::default())?;

    let overrides_dir = paths.profile_overrides(&profile_id);
    extract_overrides(&mut zip, &overrides_dir)?;

    let mut profile = load_profile(paths, &profile_id)?;
    for file in &index.files {
        if !is_client_allowed(&file.env) {
            continue;
        }
        let rel_path = sanitize_rel_path(&file.path)?;
        let (download_path, download_url) = download_with_hash(paths, file)?;

        match content_kind_for_path(&file.path) {
            Some(kind) => {
                let file_name_override = rel_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string());
                let stored = store_content(
                    paths,
                    kind,
                    &download_path,
                    Some(download_url.clone()),
                    file_name_override,
                )?;
                let content_ref = ContentRef {
                    name: stored.name,
                    hash: stored.hash,
                    version: None,
                    source: stored.source,
                    file_name: Some(stored.file_name),
                    platform: None,
                    project_id: None,
                    version_id: None,
                    enabled: true,
                    pinned: false,
                };
                match kind {
                    ContentKind::Mod => { upsert_mod(&mut profile, content_ref); }
                    ContentKind::ResourcePack => { upsert_resourcepack(&mut profile, content_ref); }
                    ContentKind::ShaderPack => { upsert_shaderpack(&mut profile, content_ref); }
                    ContentKind::Skin => {}
                }
            }
            None => {
                write_override_file(&overrides_dir, &rel_path, &download_path)?;
            }
        }
    }

    save_profile(paths, &profile)?;
    Ok(profile)
}

fn read_modrinth_index<R: Read + Seekable>(zip: &mut ZipArchive<R>) -> Result<ModrinthIndex> {
    let mut index_file = zip
        .by_name("modrinth.index.json")
        .context("modrinth.index.json not found in modpack")?;
    let mut data = String::new();
    index_file
        .read_to_string(&mut data)
        .context("failed to read modrinth.index.json")?;
    let index: ModrinthIndex = serde_json::from_str(&data)
        .context("failed to parse modrinth.index.json")?;
    Ok(index)
}

fn validate_index(index: &ModrinthIndex) -> Result<()> {
    if index.format_version != 1 {
        bail!("unsupported modpack format version: {}", index.format_version);
    }
    if index.game != "minecraft" {
        bail!("unsupported modpack game: {}", index.game);
    }
    Ok(())
}

fn resolve_dependencies(deps: &HashMap<String, String>) -> Result<(String, Option<Loader>)> {
    let mc_version = deps
        .get("minecraft")
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("modpack missing minecraft dependency"))?;

    if deps.contains_key("forge") || deps.contains_key("neoforge") {
        bail!("Forge/NeoForge modpacks are not supported yet");
    }

    let loader = if let Some(version) = deps.get("fabric-loader") {
        Some(Loader { loader_type: "fabric".to_string(), version: version.clone() })
    } else if let Some(version) = deps.get("quilt-loader") {
        Some(Loader { loader_type: "quilt".to_string(), version: version.clone() })
    } else {
        None
    };

    Ok((mc_version, loader))
}

fn resolve_profile_id(paths: &Paths, name: &str, requested: Option<&str>) -> Result<String> {
    if let Some(id) = requested {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            bail!("profile id cannot be empty");
        }
        return Ok(trimmed.to_string());
    }

    let base = slugify(name);
    let base = if base.is_empty() { "modpack".to_string() } else { base };
    let mut candidate = base.clone();
    let mut idx = 1;
    while paths.is_profile_present(&candidate) {
        idx += 1;
        candidate = format!("{}-{}", base, idx);
    }
    Ok(candidate)
}

fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in input.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn content_kind_for_path(path: &str) -> Option<ContentKind> {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.trim_start_matches("./");
    if normalized.starts_with("mods/") {
        Some(ContentKind::Mod)
    } else if normalized.starts_with("resourcepacks/") {
        Some(ContentKind::ResourcePack)
    } else if normalized.starts_with("shaderpacks/") {
        Some(ContentKind::ShaderPack)
    } else {
        None
    }
}

fn is_client_allowed(env: &Option<ModrinthEnv>) -> bool {
    match env.as_ref().and_then(|e| e.client.as_ref()) {
        Some(flag) if flag == "unsupported" => false,
        _ => true,
    }
}

fn sanitize_rel_path(path: &str) -> Result<PathBuf> {
    let mut out = PathBuf::new();
    for comp in Path::new(path).components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => bail!("invalid path in modpack: {}", path),
        }
    }
    if out.as_os_str().is_empty() {
        bail!("invalid empty path in modpack");
    }
    Ok(out)
}

fn download_with_hash(paths: &Paths, file: &ModrinthFile) -> Result<(PathBuf, String)> {
    if file.downloads.is_empty() {
        bail!("modpack file has no downloads: {}", file.path);
    }

    let expected_sha1 = file.hashes.sha1.to_lowercase();
    for url in &file.downloads {
        let (download_path, _file_name) = store_from_url(paths, url)?;
        let actual = sha1_file(&download_path)?;
        if actual == expected_sha1 {
            if let Some(expected_size) = file.file_size {
                let actual_size = fs::metadata(&download_path)?.len();
                if actual_size != expected_size {
                    bail!("file size mismatch for {}", file.path);
                }
            }
            return Ok((download_path, url.clone()));
        }
    }

    bail!("hash mismatch for {}", file.path)
}

fn sha1_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("failed to open file for hashing: {}", path.display()))?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf).context("failed to read file")?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn extract_overrides<R: Read + Seekable>(zip: &mut ZipArchive<R>, overrides_dir: &Path) -> Result<()> {
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).context("failed to read zip entry")?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();
        let (prefix, rest) = if name.starts_with("overrides/") {
            ("overrides/", &name["overrides/".len()..])
        } else if name.starts_with("client-overrides/") {
            ("client-overrides/", &name["client-overrides/".len()..])
        } else {
            continue;
        };
        let _ = prefix; // prefix reserved for clarity
        if rest.is_empty() {
            continue;
        }
        let rel = sanitize_rel_path(rest)?;
        let target = overrides_dir.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&target)
            .with_context(|| format!("failed to write override file: {}", target.display()))?;
        std::io::copy(&mut file, &mut out)
            .with_context(|| format!("failed to extract override file: {}", name))?;
        out.flush().ok();
    }
    Ok(())
}

fn write_override_file(overrides_dir: &Path, rel_path: &Path, src: &Path) -> Result<()> {
    let target = overrides_dir.join(rel_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, &target).with_context(|| {
        format!(
            "failed to copy override file to {}",
            target.display()
        )
    })?;
    Ok(())
}

// Trait alias workaround to keep ZipArchive generic bounds tidy
trait Seekable: std::io::Seek {}
impl<T: std::io::Seek> Seekable for T {}
