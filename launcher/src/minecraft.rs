use crate::instance::materialize_instance;
use crate::paths::Paths;
use crate::profile::{Loader, Profile};
use crate::util::normalize_path_separator;
use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::Value;
use sha1::{Digest, Sha1};
use shell_words::split;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const LIBRARIES_BASE: &str = "https://libraries.minecraft.net/";

#[derive(Debug, Clone)]
pub struct LaunchAccount {
    pub uuid: String,
    pub username: String,
    pub access_token: String,
    pub xuid: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LaunchPlan {
    pub instance_dir: PathBuf,
    pub java_exec: String,
    pub jvm_args: Vec<String>,
    pub classpath: String,
    pub main_class: String,
    pub game_args: Vec<String>,
}

pub fn prepare(paths: &Paths, profile: &Profile, account: &LaunchAccount) -> Result<LaunchPlan> {
    let instance_dir = materialize_instance(paths, profile)?;

    let java_path = profile.runtime.java.as_deref();
    let version_id = resolve_version_id(paths, &profile.mc_version, profile.loader.as_ref(), java_path)?;
    let resolved = resolve_version(paths, &version_id)?;
    let version = resolved.merged;

    // Collect client JARs from versions in the chain.
    // Forge/NeoForge handle the client JAR internally via their processed JARs,
    // so we shouldn't add the vanilla client JAR to the classpath for those loaders.
    let is_forge_loader = profile.loader.as_ref().map_or(false, |l| {
        l.loader_type == "forge" || l.loader_type == "neoforge"
    });

    let mut client_jars = Vec::new();
    for entry in &resolved.chain {
        if entry.downloads.is_some() {
            let jar_path = ensure_client_jar(paths, entry)?;
            // For Forge/NeoForge, download the client JAR (needed for processing)
            // but don't add it to the classpath - they handle it internally
            if !is_forge_loader {
                client_jars.push(jar_path);
            }
        }
    }

    let asset_index_id = ensure_assets(paths, &version)?;
    let (classpath, natives_dir) = ensure_libraries(paths, &version, &instance_dir, &client_jars)?;

    let java_exec = resolve_java(profile.runtime.java.as_deref());
    let assets_root = paths
        .minecraft_assets_objects
        .parent()
        .context("assets root missing")?
        .to_path_buf();

    let vars = build_var_map(
        &instance_dir,
        &assets_root,
        &asset_index_id,
        &classpath,
        &natives_dir,
        &paths.minecraft_libraries,
        &version,
        account,
    );

    let (mut jvm_args, game_args) = build_args(&version, &vars)?;

    if let Some(memory) = &profile.runtime.memory
        && !jvm_args.iter().any(|arg| arg.starts_with("-Xmx")) {
            jvm_args.push(format!("-Xmx{memory}"));
        }

    if !profile.runtime.args.is_empty() {
        jvm_args.extend(profile.runtime.args.iter().cloned());
    }

    ensure_jvm_flag(&mut jvm_args, "-Djava.library.path", &natives_dir)?;
    strip_classpath_args(&mut jvm_args);

    let main_class = version
        .main_class
        .clone()
        .context("mainClass missing from version JSON")?;

    Ok(LaunchPlan {
        instance_dir,
        java_exec,
        jvm_args,
        classpath,
        main_class,
        game_args,
    })
}

pub fn launch(paths: &Paths, profile: &Profile, account: &LaunchAccount) -> Result<()> {
    let plan = prepare(paths, profile, account)?;

    let status = Command::new(&plan.java_exec)
        .args(&plan.jvm_args)
        .arg("-cp")
        .arg(&plan.classpath)
        .arg(&plan.main_class)
        .args(&plan.game_args)
        .current_dir(&plan.instance_dir)
        .status()
        .context("failed to launch java")?;

    if !status.success() {
        bail!("minecraft exited with status {status}");
    }

    Ok(())
}

fn resolve_version_id(paths: &Paths, mc_version: &str, loader: Option<&Loader>, java: Option<&str>) -> Result<String> {
    match loader {
        None => Ok(mc_version.to_string()),
        Some(loader) => match loader.loader_type.as_str() {
            "fabric" => ensure_fabric_profile(paths, mc_version, &loader.version),
            "quilt" => ensure_quilt_profile(paths, mc_version, &loader.version),
            "neoforge" => ensure_neoforge_profile(paths, mc_version, &loader.version, java),
            "forge" => ensure_forge_profile(paths, mc_version, &loader.version, java),
            other => bail!("unsupported loader type: {other}"),
        },
    }
}

/// Fetch the latest stable Fabric loader version from the Fabric Meta API
fn resolve_fabric_latest_version() -> Result<String> {
    let url = "https://meta.fabricmc.net/v2/versions/loader";
    let json = download_json(url)?;
    let versions = json.as_array().context("fabric loader versions not an array")?;

    // Find the first stable version
    for entry in versions {
        if entry.get("stable").and_then(|v| v.as_bool()).unwrap_or(false) {
            if let Some(version) = entry.get("version").and_then(|v| v.as_str()) {
                return Ok(version.to_string());
            }
        }
    }

    // Fallback to first version if no stable found
    versions.first()
        .and_then(|v| v.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .context("no fabric loader versions found")
}

fn ensure_fabric_profile(paths: &Paths, mc_version: &str, loader_version: &str) -> Result<String> {
    // Resolve "latest" to actual version number
    let resolved_version = if loader_version.eq_ignore_ascii_case("latest") {
        resolve_fabric_latest_version()?
    } else {
        loader_version.to_string()
    };

    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{mc_version}/{resolved_version}/profile/json"
    );
    let profile_json = download_json(&url)?;
    let id = profile_json
        .get("id")
        .and_then(|v| v.as_str())
        .context("fabric profile missing id")?;
    let target = paths.minecraft_version_json(id);
    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create version dir: {}", parent.display()))?;
        }
        fs::write(&target, serde_json::to_string_pretty(&profile_json)?).with_context(|| {
            format!("failed to write fabric version json: {}", target.display())
        })?;
    }
    Ok(id.to_string())
}

