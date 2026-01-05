use serde::{Deserialize, Serialize};
use shard::accounts::{Account, Accounts, delete_account_tokens, load_accounts, remove_account, save_accounts, set_active};
use shard::auth::{DeviceCode, request_device_code};
use shard::config::{Config, load_config, save_config};
use shard::content_store::{ContentStore, ContentType, Platform, SearchOptions, ContentItem, ContentVersion};
use shard::java::{JavaInstallation, JavaValidation, AdoptiumRelease, detect_installations, validate_java_path, get_required_java_version, is_java_compatible, fetch_adoptium_release, download_and_install_java, find_compatible_java, get_managed_java, list_managed_runtimes};
use shard::library::{Library, LibraryItem, LibraryFilter, LibraryItemInput, LibraryContentType, LibraryStats, Tag, ImportResult, UnusedItemsSummary, PurgeResult};
use shard::logs::{LogEntry, LogFile, LogWatcher, list_log_files, list_crash_reports, read_log_file, read_log_tail};
use shard::minecraft::{LaunchPlan, prepare};
use shard::ops::{finish_device_code_flow, parse_loader, resolve_input, resolve_launch_account, ensure_fresh_account};
use shard::paths::Paths;
use shard::profile::{ContentRef, Loader, Profile, Runtime, clone_profile, create_profile, delete_profile, diff_profiles, list_profiles, load_profile, remove_mod, remove_resourcepack, remove_shaderpack, rename_profile, save_profile, upsert_mod, upsert_resourcepack, upsert_shaderpack};
use shard::skin::{
    MinecraftProfile,
    get_profile as get_mc_profile,
    get_avatar_url,
    get_body_url,
    get_skin_url,
    get_cape_url,
    get_active_skin,
    get_active_cape,
    upload_skin,
    set_skin_url,
    reset_skin,
    set_cape,
    hide_cape,
    SkinVariant,
    download_and_cache_skin,
    download_and_cache_cape,
};
use shard::store::{ContentKind, store_content};
use shard::template::{Template, list_templates, load_template, init_builtin_templates};
use shard::updates::{StorageStats, UpdateCheckResult, get_storage_stats, check_all_updates, check_profile_updates, set_content_pinned, set_content_enabled, apply_update};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
pub struct DiffResult {
    pub only_a: Vec<String>,
    pub only_b: Vec<String>,
    pub both: Vec<String>,
}