/// Fetch the latest Quilt loader version from the Quilt Meta API
fn resolve_quilt_latest_version() -> Result<String> {
    let url = "https://meta.quiltmc.org/v3/versions/loader";
    let json = download_json(url)?;
    let versions = json.as_array().context("quilt loader versions not an array")?;

    // Return the first version (they're sorted by newest first)
    versions.first()
        .and_then(|v| v.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .context("no quilt loader versions found")
}

fn ensure_quilt_profile(paths: &Paths, mc_version: &str, loader_version: &str) -> Result<String> {
    // Resolve "latest" to actual version number
    let resolved_version = if loader_version.eq_ignore_ascii_case("latest") {
        resolve_quilt_latest_version()?
    } else {
        loader_version.to_string()
    };

    let url = format!(
        "https://meta.quiltmc.org/v3/versions/loader/{mc_version}/{resolved_version}/profile/json"
    );
    let profile_json = download_json(&url)?;
    let id = profile_json
        .get("id")
        .and_then(|v| v.as_str())
        .context("quilt profile missing id")?;
    let target = paths.minecraft_version_json(id);
    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create version dir: {}", parent.display()))?;
        }
        fs::write(&target, serde_json::to_string_pretty(&profile_json)?).with_context(|| {
            format!("failed to write quilt version json: {}", target.display())
        })?;
    }
    Ok(id.to_string())
}

/// Fetch the latest NeoForge version for a given Minecraft version
fn resolve_neoforge_latest_version(mc_version: &str) -> Result<String> {
    // NeoForge versions are based on MC version without the leading "1." (e.g., 1.21.1 -> 21.1)
    let filter = mc_version.strip_prefix("1.").unwrap_or(mc_version);
    let url = format!(
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge?filter={}.",
        filter
    );
    let json = download_json(&url)?;
    let versions = json.get("versions")
        .and_then(|v| v.as_array())
        .context("neoforge versions not an array")?;

    // Return the last version (they're sorted oldest first, so last is newest)
    versions.last()
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .context("no neoforge versions found for this minecraft version")
}

fn ensure_neoforge_profile(paths: &Paths, mc_version: &str, loader_version: &str, java: Option<&str>) -> Result<String> {
    // Resolve "latest" to actual version number
    let resolved_version = if loader_version.eq_ignore_ascii_case("latest") {
        resolve_neoforge_latest_version(mc_version)?
    } else {
        loader_version.to_string()
    };

    // NeoForge version format: just the loader version (e.g., "21.4.156")
    // The installer JAR is at: maven.neoforged.net/releases/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar
    // Note: loader_version should NOT contain the MC version prefix

    let id = format!("neoforge-{resolved_version}");
    let target = paths.minecraft_version_json(&id);

    if target.exists() {
        return Ok(id);
    }

    // Download installer JAR
    let installer_url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{resolved_version}/neoforge-{resolved_version}-installer.jar"
    );

    let installer_path = paths.cache_downloads.join(format!("neoforge-{resolved_version}-installer.jar"));
    download_with_sha1(&installer_url, &installer_path, None)?;

    // Run the installer to process libraries and generate SRG jars.
    // NeoForge installer creates the version with ID "neoforge-{version}" which matches our format.
    run_forge_installer(paths, &installer_path, java)?;

    // Verify the installer created the expected version
    if !target.exists() {
        bail!("NeoForge installer did not create expected version: {}", id);
    }

    Ok(id)
}

/// Fetch the latest Forge version for a given Minecraft version
fn resolve_forge_latest_version(mc_version: &str) -> Result<String> {
    let url = "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json";
    let json = download_json(url)?;
    let promos = json.get("promos")
        .and_then(|v| v.as_object())
        .context("forge promos not an object")?;

    // Try recommended first, then latest
    let recommended_key = format!("{}-recommended", mc_version);
    let latest_key = format!("{}-latest", mc_version);

    if let Some(version) = promos.get(&recommended_key).and_then(|v| v.as_str()) {
        return Ok(version.to_string());
    }
    if let Some(version) = promos.get(&latest_key).and_then(|v| v.as_str()) {
        return Ok(version.to_string());
    }

    bail!("no forge version found for minecraft {}", mc_version)
}

fn ensure_forge_profile(paths: &Paths, mc_version: &str, loader_version: &str, java: Option<&str>) -> Result<String> {
    // Resolve "latest" to actual version number
    let resolved_loader = if loader_version.eq_ignore_ascii_case("latest") {
        resolve_forge_latest_version(mc_version)?
    } else {
        loader_version.to_string()
    };

    // Forge version format: MC-ForgeVersion (e.g., "1.20.1-47.3.0")
    let version_id = if resolved_loader.contains('-') {
        resolved_loader
    } else {
        format!("{mc_version}-{resolved_loader}")
    };

    let id = format!("forge-{version_id}");
    let target = paths.minecraft_version_json(&id);

    if target.exists() {
        return Ok(id);
    }

    // Download installer JAR
    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{version_id}/forge-{version_id}-installer.jar"
    );

    let installer_path = paths.cache_downloads.join(format!("forge-{version_id}-installer.jar"));
    download_with_sha1(&installer_url, &installer_path, None)?;

    // Run the installer to process libraries and generate SRG jars.
    // The installer creates the version at {mc_version}-forge-{forge_version}
    // (e.g., "1.20.1-forge-47.4.10").
    run_forge_installer(paths, &installer_path, java)?;

    // The installer created a version with its own ID format.
    // Read that version and copy it with our ID format.
    // Use splitn(2, '-') to handle legacy Forge version formats with multiple dashes
    // (e.g., "1.7.10-10.13.4.1614-1.7.10" should extract "10.13.4.1614-1.7.10")
    let forge_version = version_id.splitn(2, '-').nth(1).unwrap_or(&version_id);
    let installer_id = format!("{mc_version}-forge-{forge_version}");
    let installer_json_path = paths.minecraft_version_json(&installer_id);

    let profile_json = fs::read_to_string(&installer_json_path)
        .with_context(|| format!("installer did not create expected version: {}", installer_id))?;

    // Modify the profile to use our ID
    let mut profile: Value = serde_json::from_str(&profile_json)?;
    profile["id"] = serde_json::json!(id);

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create version dir: {}", parent.display()))?;
    }
    fs::write(&target, serde_json::to_string_pretty(&profile)?).with_context(|| {
        format!("failed to write forge version json: {}", target.display())
    })?;

    Ok(id)
}

fn extract_version_json_from_jar(jar_path: &Path, json_name: &str) -> Result<String> {
    let file = fs::File::open(jar_path)
        .with_context(|| format!("failed to open installer jar: {}", jar_path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("failed to read installer jar: {}", jar_path.display()))?;

    let mut version_json = archive.by_name(json_name)
        .with_context(|| format!("{} not found in installer jar", json_name))?;

    let mut contents = String::new();
    version_json.read_to_string(&mut contents)
        .with_context(|| format!("failed to read {} from installer", json_name))?;

    Ok(contents)
}

/// Run the Forge/NeoForge installer to process libraries and generate SRG jars.
/// The installer creates the necessary processed artifacts that aren't available via Maven.
fn run_forge_installer(paths: &Paths, installer_path: &Path, java: Option<&str>) -> Result<()> {
    let java = resolve_java(java);

    // Derive minecraft_dir from minecraft_versions path
    let minecraft_dir = paths
        .minecraft_versions
        .parent()
        .context("could not determine minecraft directory")?;

    eprintln!(
        "Running installer to process libraries (this may take a minute)..."
    );

    let status = Command::new(&java)
        .arg("-jar")
        .arg(installer_path)
        .arg("--installClient")
        .arg(minecraft_dir)
        .status()
        .context("failed to run forge installer")?;

    if !status.success() {
        bail!("forge installer failed with status {status}");
    }

    Ok(())
}

#[derive(Clone)]
struct ResolvedVersion {
    merged: VersionJson,
    chain: Vec<VersionJson>,
}

fn resolve_version(paths: &Paths, id: &str) -> Result<ResolvedVersion> {
    let mut chain = Vec::new();
    let mut seen = Vec::new();
    let mut current = load_version_json(paths, id)?;
    loop {
        if seen.contains(&current.id) {
            bail!("version inheritance cycle detected: {}", current.id);
        }
        seen.push(current.id.clone());
        chain.push(current.clone());
        if let Some(parent) = current.inherits_from.clone() {
            current = load_version_json(paths, &parent)?;
        } else {
            break;
        }
    }

    let mut merged = chain.last().cloned().context("version chain was empty")?;
    for child in chain.iter().rev().skip(1) {
        merged = merge_versions(merged, child.clone());
    }

    Ok(ResolvedVersion { merged, chain })
}

fn load_version_json(paths: &Paths, id: &str) -> Result<VersionJson> {
    let path = paths.minecraft_version_json(id);
    if path.exists() {
        let data = fs::read_to_string(&path)
            .with_context(|| format!("failed to read version json: {}", path.display()))?;
        let json: VersionJson = serde_json::from_str(&data)
            .with_context(|| format!("failed to parse version json: {}", path.display()))?;
        return Ok(json);
    }

    let manifest = load_version_manifest(paths)?;
    let entry = manifest
        .versions
        .iter()
        .find(|v| v.id == id)
        .with_context(|| format!("version not found in manifest: {id}"))?;

    let data = download_text(&entry.url)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create version dir: {}", parent.display()))?;
    }
    fs::write(&path, &data)
        .with_context(|| format!("failed to write version json: {}", path.display()))?;

    let json: VersionJson = serde_json::from_str(&data)
        .with_context(|| format!("failed to parse version json: {}", path.display()))?;
    Ok(json)
}