#[derive(Serialize)]
pub struct LaunchPlanDto {
    pub instance_dir: String,
    pub java_exec: String,
    pub jvm_args: Vec<String>,
    pub classpath: String,
    pub main_class: String,
    pub game_args: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct LaunchEvent {
    pub stage: String,
    pub message: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateProfileInput {
    pub id: String,
    pub mc_version: String,
    pub loader_type: Option<String>,
    pub loader_version: Option<String>,
    pub java: Option<String>,
    pub memory: Option<String>,
    pub args: Option<String>,
    pub template: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct AccountInfo {
    pub uuid: String,
    pub username: String,
    pub avatar_url: String,
    pub body_url: String,
    pub skin_url: String,
    pub cape_url: String,
    pub profile: Option<MinecraftProfile>,
}

#[derive(Deserialize)]
pub struct StoreSearchInput {
    pub query: String,
    pub content_type: Option<String>,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub platform: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Deserialize)]
pub struct StoreInstallInput {
    pub profile_id: String,
    pub project_id: String,
    pub platform: String,
    pub version_id: Option<String>,
    pub content_type: Option<String>,
}

fn load_paths() -> Result<Paths, String> {
    let paths = Paths::new().map_err(|e| e.to_string())?;
    paths.ensure().map_err(|e| e.to_string())?;
    Ok(paths)
}

fn resolve_credentials(
    paths: &Paths,
    client_id: Option<String>,
    client_secret: Option<String>,
) -> Result<(String, Option<String>), String> {
    let config = load_config(paths).map_err(|e| e.to_string())?;
    let id = client_id
        .or(config.msa_client_id)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "missing Microsoft client id; set it in Settings".to_string())?;
    let secret = client_secret
        .or(config.msa_client_secret)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    Ok((id, secret))
}

#[tauri::command]
pub fn list_profiles_cmd() -> Result<Vec<String>, String> {
    let paths = load_paths()?;
    list_profiles(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_profile_cmd(id: String) -> Result<Profile, String> {
    let paths = load_paths()?;
    load_profile(&paths, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_profile_cmd(input: CreateProfileInput) -> Result<Profile, String> {
    let paths = load_paths()?;
    let loader = match (input.loader_type, input.loader_version) {
        (Some(loader_type), Some(loader_version)) => {
            let loader_string = format!("{}@{}", loader_type.trim(), loader_version.trim());
            Some(parse_loader(&loader_string).map_err(|e| e.to_string())?)
        }
        (None, None) => None,
        _ => {
            return Err("loader type and version must both be provided".to_string());
        }
    };

    let args = input
        .args
        .unwrap_or_default()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    let runtime = Runtime {
        java: input.java.filter(|v| !v.trim().is_empty()),
        memory: input.memory.filter(|v| !v.trim().is_empty()),
        args,
    };

    create_profile(&paths, &input.id, &input.mc_version, loader, runtime)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clone_profile_cmd(src: String, dst: String) -> Result<Profile, String> {
    let paths = load_paths()?;
    clone_profile(&paths, &src, &dst).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_profile_cmd(id: String) -> Result<(), String> {
    let paths = load_paths()?;
    delete_profile(&paths, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_profile_cmd(id: String, new_id: String) -> Result<Profile, String> {
    let paths = load_paths()?;
    rename_profile(&paths, &id, &new_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_profile_version_cmd(
    id: String,
    mc_version: String,
    loader_type: Option<String>,
    loader_version: Option<String>,
) -> Result<Profile, String> {
    let paths = load_paths()?;
    let mut profile = load_profile(&paths, &id).map_err(|e| e.to_string())?;

    // Update MC version
    profile.mc_version = mc_version;

    // Update loader
    profile.loader = match (loader_type, loader_version) {
        (Some(lt), Some(lv)) if !lt.is_empty() && !lv.is_empty() => Some(Loader {
            loader_type: lt,
            version: lv,
        }),
        _ => None,
    };

    save_profile(&paths, &profile).map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn diff_profiles_cmd(a: String, b: String) -> Result<DiffResult, String> {
    let paths = load_paths()?;
    let profile_a = load_profile(&paths, &a).map_err(|e| e.to_string())?;
    let profile_b = load_profile(&paths, &b).map_err(|e| e.to_string())?;
    let (only_a, only_b, both) = diff_profiles(&profile_a, &profile_b);
    Ok(DiffResult { only_a, only_b, both })
}

fn add_content(
    profile_id: &str,
    input: &str,
    name: Option<String>,
    version: Option<String>,
    kind: ContentKind,
) -> Result<bool, String> {
    let paths = load_paths()?;
    let mut profile_data = load_profile(&paths, profile_id).map_err(|e| e.to_string())?;
    let (path, source, file_name_hint) = resolve_input(&paths, input).map_err(|e| e.to_string())?;
    let stored = store_content(&paths, kind, &path, source.clone(), file_name_hint.clone()).map_err(|e| e.to_string())?;

    // Auto-add to library
    if let Ok(library) = Library::from_paths(&paths) {
        let lib_content_type = match kind {
            ContentKind::Mod => "mod",
            ContentKind::ResourcePack => "resourcepack",
            ContentKind::ShaderPack => "shaderpack",
            ContentKind::Skin => "skin",
        };
        let hash = stored.hash.strip_prefix("sha256:").unwrap_or(&stored.hash);
        let lib_input = LibraryItemInput {
            hash: hash.to_string(),
            content_type: Some(lib_content_type.to_string()),
            name: Some(name.clone().unwrap_or_else(|| stored.name.clone())),
            file_name: file_name_hint.clone(),
            source_url: source.clone(),
            source_platform: if input.contains("modrinth.com") { Some("modrinth".to_string()) }
                else if input.contains("curseforge.com") { Some("curseforge".to_string()) }
                else { Some("local".to_string()) },
            ..Default::default()
        };
        if let Ok(lib_item) = library.add_item(&lib_input) {
            let version_tag = format!("mc:{}", profile_data.mc_version);
            let _ = library.add_tag_to_item(lib_item.id, &version_tag);
            if let Some(loader) = profile_data.loader.as_ref() {
                let loader_tag = format!("loader:{}", loader.loader_type);
                let _ = library.add_tag_to_item(lib_item.id, &loader_tag);
            }
        }
    }

    let content_ref = ContentRef {
        name: name.unwrap_or(stored.name),
        hash: stored.hash,
        version,
        source: stored.source,
        file_name: Some(stored.file_name),
        platform: None, // Manual import via UI
        project_id: None,
        version_id: None,
        enabled: true,
        pinned: false,
    };

    let changed = match kind {
        ContentKind::Mod => upsert_mod(&mut profile_data, content_ref),
        ContentKind::ResourcePack => upsert_resourcepack(&mut profile_data, content_ref),
        ContentKind::ShaderPack => upsert_shaderpack(&mut profile_data, content_ref),
        ContentKind::Skin => false, // Skins are not added to profiles
    };
    save_profile(&paths, &profile_data).map_err(|e| e.to_string())?;
    Ok(changed)
}

fn remove_content(profile_id: &str, target: &str, kind: ContentKind) -> Result<bool, String> {
    let paths = load_paths()?;
    let mut profile_data = load_profile(&paths, profile_id).map_err(|e| e.to_string())?;
    let changed = match kind {
        ContentKind::Mod => remove_mod(&mut profile_data, target),
        ContentKind::ResourcePack => remove_resourcepack(&mut profile_data, target),
        ContentKind::ShaderPack => remove_shaderpack(&mut profile_data, target),
        ContentKind::Skin => false, // Skins are not removed from profiles
    };
    if changed {
        save_profile(&paths, &profile_data).map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

#[tauri::command]
pub fn add_mod_cmd(profile_id: String, input: String, name: Option<String>, version: Option<String>) -> Result<bool, String> {
    add_content(&profile_id, &input, name, version, ContentKind::Mod)
}

#[tauri::command]
pub fn add_resourcepack_cmd(profile_id: String, input: String, name: Option<String>, version: Option<String>) -> Result<bool, String> {
    add_content(&profile_id, &input, name, version, ContentKind::ResourcePack)
}

#[tauri::command]
pub fn add_shaderpack_cmd(profile_id: String, input: String, name: Option<String>, version: Option<String>) -> Result<bool, String> {
    add_content(&profile_id, &input, name, version, ContentKind::ShaderPack)
}

#[tauri::command]
pub fn remove_mod_cmd(profile_id: String, target: String) -> Result<bool, String> {
    remove_content(&profile_id, &target, ContentKind::Mod)
}

#[tauri::command]
pub fn remove_resourcepack_cmd(profile_id: String, target: String) -> Result<bool, String> {
    remove_content(&profile_id, &target, ContentKind::ResourcePack)
}

#[tauri::command]
pub fn remove_shaderpack_cmd(profile_id: String, target: String) -> Result<bool, String> {
    remove_content(&profile_id, &target, ContentKind::ShaderPack)
}

#[tauri::command]
pub fn list_accounts_cmd() -> Result<Accounts, String> {
    let paths = load_paths()?;
    load_accounts(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_active_account_cmd(id: String) -> Result<(), String> {
    let paths = load_paths()?;
    let mut accounts = load_accounts(&paths).map_err(|e| e.to_string())?;
    if set_active(&mut accounts, &id) {
        save_accounts(&paths, &accounts).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("account not found".to_string())
    }
}

#[tauri::command]
pub fn remove_account_cmd(id: String) -> Result<(), String> {
    let paths = load_paths()?;
    let mut accounts = load_accounts(&paths).map_err(|e| e.to_string())?;
    if remove_account(&mut accounts, &id) {
        delete_account_tokens(&id).map_err(|e| e.to_string())?;
        save_accounts(&paths, &accounts).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("account not found".to_string())
    }
}

#[tauri::command]
pub fn get_config_cmd() -> Result<Config, String> {
    let paths = load_paths()?;
    load_config(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config_cmd(client_id: Option<String>, client_secret: Option<String>) -> Result<Config, String> {
    let paths = load_paths()?;
    let mut config = load_config(&paths).map_err(|e| e.to_string())?;
    config.msa_client_id = client_id.filter(|v| !v.trim().is_empty());
    config.msa_client_secret = client_secret.filter(|v| !v.trim().is_empty());
    save_config(&paths, &config).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
pub fn request_device_code_cmd(client_id: Option<String>, client_secret: Option<String>) -> Result<DeviceCode, String> {
    let paths = load_paths()?;
    let (id, secret) = resolve_credentials(&paths, client_id, client_secret)?;
    request_device_code(&id, secret.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn finish_device_code_flow_cmd(
    client_id: Option<String>,
    client_secret: Option<String>,
    device: DeviceCode,
) -> Result<Account, String> {
    let paths = load_paths()?;
    let (id, secret) = resolve_credentials(&paths, client_id, client_secret)?;
    finish_device_code_flow(&paths, &id, secret.as_deref(), &device).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn prepare_profile_cmd(profile_id: String, account_id: Option<String>) -> Result<LaunchPlanDto, String> {
    let paths = load_paths()?;
    let profile = load_profile(&paths, &profile_id).map_err(|e| e.to_string())?;
    let account = resolve_launch_account(&paths, account_id).map_err(|e| e.to_string())?;
    let plan = prepare(&paths, &profile, &account).map_err(|e| e.to_string())?;
    Ok(LaunchPlanDto::from(plan))
}

#[tauri::command]
pub fn launch_profile_cmd(app: AppHandle, profile_id: String, account_id: Option<String>) -> Result<(), String> {
    let app_handle = app.clone();

    // Emit initial status immediately before spawning thread
    let _ = app.emit("launch-status", LaunchEvent {
        stage: "queued".to_string(),
        message: Some("Starting launch...".to_string()),
    });

    // Use spawn_blocking for blocking I/O operations (HTTP requests, file I/O)
    tauri::async_runtime::spawn_blocking(move || {
        match run_launch(app_handle.clone(), profile_id.clone(), account_id) {
            Ok(()) => {}
            Err(err) => {
                let _ = app_handle.emit("launch-status", LaunchEvent {
                    stage: "error".to_string(),
                    message: Some(err),
                });
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn instance_path_cmd(profile_id: String) -> Result<String, String> {
    let paths = load_paths()?;
    Ok(paths.instance_dir(&profile_id).to_string_lossy().to_string())
}

fn run_launch(app: AppHandle, profile_id: String, account_id: Option<String>) -> Result<(), String> {
    let _ = app.emit("launch-status", LaunchEvent {
        stage: "preparing".to_string(),
        message: Some("Downloading game files...".to_string()),
    });

    let paths = load_paths()?;
    let profile = load_profile(&paths, &profile_id).map_err(|e| format!("Failed to load profile: {}", e))?;
    let account = resolve_launch_account(&paths, account_id).map_err(|e| format!("Failed to resolve account: {}", e))?;
    let plan = prepare(&paths, &profile, &account).map_err(|e| format!("Failed to prepare launch: {}", e))?;

    let _ = app.emit("launch-status", LaunchEvent {
        stage: "launching".to_string(),
        message: Some("Starting Minecraft...".to_string()),
    });

    let mut child = Command::new(&plan.java_exec)
        .args(&plan.jvm_args)
        .arg("-cp")
        .arg(&plan.classpath)
        .arg(&plan.main_class)
        .args(&plan.game_args)
        .current_dir(&plan.instance_dir)
        .spawn()
        .map_err(|e| format!("Failed to start Java: {}", e))?;

    let _ = app.emit("launch-status", LaunchEvent {
        stage: "running".to_string(),
        message: Some("Minecraft is running".to_string()),
    });

    let status = child.wait().map_err(|e| format!("Failed to wait for process: {}", e))?;

    if !status.success() {
        return Err(format!("Minecraft exited with status {}", status));
    }

    let _ = app.emit("launch-status", LaunchEvent {
        stage: "done".to_string(),
        message: None,
    });

    Ok(())
}

impl From<LaunchPlan> for LaunchPlanDto {
    fn from(plan: LaunchPlan) -> Self {
        Self {
            instance_dir: plan.instance_dir.to_string_lossy().to_string(),
            java_exec: plan.java_exec,
            jvm_args: plan.jvm_args,
            classpath: plan.classpath,
            main_class: plan.main_class,
            game_args: plan.game_args,
        }
    }
}

// ==================== Account Info / Skin / Cape Commands ====================

#[tauri::command]
pub fn get_account_info_cmd(id: Option<String>) -> Result<AccountInfo, String> {
    let paths = load_paths()?;

    // Ensure tokens are fresh before fetching profile
    let account = ensure_fresh_account(&paths, id.clone()).map_err(|e| e.to_string())?;

    let profile = get_mc_profile(&account.minecraft.access_token).ok();

    // Get the skin URL from the profile, or fallback to mc-heads.net
    let raw_skin_url = if let Some(ref profile) = profile {
        get_active_skin(profile)
            .map(|skin| skin.url.clone())
            .unwrap_or_else(|| get_skin_url(&account.uuid))
    } else {
        get_skin_url(&account.uuid)
    };

    // Get the cape URL from the profile
    let raw_cape_url = if let Some(ref profile) = profile {
        get_active_cape(profile)
            .map(|cape| cape.url.clone())
    } else {
        None
    };

    // Download and cache the skin to local store, return asset:// URL
    let skin_url = match download_and_cache_skin(&raw_skin_url, &paths.store_skins) {
        Ok(cached_path) => {
            // Return as asset:// URL for Tauri to serve
            format!("asset://localhost/{}", cached_path.to_string_lossy().replace('\\', "/"))
        }
        Err(_) => {
            // Fallback to mc-heads.net which has CORS support
            get_skin_url(&account.uuid)
        }
    };

    // Download and cache the cape if available
    let cape_url = if let Some(ref url) = raw_cape_url {
        match download_and_cache_cape(url, &paths.store_skins) {
            Ok(Some(cached_path)) => {
                format!("asset://localhost/{}", cached_path.to_string_lossy().replace('\\', "/"))
            }
            _ => get_cape_url(&account.uuid)
        }
    } else {
        get_cape_url(&account.uuid)
    };

    Ok(AccountInfo {
        uuid: account.uuid.clone(),
        username: account.username.clone(),
        avatar_url: get_avatar_url(&account.uuid, 128),
        body_url: get_body_url(&account.uuid, 256),
        skin_url,
        cape_url,
        profile,
    })
}

#[tauri::command]
pub fn upload_skin_cmd(id: Option<String>, path: String, variant: String, save_to_library: Option<bool>) -> Result<Option<LibraryItem>, String> {
    let paths = load_paths()?;
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    let skin_path = PathBuf::from(&path);
    let variant: SkinVariant = variant.parse().map_err(|e| format!("{}", e))?;
    upload_skin(&account.minecraft.access_token, &skin_path, variant)
        .map_err(|e| e.to_string())?;

    // Optionally save to library
    if save_to_library.unwrap_or(true) {
        let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
        let item = library.import_file(&paths, &skin_path, LibraryContentType::Skin)
            .map_err(|e| e.to_string())?;
        Ok(Some(item))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn set_skin_url_cmd(id: Option<String>, url: String, variant: String) -> Result<(), String> {
    let paths = load_paths()?;
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    let variant: SkinVariant = variant.parse().map_err(|e| format!("{}", e))?;
    set_skin_url(&account.minecraft.access_token, &url, variant)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_skin_cmd(id: Option<String>) -> Result<(), String> {
    let paths = load_paths()?;
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    reset_skin(&account.minecraft.access_token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_library_skin_cmd(id: Option<String>, item_id: i64, variant: String) -> Result<(), String> {
    let paths = load_paths()?;
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    let item = library.get_item(item_id).map_err(|e| e.to_string())?
        .ok_or_else(|| "skin not found in library".to_string())?;

    if item.content_type != LibraryContentType::Skin {
        return Err("item is not a skin".to_string());
    }

    let skin_path = paths.store_skin_path(&item.hash);
    if !skin_path.exists() {
        return Err("skin file not found in store".to_string());
    }

    let variant: SkinVariant = variant.parse().map_err(|e| format!("{}", e))?;
    upload_skin(&account.minecraft.access_token, &skin_path, variant)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_cape_cmd(id: Option<String>, cape_id: String) -> Result<(), String> {
    let paths = load_paths()?;
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    set_cape(&account.minecraft.access_token, &cape_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_cape_cmd(id: Option<String>) -> Result<(), String> {
    let paths = load_paths()?;
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    hide_cape(&account.minecraft.access_token).map_err(|e| e.to_string())
}

// ==================== Template Commands ====================

#[tauri::command]
pub fn list_templates_cmd() -> Result<Vec<String>, String> {
    let paths = load_paths()?;
    init_builtin_templates(&paths).map_err(|e| e.to_string())?;
    list_templates(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_template_cmd(id: String) -> Result<Template, String> {
    let paths = load_paths()?;
    init_builtin_templates(&paths).map_err(|e| e.to_string())?;
    load_template(&paths, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_profile_from_template_cmd(input: CreateProfileInput) -> Result<Profile, String> {
    let paths = load_paths()?;

    if let Some(template_id) = input.template {
        init_builtin_templates(&paths).map_err(|e| e.to_string())?;
        let template = load_template(&paths, &template_id).map_err(|e| e.to_string())?;

        let loader = template.loader.map(|l| Loader {
            loader_type: l.loader_type,
            version: l.version,
        });

        let runtime = Runtime {
            java: input.java.or(template.runtime.java),
            memory: input.memory.or(template.runtime.memory),
            args: if input.args.as_ref().map(|a| !a.trim().is_empty()).unwrap_or(false) {
                input.args.unwrap().split_whitespace().map(String::from).collect()
            } else {
                template.runtime.args
            },
        };

        let mut profile = create_profile(&paths, &input.id, &template.mc_version, loader.clone(), runtime)
            .map_err(|e| e.to_string())?;

        // Download content from template (mods, shaderpacks, resourcepacks)
        let store = ContentStore::modrinth_only();
        let loader_type = loader.as_ref().map(|l| l.loader_type.as_str());

        for mod_content in &template.mods {
            if !mod_content.required {
                continue;
            }
            if let shard::template::ContentSource::Modrinth { project } = &mod_content.source {
                if let Ok(version) = store.get_latest_version(
                    Platform::Modrinth,
                    project,
                    Some(&template.mc_version),
                    loader_type,
                ) {
                    if let Ok(content_ref) = store.download_to_store(&paths, &version, ContentType::Mod) {
                        upsert_mod(&mut profile, content_ref);
                    }
                }
            }
        }

        for shader in &template.shaderpacks {
            if !shader.required {
                continue;
            }
            if let shard::template::ContentSource::Modrinth { project } = &shader.source {
                if let Ok(version) = store.get_latest_version(Platform::Modrinth, project, None, None) {
                    if let Ok(content_ref) = store.download_to_store(&paths, &version, ContentType::ShaderPack) {
                        upsert_shaderpack(&mut profile, content_ref);
                    }
                }
            }
        }

        for pack in &template.resourcepacks {
            if !pack.required {
                continue;
            }
            if let shard::template::ContentSource::Modrinth { project } = &pack.source {
                if let Ok(version) = store.get_latest_version(Platform::Modrinth, project, None, None) {
                    if let Ok(content_ref) = store.download_to_store(&paths, &version, ContentType::ResourcePack) {
                        upsert_resourcepack(&mut profile, content_ref);
                    }
                }
            }
        }

        save_profile(&paths, &profile).map_err(|e| e.to_string())?;
        Ok(profile)
    } else {
        // No template, create regular profile
        let loader = match (input.loader_type, input.loader_version) {
            (Some(loader_type), Some(loader_version)) => {
                let loader_string = format!("{}@{}", loader_type.trim(), loader_version.trim());
                Some(parse_loader(&loader_string).map_err(|e| e.to_string())?)
            }
            (None, None) => None,
            _ => return Err("loader type and version must both be provided".to_string()),
        };

        let args = input.args.unwrap_or_default()
            .split_whitespace()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        let runtime = Runtime {
            java: input.java.filter(|v| !v.trim().is_empty()),
            memory: input.memory.filter(|v| !v.trim().is_empty()),
            args,
        };

        create_profile(&paths, &input.id, &input.mc_version, loader, runtime)
            .map_err(|e| e.to_string())
    }
}

// ==================== Content Store Commands ====================

fn parse_platform(s: &str) -> Result<Platform, String> {
    match s.to_lowercase().as_str() {
        "modrinth" => Ok(Platform::Modrinth),
        "curseforge" => Ok(Platform::CurseForge),
        _ => Err(format!("invalid platform: {}", s)),
    }
}

fn parse_content_type(s: &str) -> Result<ContentType, String> {
    match s.to_lowercase().as_str() {
        "mod" => Ok(ContentType::Mod),
        "resourcepack" => Ok(ContentType::ResourcePack),
        "shader" | "shaderpack" => Ok(ContentType::ShaderPack),
        "modpack" => Ok(ContentType::ModPack),
        _ => Err(format!("invalid content type: {}", s)),
    }
}

#[tauri::command]
pub fn store_search_cmd(input: StoreSearchInput) -> Result<Vec<ContentItem>, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    let has_cf_key = config.curseforge_api_key.is_some();
    let store = ContentStore::new(config.curseforge_api_key.as_deref());

    let content_type = input.content_type.as_ref()
        .map(|s| parse_content_type(s))
        .transpose()?;

    let options = SearchOptions {
        query: input.query,
        content_type,
        game_version: input.game_version,
        loader: input.loader,
        limit: input.limit.unwrap_or(20),
        offset: 0,
    };

    match input.platform.as_deref() {
        Some("modrinth") => store.search_modrinth(&options).map_err(|e| e.to_string()),
        Some("curseforge") => {
            if !has_cf_key {
                return Err("CurseForge search requires an API key. Add it in Settings.".to_string());
            }
            store.search_curseforge_only(&options).map_err(|e| e.to_string())
        }
        _ => store.search(&options).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn store_get_project_cmd(project_id: String, platform: String) -> Result<ContentItem, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    let store = ContentStore::new(config.curseforge_api_key.as_deref());
    let platform = parse_platform(&platform)?;
    store.get_project(platform, &project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn store_get_versions_cmd(
    project_id: String,
    platform: String,
    game_version: Option<String>,
    loader: Option<String>,
    profile_id: Option<String>,
) -> Result<Vec<ContentVersion>, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    let store = ContentStore::new(config.curseforge_api_key.as_deref());
    let platform = parse_platform(&platform)?;

    // Fetch project to determine content type
    let project = store.get_project(platform, &project_id).map_err(|e| e.to_string())?;

    // Determine the effective loader based on content type
    let effective_loader: Option<String> = match project.content_type {
        ContentType::Mod | ContentType::ModPack => loader,
        ContentType::ShaderPack => {
            // For shaders, detect if the profile has iris/optifine installed
            if let Some(pid) = &profile_id {
                if let Ok(profile) = load_profile(&paths, pid) {
                    profile.primary_shader_loader().map(|sl| sl.modrinth_name().to_string())
                } else {
                    None
                }
            } else {
                None
            }
        }
        ContentType::ResourcePack => None, // Resourcepacks use "minecraft" loader, no filter needed
    };

    store.get_versions(platform, &project_id, game_version.as_deref(), effective_loader.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn store_install_cmd(input: StoreInstallInput) -> Result<Profile, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    let store = ContentStore::new(config.curseforge_api_key.as_deref());

    let mut profile = load_profile(&paths, &input.profile_id).map_err(|e| e.to_string())?;
    let platform = parse_platform(&input.platform)?;

    // Get project info to determine content type
    let item = store.get_project(platform, &input.project_id).map_err(|e| e.to_string())?;
    let ct = input.content_type.as_ref()
        .map(|s| parse_content_type(s))
        .transpose()?
        .unwrap_or(item.content_type);

    // Determine effective loader based on content type
    let effective_loader: Option<String> = match ct {
        ContentType::Mod | ContentType::ModPack => profile.loader.as_ref().map(|l| l.loader_type.clone()),
        ContentType::ShaderPack => {
            // For shaders, detect if the profile has iris/optifine installed
            profile.primary_shader_loader().map(|sl| sl.modrinth_name().to_string())
        }
        ContentType::ResourcePack => None, // Resourcepacks use "minecraft" loader, no filter needed
    };

    let version = if let Some(v_id) = input.version_id.clone() {
        let versions = store.get_versions(platform, &input.project_id, None, None)
            .map_err(|e| e.to_string())?;
        versions.into_iter()
            .find(|v| v.version == v_id || v.id == v_id)
            .ok_or_else(|| "version not found".to_string())?
    } else {
        store.get_latest_version(platform, &input.project_id, Some(&profile.mc_version), effective_loader.as_deref())
            .map_err(|e| e.to_string())?
    };

    // Download and store
    let mut content_ref = store.download_to_store(&paths, &version, ct).map_err(|e| e.to_string())?;

    // Add platform/project tracking for update checking
    content_ref.platform = Some(input.platform.clone());
    content_ref.project_id = Some(input.project_id.clone());
    content_ref.version_id = Some(version.id.clone());
    content_ref.pinned = false;

    // Auto-add to library
    if let Ok(library) = Library::from_paths(&paths) {
        let lib_content_type = match ct {
            ContentType::Mod | ContentType::ModPack => "mod",
            ContentType::ResourcePack => "resourcepack",
            ContentType::ShaderPack => "shaderpack",
        };
        let hash = content_ref.hash.strip_prefix("sha256:").unwrap_or(&content_ref.hash);
        let lib_input = LibraryItemInput {
            hash: hash.to_string(),
            content_type: Some(lib_content_type.to_string()),
            name: Some(content_ref.name.clone()),
            file_name: content_ref.file_name.clone(),
            source_url: content_ref.source.clone(),
            source_platform: Some(input.platform.clone()),
            source_project_id: Some(input.project_id.clone()),
            source_version: input.version_id.clone().or_else(|| Some(version.version.clone())),
            ..Default::default()
        };
        let _ = library.add_item(&lib_input);
    }

    // Add to profile
    match ct {
        ContentType::Mod | ContentType::ModPack => upsert_mod(&mut profile, content_ref),
        ContentType::ResourcePack => upsert_resourcepack(&mut profile, content_ref),
        ContentType::ShaderPack => upsert_shaderpack(&mut profile, content_ref),
    };

    save_profile(&paths, &profile).map_err(|e| e.to_string())?;
    Ok(profile)
}

// ==================== Logs Commands ====================

#[tauri::command]
pub fn list_log_files_cmd(profile_id: String) -> Result<Vec<LogFile>, String> {
    let paths = load_paths()?;
    list_log_files(&paths, &profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_logs_cmd(profile_id: String, file: Option<String>, lines: Option<usize>) -> Result<Vec<LogEntry>, String> {
    let paths = load_paths()?;
    let log_path = if let Some(filename) = file {
        paths.instance_logs_dir(&profile_id).join(filename)
    } else {
        paths.instance_latest_log(&profile_id)
    };

    if !log_path.exists() {
        return Ok(Vec::new());
    }

    if let Some(n) = lines {
        read_log_tail(&log_path, n).map_err(|e| e.to_string())
    } else {
        read_log_file(&log_path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn list_crash_reports_cmd(profile_id: String) -> Result<Vec<LogFile>, String> {
    let paths = load_paths()?;
    list_crash_reports(&paths, &profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_crash_report_cmd(profile_id: String, file: Option<String>) -> Result<String, String> {
    let paths = load_paths()?;
    let crash_dir = paths.instance_crash_reports(&profile_id);

    let crash_path = if let Some(filename) = file {
        crash_dir.join(filename)
    } else {
        let files = list_crash_reports(&paths, &profile_id).map_err(|e| e.to_string())?;
        files.into_iter().next().map(|f| f.path)
            .ok_or_else(|| "no crash reports found".to_string())?
    };

    if !crash_path.exists() {
        return Err("crash report not found".to_string());
    }

    std::fs::read_to_string(&crash_path).map_err(|e| e.to_string())
}

fn sanitize_event_segment(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '/' | ':' | '_') { c } else { '_' })
        .collect()
}

/// Start watching a log file and emit events for new entries
#[tauri::command]
pub async fn start_log_watch(
    app: AppHandle,
    profile_id: String,
) -> Result<(), String> {
    let paths = load_paths()?;
    let log_path = paths.instance_latest_log(&profile_id);

    // Spawn background task to watch the log
    std::thread::spawn(move || {
        let mut watcher = LogWatcher::from_start(log_path.clone());
        let event_name = format!("log-entries-{}", sanitize_event_segment(&profile_id));

        loop {
            // Read new entries
            match watcher.read_new() {
                Ok(entries) if !entries.is_empty() => {
                    // Emit event with new log entries
                    if app.emit(&event_name, &entries).is_err() {
                        break; // Window closed
                    }
                }
                Ok(_) => {
                    // No new entries
                }
                Err(_) => {
                    // Error reading log
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    });

    Ok(())
}

// ============================================================================
// Version fetching commands
// ============================================================================

#[derive(Clone, Serialize, Deserialize)]
pub struct ManifestVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    #[serde(rename = "releaseTime")]
    pub release_time: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct VersionManifestResponse {
    versions: Vec<ManifestVersion>,
    latest: Option<LatestVersions>,
}

#[derive(Clone, Serialize, Deserialize)]
struct LatestVersions {
    release: Option<String>,
    snapshot: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct MinecraftVersionsResponse {
    pub versions: Vec<ManifestVersion>,
    pub latest_release: Option<String>,
    pub latest_snapshot: Option<String>,
}

#[tauri::command]
pub fn fetch_minecraft_versions_cmd() -> Result<MinecraftVersionsResponse, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .map_err(|e| format!("Failed to fetch Minecraft versions: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP error: {}", resp.status()));
    }

    let manifest: VersionManifestResponse = resp
        .json()
        .map_err(|e| format!("Failed to parse version manifest: {}", e))?;

    Ok(MinecraftVersionsResponse {
        versions: manifest.versions,
        latest_release: manifest.latest.as_ref().and_then(|l| l.release.clone()),
        latest_snapshot: manifest.latest.as_ref().and_then(|l| l.snapshot.clone()),
    })
}

/// Fabric loader version entry from the Fabric Meta API
#[derive(Clone, Deserialize)]
struct FabricLoaderEntry {
    version: String,
}

#[tauri::command]
pub fn fetch_fabric_versions_cmd() -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://meta.fabricmc.net/v2/versions/loader")
        .send()
        .map_err(|e| format!("Failed to fetch Fabric versions: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP error: {}", resp.status()));
    }

    let entries: Vec<FabricLoaderEntry> = resp
        .json()
        .map_err(|e| format!("Failed to parse Fabric versions: {}", e))?;

    let versions: Vec<String> = entries.into_iter().map(|e| e.version).collect();
    Ok(versions)
}

/// Quilt loader version entry from the Quilt Meta API
#[derive(Clone, Deserialize)]
struct QuiltLoaderEntry {
    version: String,
}

#[tauri::command]
pub fn fetch_quilt_versions_cmd() -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://meta.quiltmc.org/v3/versions/loader")
        .send()
        .map_err(|e| format!("Failed to fetch Quilt versions: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP error: {}", resp.status()));
    }

    let entries: Vec<QuiltLoaderEntry> = resp
        .json()
        .map_err(|e| format!("Failed to parse Quilt versions: {}", e))?;

    let versions: Vec<String> = entries.into_iter().map(|e| e.version).collect();
    Ok(versions)
}

/// NeoForge version entry from the NeoForge API
#[derive(Clone, Deserialize)]
struct NeoForgeVersionsResponse {
    versions: Vec<String>,
}

/// Extract the minor.patch portion from a Minecraft version string.
/// NeoForge versions are based on the MC version without the leading "1." prefix.
/// For example: "1.20.1" -> "20.1", "1.21" -> "21", "2.0" -> "2.0" (future-proof)
fn extract_neoforge_version_filter(mc_version: &str) -> String {
    // Split by '.' and skip the first component (usually "1")
    let parts: Vec<&str> = mc_version.split('.').collect();
    if parts.len() >= 2 {
        // For versions like "1.20.1" -> "20.1", "1.21" -> "21"
        // For potential future "2.0" -> "0" (just the second part onwards)
        parts[1..].join(".")
    } else {
        // Fallback: return as-is if format is unexpected
        mc_version.to_string()
    }
}

#[tauri::command]
pub fn fetch_neoforge_versions_cmd(mc_version: Option<String>) -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::new();

    // NeoForge API returns versions for a specific MC version
    // NeoForge versions omit the leading "1." from MC versions (e.g., 1.20.1 -> 20.1)
    let url = if let Some(ref mc) = mc_version {
        let filter = extract_neoforge_version_filter(mc);
        format!("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge?filter={}.", filter)
    } else {
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge".to_string()
    };

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to fetch NeoForge versions: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP error: {}", resp.status()));
    }

    let data: NeoForgeVersionsResponse = resp
        .json()
        .map_err(|e| format!("Failed to parse NeoForge versions: {}", e))?;

    // Sort versions in descending order (newest first) using semantic versioning
    let mut versions = data.versions;
    versions.sort_by(|a, b| compare_versions_desc(b, a));
    Ok(versions)
}

/// Forge promotions response
#[derive(Clone, Deserialize)]
struct ForgePromotionsResponse {
    promos: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub fn fetch_forge_versions_cmd(mc_version: Option<String>) -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::new();

    // Forge uses a promotions endpoint that lists recommended/latest versions
    let resp = client
        .get("https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json")
        .send()
        .map_err(|e| format!("Failed to fetch Forge promotions: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP error: {}", resp.status()));
    }

    let promos: ForgePromotionsResponse = resp
        .json()
        .map_err(|e| format!("Failed to parse Forge promotions: {}", e))?;

    // Filter versions based on MC version if provided
    let mut versions: Vec<String> = if let Some(mc) = mc_version {
        // Look for versions matching this MC version exactly
        // Key format: "1.20.1-recommended" or "1.20.1-latest"
        let prefix = format!("{}-", mc);
        promos.promos.iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, version)| {
                // Value is the forge version number
                format!("{}-{}", mc, version)
            })
            .collect()
    } else {
        // Return all unique MC-version combinations
        let mut seen = std::collections::HashSet::new();
        promos.promos.iter()
            .filter_map(|(key, version)| {
                // Extract MC version from key (e.g., "1.20.1" from "1.20.1-recommended")
                let mc = key.split('-').next()?;
                let full_version = format!("{}-{}", mc, version);
                if seen.insert(full_version.clone()) {
                    Some(full_version)
                } else {
                    None
                }
            })
            .collect()
    };

    // Sort versions in descending order (newest first) using semantic versioning
    versions.sort_by(|a, b| compare_versions_desc(b, a));
    Ok(versions)
}

/// Compare two version strings semantically (for descending sort)
/// Returns Ordering based on semantic version comparison
fn compare_versions_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let parse_parts = |s: &str| -> Vec<u64> {
        s.split(|c: char| c == '.' || c == '-')
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };

    let a_parts = parse_parts(a);
    let b_parts = parse_parts(b);

    for (a_part, b_part) in a_parts.iter().zip(b_parts.iter()) {
        match a_part.cmp(b_part) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }

    // If all compared parts are equal, longer version is greater
    a_parts.len().cmp(&b_parts.len())
}

/// Fetch loader versions for any supported loader type
#[tauri::command]
pub fn fetch_loader_versions_cmd(loader_type: String, mc_version: Option<String>) -> Result<Vec<String>, String> {
    match loader_type.to_lowercase().as_str() {
        "fabric" => fetch_fabric_versions_cmd(),
        "quilt" => fetch_quilt_versions_cmd(),
        "neoforge" => fetch_neoforge_versions_cmd(mc_version),
        "forge" => fetch_forge_versions_cmd(mc_version),
        other => Err(format!("Unsupported loader type: {}", other)),
    }
}

// ============================================================================
// Java detection and validation commands
// ============================================================================

/// Detect all Java installations on the system.
#[tauri::command]
pub fn detect_java_installations_cmd() -> Vec<JavaInstallation> {
    detect_installations()
}

/// Validate a specific Java path.
#[tauri::command]
pub fn validate_java_path_cmd(path: String) -> JavaValidation {
    validate_java_path(&path)
}

/// Get the minimum required Java version for a Minecraft version.
#[tauri::command]
pub fn get_required_java_version_cmd(mc_version: String) -> u32 {
    get_required_java_version(&mc_version)
}

/// Check if a Java version is compatible with a Minecraft version.
#[tauri::command]
pub fn check_java_compatibility_cmd(java_major: u32, mc_version: String) -> bool {
    is_java_compatible(java_major, &mc_version)
}

/// Fetch Adoptium release info for a Java version.
#[tauri::command]
pub fn fetch_adoptium_release_cmd(java_major: u32) -> Result<AdoptiumRelease, String> {
    fetch_adoptium_release(java_major).map_err(|e| e.to_string())
}

/// Download and install Java from Adoptium.
#[tauri::command]
pub fn download_java_cmd(app: AppHandle, java_major: u32) -> Result<String, String> {
    let paths = Paths::new().map_err(|e| e.to_string())?;
    paths.ensure().map_err(|e| e.to_string())?;

    let install_dir = paths.java_runtimes.join(format!("temurin-{}", java_major));

    // Create a progress callback that emits events
    let app_handle = app.clone();
    let progress_callback = Some(Box::new(move |downloaded: u64, total: u64| {
        let _ = app_handle.emit("java-download-progress", serde_json::json!({
            "downloaded": downloaded,
            "total": total,
            "percentage": if total > 0 { (downloaded as f64 / total as f64 * 100.0) as u32 } else { 0 }
        }));
    }) as Box<dyn Fn(u64, u64) + Send>);

    let java_path = download_and_install_java(java_major, &install_dir, progress_callback)
        .map_err(|e| e.to_string())?;

    Ok(java_path.to_string_lossy().to_string())
}

/// Find a compatible Java for a Minecraft version (checks managed runtimes first).
#[tauri::command]
pub fn find_compatible_java_cmd(mc_version: String) -> Result<Option<String>, String> {
    let paths = Paths::new().map_err(|e| e.to_string())?;
    Ok(find_compatible_java(&mc_version, &paths.java_runtimes))
}

/// Check if a managed Java runtime exists for a version.
#[tauri::command]
pub fn get_managed_java_cmd(java_major: u32) -> Result<Option<String>, String> {
    let paths = Paths::new().map_err(|e| e.to_string())?;
    Ok(get_managed_java(&paths.java_runtimes, java_major).map(|p| p.to_string_lossy().to_string()))
}

/// List all managed Java runtimes.
#[tauri::command]
pub fn list_managed_runtimes_cmd() -> Result<Vec<JavaInstallation>, String> {
    let paths = Paths::new().map_err(|e| e.to_string())?;
    Ok(list_managed_runtimes(&paths.java_runtimes))
}

// ============================================================================
// Library commands
// ============================================================================

#[derive(Deserialize)]
pub struct LibraryFilterInput {
    pub content_type: Option<String>,
    pub search: Option<String>,
    pub tags: Option<Vec<String>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Deserialize)]
pub struct LibraryItemUpdateInput {
    pub name: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn library_list_items_cmd(filter: LibraryFilterInput) -> Result<Vec<LibraryItem>, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    let filter = LibraryFilter {
        content_type: filter.content_type,
        search: filter.search,
        tags: filter.tags,
        limit: filter.limit,
        offset: filter.offset,
    };
    library.list_items(&filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_get_item_cmd(id: i64) -> Result<Option<LibraryItem>, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.get_item(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_get_item_by_hash_cmd(hash: String) -> Result<Option<LibraryItem>, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.get_item_by_hash(&hash).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_add_item_cmd(input: LibraryItemInput) -> Result<LibraryItem, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.add_item(&input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_update_item_cmd(id: i64, input: LibraryItemUpdateInput) -> Result<LibraryItem, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    let item = library.get_item(id).map_err(|e| e.to_string())?
        .ok_or_else(|| "item not found".to_string())?;
    let update = LibraryItemInput {
        hash: item.hash,
        name: input.name,
        notes: input.notes,
        ..Default::default()
    };
    library.update_item(id, &update).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_delete_item_cmd(id: i64, delete_file: bool) -> Result<bool, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;

    if delete_file {
        if let Some(item) = library.get_item(id).map_err(|e| e.to_string())? {
            let store_path = match item.content_type {
                LibraryContentType::Mod => paths.store_mod_path(&item.hash),
                LibraryContentType::ResourcePack => paths.store_resourcepack_path(&item.hash),
                LibraryContentType::ShaderPack => paths.store_shaderpack_path(&item.hash),
                LibraryContentType::Skin => paths.store_skin_path(&item.hash),
            };
            if store_path.exists() {
                std::fs::remove_file(&store_path).map_err(|e| e.to_string())?;
            }
        }
    }

    library.delete_item(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_get_item_path_cmd(id: i64) -> Result<Option<String>, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;

    if let Some(item) = library.get_item(id).map_err(|e| e.to_string())? {
        let store_path = match item.content_type {
            LibraryContentType::Mod => paths.store_mod_path(&item.hash),
            LibraryContentType::ResourcePack => paths.store_resourcepack_path(&item.hash),
            LibraryContentType::ShaderPack => paths.store_shaderpack_path(&item.hash),
            LibraryContentType::Skin => paths.store_skin_path(&item.hash),
        };
        if store_path.exists() {
            Ok(Some(store_path.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn library_import_file_cmd(path: String, content_type: String) -> Result<LibraryItem, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    let ct = LibraryContentType::from_str(&content_type)
        .ok_or_else(|| "invalid content type".to_string())?;
    library.import_file(&paths, &PathBuf::from(path), ct).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_import_folder_cmd(path: String, content_type: String, recursive: bool) -> Result<ImportResult, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    let ct = LibraryContentType::from_str(&content_type)
        .ok_or_else(|| "invalid content type".to_string())?;
    library.import_folder(&paths, &PathBuf::from(path), ct, recursive).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_get_stats_cmd() -> Result<LibraryStats, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.stats().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_sync_cmd() -> Result<ImportResult, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    let mut result = library.sync_with_store(&paths).map_err(|e| e.to_string())?;

    // After syncing, enrich library items with metadata from profiles
    if let Err(e) = enrich_library_from_profiles(&paths, &library) {
        result.errors.push(format!("Warning: Failed to enrich library metadata: {}", e));
    }

    Ok(result)
}

/// Enrich library items with metadata from all profiles
fn enrich_library_from_profiles(paths: &Paths, library: &Library) -> Result<usize, String> {
    let profiles = list_profiles(paths).map_err(|e| e.to_string())?;
    let mut enriched = 0;

    for profile_id in profiles {
        if let Ok(profile) = load_profile(paths, &profile_id) {
            // Enrich from mods
            for content in &profile.mods {
                if library.enrich_item_from_content_ref(
                    &content.hash,
                    &content.name,
                    content.file_name.as_deref(),
                    content.source.as_deref(),
                    content.platform.as_deref(),
                    content.project_id.as_deref(),
                    content.version.as_deref(),
                ).is_ok() {
                    enriched += 1;
                }
            }

            // Enrich from resourcepacks
            for content in &profile.resourcepacks {
                if library.enrich_item_from_content_ref(
                    &content.hash,
                    &content.name,
                    content.file_name.as_deref(),
                    content.source.as_deref(),
                    content.platform.as_deref(),
                    content.project_id.as_deref(),
                    content.version.as_deref(),
                ).is_ok() {
                    enriched += 1;
                }
            }

            // Enrich from shaderpacks
            for content in &profile.shaderpacks {
                if library.enrich_item_from_content_ref(
                    &content.hash,
                    &content.name,
                    content.file_name.as_deref(),
                    content.source.as_deref(),
                    content.platform.as_deref(),
                    content.project_id.as_deref(),
                    content.version.as_deref(),
                ).is_ok() {
                    enriched += 1;
                }
            }
        }
    }

    Ok(enriched)
}

#[tauri::command]
pub fn library_enrich_from_profiles_cmd() -> Result<usize, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    enrich_library_from_profiles(&paths, &library)
}

#[tauri::command]
pub fn library_list_tags_cmd() -> Result<Vec<Tag>, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.list_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_create_tag_cmd(name: String, color: Option<String>) -> Result<Tag, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.create_tag(&name, color.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_delete_tag_cmd(id: i64) -> Result<bool, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.delete_tag(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_set_item_tags_cmd(item_id: i64, tag_names: Vec<String>) -> Result<(), String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.set_item_tags(item_id, &tag_names).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_add_to_profile_cmd(profile_id: String, item_id: i64) -> Result<Profile, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    let mut profile = load_profile(&paths, &profile_id).map_err(|e| e.to_string())?;

    let item = library.get_item(item_id).map_err(|e| e.to_string())?
        .ok_or_else(|| "item not found".to_string())?;

    let content_ref = ContentRef {
        name: item.name.clone(),
        hash: format!("sha256:{}", item.hash),
        version: item.source_version.clone(),
        source: item.source_url.clone(),
        file_name: item.file_name.clone(),
        platform: item.source_platform.clone(),
        project_id: item.source_project_id.clone(),
        version_id: None, // Library items may not have version IDs
        enabled: true,
        pinned: false,
    };

    match item.content_type {
        LibraryContentType::Mod => { upsert_mod(&mut profile, content_ref); }
        LibraryContentType::ResourcePack => { upsert_resourcepack(&mut profile, content_ref); }
        LibraryContentType::ShaderPack => { upsert_shaderpack(&mut profile, content_ref); }
        LibraryContentType::Skin => return Err("skins cannot be added to profiles".to_string()),
    };

    // Link in library
    library.link_item_to_profile(item_id, &profile_id, item.content_type).map_err(|e| e.to_string())?;

    save_profile(&paths, &profile).map_err(|e| e.to_string())?;
    Ok(profile)
}

// ============================================================================
// Settings and Storage Stats Commands
// ============================================================================

#[tauri::command]
pub fn get_data_path_cmd() -> Result<String, String> {
    let paths = load_paths()?;
    // Derive the base path from the profiles directory (profiles is at base/profiles)
    let base = paths.profiles.parent()
        .ok_or_else(|| "could not determine data path".to_string())?;
    Ok(base.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_storage_stats_cmd() -> Result<StorageStats, String> {
    let paths = load_paths()?;
    get_storage_stats(&paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_unused_items_cmd() -> Result<UnusedItemsSummary, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;
    library.get_unused_items().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn purge_unused_items_cmd(content_types: Vec<String>) -> Result<PurgeResult, String> {
    let paths = load_paths()?;
    let library = Library::from_paths(&paths).map_err(|e| e.to_string())?;

    // Convert string content types to LibraryContentType
    let types: Vec<LibraryContentType> = content_types
        .iter()
        .filter_map(|s| LibraryContentType::from_str(s))
        .collect();

    // Always delete files from store when purging
    library.purge_unused_items(&paths, &types, true).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_auto_update_enabled_cmd() -> Result<bool, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    Ok(config.auto_update_enabled)
}

#[tauri::command]
pub fn set_auto_update_enabled_cmd(enabled: bool) -> Result<Config, String> {
    let paths = load_paths()?;
    let mut config = load_config(&paths).map_err(|e| e.to_string())?;
    config.auto_update_enabled = enabled;
    save_config(&paths, &config).map_err(|e| e.to_string())?;
    Ok(config)
}

// ============================================================================
// Update Checking Commands
// ============================================================================

#[tauri::command]
pub fn check_all_updates_cmd() -> Result<UpdateCheckResult, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    check_all_updates(&paths, config.curseforge_api_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_profile_updates_cmd(profile_id: String) -> Result<UpdateCheckResult, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    check_profile_updates(&paths, &profile_id, config.curseforge_api_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_content_update_cmd(
    profile_id: String,
    content_name: String,
    content_type: String,
    new_version_id: String,
) -> Result<Profile, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    apply_update(&paths, &profile_id, &content_name, &content_type, &new_version_id, config.curseforge_api_key.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_content_pinned_cmd(
    profile_id: String,
    content_name: String,
    content_type: String,
    pinned: bool,
) -> Result<Profile, String> {
    let paths = load_paths()?;
    set_content_pinned(&paths, &profile_id, &content_name, &content_type, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_content_enabled_cmd(
    profile_id: String,
    content_name: String,
    content_type: String,
    enabled: bool,
) -> Result<Profile, String> {
    let paths = load_paths()?;
    set_content_enabled(&paths, &profile_id, &content_name, &content_type, enabled).map_err(|e| e.to_string())
}

// Profile organization types (mirrors frontend types)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFolder {
    pub id: String,
    pub name: String,
    pub profiles: Vec<String>,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOrganization {
    pub folders: Vec<ProfileFolder>,
    pub ungrouped: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorite_profile: Option<String>,
}

#[tauri::command]
pub fn load_profile_organization_cmd() -> Result<ProfileOrganization, String> {
    let paths = load_paths()?;
    if paths.profile_organization.exists() {
        let data = std::fs::read_to_string(&paths.profile_organization)
            .map_err(|e| format!("Failed to read profile organization: {}", e))?;
        serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse profile organization: {}", e))
    } else {
        Ok(ProfileOrganization::default())
    }
}

#[tauri::command]
pub fn save_profile_organization_cmd(organization: ProfileOrganization) -> Result<(), String> {
    let paths = load_paths()?;
    let data = serde_json::to_string_pretty(&organization)
        .map_err(|e| format!("Failed to serialize profile organization: {}", e))?;
    std::fs::write(&paths.profile_organization, data)
        .map_err(|e| format!("Failed to write profile organization: {}", e))?;
    Ok(())
}