fn load_version_manifest(paths: &Paths) -> Result<VersionManifest> {
    const CACHE_TTL_SECS: u64 = 24 * 60 * 60; // 24 hours

    let cache_path = paths.cache_manifest("version_manifest_v2.json");
    if cache_path.exists() {
        // Check if cache is still valid (within TTL)
        let cache_valid = cache_path
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|modified| {
                std::time::SystemTime::now()
                    .duration_since(modified)
                    .ok()
            })
            .map(|age| age.as_secs() < CACHE_TTL_SECS)
            .unwrap_or(false);

        if cache_valid {
            let data = fs::read_to_string(&cache_path).with_context(|| {
                format!(
                    "failed to read version manifest cache: {}",
                    cache_path.display()
                )
            })?;
            if let Ok(manifest) = serde_json::from_str::<VersionManifest>(&data) {
                return Ok(manifest);
            }
        }
    }

    let data = download_text(VERSION_MANIFEST_URL)?;
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create manifest dir: {}", parent.display()))?;
    }
    fs::write(&cache_path, &data).with_context(|| {
        format!(
            "failed to write version manifest cache: {}",
            cache_path.display()
        )
    })?;

    let manifest: VersionManifest =
        serde_json::from_str(&data).context("failed to parse version manifest")?;
    Ok(manifest)
}

fn ensure_client_jar(paths: &Paths, version: &VersionJson) -> Result<PathBuf> {
    let downloads = version
        .downloads
        .as_ref()
        .context("downloads missing from version json")?;
    let client = downloads
        .client
        .as_ref()
        .context("client download missing from version json")?;
    let jar_path = paths.minecraft_version_jar(&version.id);
    download_with_sha1(&client.url, &jar_path, Some(&client.sha1))?;
    Ok(jar_path)
}

fn ensure_assets(paths: &Paths, version: &VersionJson) -> Result<String> {
    let asset_index = version
        .asset_index
        .as_ref()
        .context("assetIndex missing from version json")?;

    let index_path = paths.minecraft_asset_index(&asset_index.id);
    download_with_sha1(&asset_index.url, &index_path, Some(&asset_index.sha1))?;

    let data = fs::read_to_string(&index_path)
        .with_context(|| format!("failed to read asset index: {}", index_path.display()))?;
    let index: AssetIndex = serde_json::from_str(&data).context("failed to parse asset index")?;

    for (name, object) in index.objects {
        let _ = name; // reserved for future logging
        if object.hash.len() < 2 {
            continue;
        }
        let object_path = paths.minecraft_asset_object(&object.hash);
        let url = object.url.clone().unwrap_or_else(|| {
            format!(
                "https://resources.download.minecraft.net/{}/{}",
                &object.hash[0..2],
                object.hash
            )
        });
        download_with_sha1(&url, &object_path, Some(&object.hash))?;
    }

    Ok(asset_index.id.clone())
}

fn ensure_libraries(
    paths: &Paths,
    version: &VersionJson,
    instance_dir: &Path,
    client_jars: &[PathBuf],
) -> Result<(String, PathBuf)> {
    let mut classpath = Vec::new();
    let natives_dir = instance_dir.join("natives");
    if natives_dir.exists() {
        fs::remove_dir_all(&natives_dir).with_context(|| {
            format!(
                "failed to clear natives directory: {}",
                natives_dir.display()
            )
        })?;
    }
    fs::create_dir_all(&natives_dir)
        .with_context(|| format!("failed to create natives dir: {}", natives_dir.display()))?;

    for library in &version.libraries {
        if !library_allowed(library) {
            continue;
        }

        if let Some(artifact) = library
            .downloads
            .as_ref()
            .and_then(|downloads| downloads.artifact.as_ref())
        {
            let lib_path = paths.minecraft_library_path(&artifact.path);
            download_with_sha1(&artifact.url, &lib_path, Some(&artifact.sha1))?;
            classpath.push(lib_path);
        } else if let Some(path) = maven_path_from_name(&library.name) {
            let base_url = library.url.as_deref().unwrap_or(LIBRARIES_BASE);
            let url = join_url(base_url, &path);
            let lib_path = paths.minecraft_library_path(&path);
            download_with_sha1(&url, &lib_path, None)?;
            classpath.push(lib_path);
        }

        if let Some(natives) = library.natives.as_ref()
            && let Some(classifier) = natives.get(&os_key()) {
                let classifier = classifier.replace("${arch}", arch_marker());
                if let Some(native_artifact) = library
                    .downloads
                    .as_ref()
                    .and_then(|downloads| downloads.classifiers.as_ref())
                    .and_then(|classifiers| classifiers.get(&classifier))
                {
                    let jar_path = paths.minecraft_library_path(&native_artifact.path);
                    download_with_sha1(
                        &native_artifact.url,
                        &jar_path,
                        Some(&native_artifact.sha1),
                    )?;
                    extract_natives(&jar_path, &natives_dir, library.extract.as_ref())?;
                } else if let Some(path) =
                    maven_path_from_name_with_classifier(&library.name, &classifier)
                {
                    let base_url = library.url.as_deref().unwrap_or(LIBRARIES_BASE);
                    let url = join_url(base_url, &path);
                    let jar_path = paths.minecraft_library_path(&path);
                    download_with_sha1(&url, &jar_path, None)?;
                    extract_natives(&jar_path, &natives_dir, library.extract.as_ref())?;
                }
            }
    }

    for jar in client_jars {
        classpath.push(jar.to_path_buf());
    }
    let sep = if cfg!(windows) { ";" } else { ":" };
    let classpath = classpath
        .iter()
        .map(|p| normalize_path_separator(&p.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(sep);
    Ok((classpath, natives_dir))
}

fn build_args(
    version: &VersionJson,
    vars: &HashMap<String, String>,
) -> Result<(Vec<String>, Vec<String>)> {
    let mut jvm_args = Vec::new();
    let mut game_args = Vec::new();

    if let Some(arguments) = &version.arguments {
        jvm_args.extend(collect_args(&arguments.jvm, vars));
        game_args.extend(collect_args(&arguments.game, vars));
    } else if let Some(raw) = &version.minecraft_arguments {
        let parts = split(raw).context("failed to parse minecraftArguments")?;
        game_args.extend(parts.into_iter().map(|arg| substitute_vars(&arg, vars)));
    }

    Ok((jvm_args, game_args))
}

fn collect_args(list: &[Argument], vars: &HashMap<String, String>) -> Vec<String> {
    let ctx = RuleContext::new();
    let mut out = Vec::new();
    for arg in list {
        match arg {
            Argument::Simple(value) => out.push(substitute_vars(value, vars)),
            Argument::WithRules { rules, value } => {
                if rules_allow(rules, &ctx) {
                    match value {
                        ArgValue::Single(value) => out.push(substitute_vars(value, vars)),
                        ArgValue::Multiple(values) => {
                            out.extend(values.iter().map(|v| substitute_vars(v, vars)))
                        }
                    }
                }
            }
        }
    }
    out
}

fn substitute_vars(value: &str, vars: &HashMap<String, String>) -> String {
    let mut out = value.to_string();
    for (key, val) in vars {
        out = out.replace(&format!("${{{key}}}"), val);
    }
    out
}

fn build_var_map(
    game_dir: &Path,
    assets_root: &Path,
    asset_index: &str,
    classpath: &str,
    natives_dir: &Path,
    libraries_dir: &Path,
    version: &VersionJson,
    account: &LaunchAccount,
) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    vars.insert("auth_player_name".into(), account.username.clone());
    vars.insert("version_name".into(), version.id.clone());
    vars.insert(
        "game_directory".into(),
        normalize_path_separator(&game_dir.to_string_lossy()),
    );
    vars.insert(
        "assets_root".into(),
        normalize_path_separator(&assets_root.to_string_lossy()),
    );
    vars.insert("assets_index_name".into(), asset_index.to_string());
    vars.insert("auth_uuid".into(), account.uuid.clone());
    vars.insert("auth_access_token".into(), account.access_token.clone());
    vars.insert("clientid".into(), account.uuid.clone());
    vars.insert("user_type".into(), "msa".to_string());
    vars.insert(
        "version_type".into(),
        version
            .version_type
            .clone()
            .unwrap_or_else(|| "release".to_string()),
    );
    vars.insert(
        "natives_directory".into(),
        normalize_path_separator(&natives_dir.to_string_lossy()),
    );
    vars.insert(
        "library_directory".into(),
        normalize_path_separator(&libraries_dir.to_string_lossy()),
    );
    vars.insert(
        "classpath_separator".into(),
        if cfg!(windows) { ";" } else { ":" }.to_string(),
    );
    vars.insert("launcher_name".into(), "shard".to_string());
    vars.insert(
        "launcher_version".into(),
        env!("CARGO_PKG_VERSION").to_string(),
    );
    vars.insert("classpath".into(), classpath.to_string());
    vars.insert("user_properties".into(), "{}".to_string());
    // auth_xuid should always be present (empty string if not available)
    vars.insert(
        "auth_xuid".into(),
        account.xuid.clone().unwrap_or_default(),
    );
    vars
}

fn ensure_jvm_flag(args: &mut Vec<String>, flag: &str, value: &Path) -> Result<()> {
    let pref = format!("{flag}=");
    if args.iter().any(|arg| arg.starts_with(&pref)) {
        return Ok(());
    }
    let value = normalize_path_separator(&value.to_string_lossy());
    args.push(format!("{pref}{value}"));
    Ok(())
}

fn strip_classpath_args(args: &mut Vec<String>) {
    let mut idx = 0;
    while idx < args.len() {
        if args[idx] == "-cp" || args[idx] == "-classpath" {
            args.remove(idx);
            if idx < args.len() {
                args.remove(idx);
            }
            continue;
        }
        idx += 1;
    }
}

fn resolve_java(override_java: Option<&str>) -> String {
    if let Some(java) = override_java {
        return java.to_string();
    }
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let candidate = Path::new(&java_home).join("bin").join("java");
        return candidate.to_string_lossy().to_string();
    }
    "java".to_string()
}

fn download_text(url: &str) -> Result<String> {
    let client = Client::new();
    let resp = client.get(url).send().context("failed to download")?;
    let resp = resp.error_for_status().context("download failed")?;
    let text = resp.text().context("failed to read response")?;
    Ok(text)
}

fn download_json(url: &str) -> Result<Value> {
    let client = Client::new();
    let resp = client.get(url).send().context("failed to download json")?;
    let resp = resp.error_for_status().context("json download failed")?;
    let json: Value = resp.json().context("failed to parse json")?;
    Ok(json)
}

fn download_with_sha1(url: &str, path: &Path, expected_sha1: Option<&str>) -> Result<()> {
    if path.exists() {
        if let Some(expected) = expected_sha1 {
            if let Ok(actual) = sha1_file(path)
                && actual.eq_ignore_ascii_case(expected) {
                    return Ok(());
                }
        } else if path.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
            return Ok(());
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create dir: {}", parent.display()))?;
    }

    let tmp_path = path.with_extension("tmp");
    let client = Client::new();
    let mut resp = client
        .get(url)
        .send()
        .with_context(|| format!("failed to download: {url}"))?
        .error_for_status()
        .with_context(|| format!("download failed: {url}"))?;

    let mut out = fs::File::create(&tmp_path)
        .with_context(|| format!("failed to create file: {}", tmp_path.display()))?;
    std::io::copy(&mut resp, &mut out).context("failed to write download")?;

    if let Some(expected) = expected_sha1 {
        let actual = sha1_file(&tmp_path)?;
        if !actual.eq_ignore_ascii_case(expected) {
            bail!("sha1 mismatch for {}", path.display());
        }
    }

    fs::rename(&tmp_path, path)
        .with_context(|| format!("failed to move file into place: {}", path.display()))?;
    Ok(())
}

fn sha1_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("failed to open file for sha1: {}", path.display()))?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 1024 * 64];
    loop {
        let read = file.read(&mut buf).context("failed to hash file")?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let digest = hasher.finalize();
    Ok(format!("{:x}", digest))
}

fn extract_natives(path: &Path, dest: &Path, extract: Option<&Extract>) -> Result<()> {
    let file = fs::File::open(path)
        .with_context(|| format!("failed to open native jar: {}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("failed to read zip: {}", path.display()))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).context("failed to read zip entry")?;
        let entry_name = entry.name().to_string();
        let enclosed = match entry.enclosed_name() {
            Some(name) => name.to_owned(),
            None => continue,
        };
        if entry.is_dir() {
            continue;
        }
        if let Some(extract) = extract
            && let Some(excludes) = &extract.exclude
                && excludes.iter().any(|prefix| entry_name.starts_with(prefix)) {
                    continue;
                }

        // Protect against Zip Slip: validate path doesn't escape destination
        let out_path = dest.join(&enclosed);
        let canonical_dest = dest
            .canonicalize()
            .with_context(|| format!("failed to canonicalize dest: {}", dest.display()))?;
        // Create parent dirs first so we can canonicalize the output path
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create native dir: {}", parent.display()))?;
        }
        let canonical_out = out_path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .map(|p| p.join(out_path.file_name().unwrap_or_default()))
            .unwrap_or_else(|| out_path.clone());
        if !canonical_out.starts_with(&canonical_dest) {
            bail!(
                "zip entry '{}' would escape destination directory (Zip Slip attack)",
                entry_name
            );
        }
        let mut out = fs::File::create(&out_path)
            .with_context(|| format!("failed to create native file: {}", out_path.display()))?;
        std::io::copy(&mut entry, &mut out).context("failed to extract native file")?;
    }
    Ok(())
}

fn library_allowed(library: &Library) -> bool {
    if let Some(rules) = &library.rules {
        return rules_allow(rules, &RuleContext::new());
    }
    true
}

fn rules_allow(rules: &[Rule], ctx: &RuleContext) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        if rule.matches(ctx) {
            allowed = rule.action.as_deref().unwrap_or("allow") == "allow";
        }
    }
    allowed
}

fn os_key() -> String {
    match std::env::consts::OS {
        "macos" => "osx".to_string(),
        other => other.to_string(),
    }
}

fn arch_marker() -> &'static str {
    if std::env::consts::ARCH.contains("64") {
        "64"
    } else {
        "32"
    }
}

fn maven_path_from_name(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).copied();
    let ext = parts.get(4).copied().unwrap_or("jar");

    let mut file = format!("{}-{}", artifact, version);
    if let Some(classifier) = classifier {
        file.push('-');
        file.push_str(classifier);
    }
    file.push('.');
    file.push_str(ext);

    Some(format!("{group}/{artifact}/{version}/{file}"))
}

fn maven_path_from_name_with_classifier(name: &str, classifier: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let ext = parts.get(4).copied().unwrap_or("jar");

    let file = format!("{}-{}-{}.{}", artifact, version, classifier, ext);
    Some(format!("{group}/{artifact}/{version}/{file}"))
}

fn join_url(base: &str, path: &str) -> String {
    if base.ends_with('/') {
        format!("{base}{path}")
    } else {
        format!("{base}/{path}")
    }
}

#[derive(Clone, Deserialize)]
struct VersionManifest {
    versions: Vec<VersionEntry>,
}

#[derive(Clone, Deserialize)]
struct VersionEntry {
    id: String,
    url: String,
}

#[derive(Clone, Deserialize)]
struct VersionJson {
    id: String,
    #[serde(rename = "type")]
    version_type: Option<String>,
    #[serde(rename = "mainClass")]
    main_class: Option<String>,
    #[serde(rename = "minecraftArguments")]
    minecraft_arguments: Option<String>,
    #[serde(default)]
    arguments: Option<Arguments>,
    #[serde(default)]
    libraries: Vec<Library>,
    #[serde(default)]
    downloads: Option<Downloads>,
    #[serde(rename = "assetIndex")]
    asset_index: Option<AssetIndexEntry>,
    assets: Option<String>,
    #[serde(rename = "inheritsFrom")]
    inherits_from: Option<String>,
}

#[derive(Clone, Deserialize)]
struct Arguments {
    #[serde(default)]
    game: Vec<Argument>,
    #[serde(default)]
    jvm: Vec<Argument>,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum Argument {
    Simple(String),
    WithRules { rules: Vec<Rule>, value: ArgValue },
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum ArgValue {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Clone, Deserialize)]
struct Rule {
    action: Option<String>,
    os: Option<OsRule>,
    features: Option<HashMap<String, bool>>,
}

#[derive(Clone, Deserialize)]
struct OsRule {
    name: Option<String>,
    arch: Option<String>,
    #[allow(dead_code)]
    version: Option<String>,
}

impl Rule {
    fn matches(&self, ctx: &RuleContext) -> bool {
        if let Some(os) = &self.os {
            if let Some(name) = &os.name
                && name != &ctx.os_name {
                    return false;
                }
            if let Some(arch) = &os.arch
                && !ctx.os_arch.contains(arch) {
                    return false;
                }
        }
        if let Some(features) = &self.features {
            for (key, value) in features {
                if ctx.features.get(key).copied().unwrap_or(false) != *value {
                    return false;
                }
            }
        }
        true
    }
}

struct RuleContext {
    os_name: String,
    os_arch: String,
    features: HashMap<String, bool>,
}

impl RuleContext {
    fn new() -> Self {
        let os_name = os_key();
        // Normalize architecture names for Minecraft manifest compatibility
        let os_arch = match std::env::consts::ARCH {
            "aarch64" => "arm64".to_string(),
            arch => arch.to_string(),
        };
        let mut features = HashMap::new();
        features.insert("is_demo_user".to_string(), false);
        features.insert("has_custom_resolution".to_string(), false);
        features.insert("is_quick_play_multiplayer".to_string(), false);
        features.insert("is_quick_play_singleplayer".to_string(), false);
        features.insert("is_quick_play_realms".to_string(), false);
        Self {
            os_name,
            os_arch,
            features,
        }
    }
}

#[derive(Clone, Deserialize)]
struct Downloads {
    client: Option<DownloadInfo>,
}

#[derive(Clone, Deserialize)]
struct DownloadInfo {
    sha1: String,
    url: String,
    #[allow(dead_code)]
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Clone, Deserialize)]
struct AssetIndexEntry {
    id: String,
    sha1: String,
    url: String,
}

#[derive(Clone, Deserialize)]
struct AssetIndex {
    objects: HashMap<String, AssetObject>,
}

#[derive(Clone, Deserialize)]
struct AssetObject {
    hash: String,
    #[serde(default)]
    url: Option<String>,
}

/// Extracts the library key from a Maven coordinate for deduplication.
/// Format: group:artifact:version or group:artifact:version:classifier[:extension]
/// Key includes classifier if present to avoid deduplicating native libs.
/// Examples:
///   "org.objectweb.asm:asm:9.6" -> "org.objectweb.asm:asm"
///   "org.lwjgl:lwjgl:3.3.3:natives-macos-arm64" -> "org.lwjgl:lwjgl:natives-macos-arm64"
///   "org.lwjgl:lwjgl:3.3.3:natives-macos-arm64:jar" -> "org.lwjgl:lwjgl:natives-macos-arm64"
fn library_key(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    match parts.len() {
        // group:artifact:version
        3 => Some(format!("{}:{}", parts[0], parts[1])),
        // group:artifact:version:classifier or group:artifact:version:classifier:extension
        // In both cases, classifier is at index 3
        n if n >= 4 => Some(format!("{}:{}:{}", parts[0], parts[1], parts[3])),
        // group:artifact (no version)
        2 => Some(format!("{}:{}", parts[0], parts[1])),
        _ => None,
    }
}

#[derive(Clone, Deserialize)]
struct Library {
    name: String,
    #[serde(default)]
    downloads: Option<LibraryDownloads>,
    #[serde(default)]
    rules: Option<Vec<Rule>>,
    #[serde(default)]
    natives: Option<HashMap<String, String>>,
    #[serde(default)]
    extract: Option<Extract>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Clone, Deserialize)]
struct LibraryDownloads {
    artifact: Option<LibraryArtifact>,
    classifiers: Option<HashMap<String, LibraryArtifact>>,
}

#[derive(Clone, Deserialize)]
struct LibraryArtifact {
    path: String,
    sha1: String,
    url: String,
}

#[derive(Clone, Deserialize)]
struct Extract {
    exclude: Option<Vec<String>>,
}

fn merge_versions(mut parent: VersionJson, mut child: VersionJson) -> VersionJson {
    if child.main_class.is_none() {
        child.main_class = parent.main_class.take();
    }
    if child.minecraft_arguments.is_none() {
        child.minecraft_arguments = parent.minecraft_arguments.take();
    }
    match (parent.arguments.take(), child.arguments.take()) {
        (Some(parent_args), Some(child_args)) => {
            let merged = Arguments {
                game: [parent_args.game, child_args.game].concat(),
                jvm: [parent_args.jvm, child_args.jvm].concat(),
            };
            child.arguments = Some(merged);
        }
        (Some(parent_args), None) => {
            child.arguments = Some(parent_args);
        }
        (None, Some(child_args)) => {
            child.arguments = Some(child_args);
        }
        (None, None) => {}
    }

    if !parent.libraries.is_empty() {
        // Child libraries come first so mod loaders can override vanilla classes.
        // Deduplicate by group:artifact (ignoring version) to prevent classpath conflicts.
        // For example, if Fabric has asm:9.6 and vanilla has asm:9.5, keep only asm:9.6.
        use std::collections::HashSet;
        let mut seen: HashSet<String> = HashSet::new();

        // Track child library keys (group:artifact without version)
        for lib in &child.libraries {
            if let Some(key) = library_key(&lib.name) {
                seen.insert(key);
            }
        }

        // Only add parent libraries that aren't already provided by child
        let mut merged = child.libraries.clone();
        for lib in parent.libraries.iter() {
            let dominated = library_key(&lib.name).map_or(false, |key| seen.contains(&key));
            if !dominated {
                if let Some(key) = library_key(&lib.name) {
                    seen.insert(key);
                }
                merged.push(lib.clone());
            }
        }
        child.libraries = merged;
    }

    if child.downloads.is_none() {
        child.downloads = parent.downloads.take();
    }
    if child.asset_index.is_none() {
        child.asset_index = parent.asset_index.take();
    }
    if child.assets.is_none() {
        child.assets = parent.assets.take();
    }

    // Continue inheritance chain if the parent also inherits from something else.
    child.inherits_from = parent.inherits_from.take();

    child
}
