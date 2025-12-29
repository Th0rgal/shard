use serde::{Deserialize, Serialize};
use shard::accounts::{Account, Accounts, load_accounts, remove_account, save_accounts, set_active};
use shard::auth::{DeviceCode, request_device_code};
use shard::config::{Config, load_config, save_config};
use shard::content_store::{ContentStore, ContentType, Platform, SearchOptions, ContentItem, ContentVersion};
use shard::logs::{LogEntry, LogFile, list_log_files, list_crash_reports, read_log_file, read_log_tail};
use shard::minecraft::{LaunchPlan, prepare};
use shard::ops::{finish_device_code_flow, parse_loader, resolve_input, resolve_launch_account};
use shard::paths::Paths;
use shard::profile::{ContentRef, Loader, Profile, Runtime, clone_profile, create_profile, diff_profiles, load_profile, save_profile, upsert_mod, upsert_resourcepack, upsert_shaderpack, remove_mod, remove_resourcepack, remove_shaderpack, list_profiles};
use shard::skin::{MinecraftProfile, get_profile as get_mc_profile, get_avatar_url, get_body_url, get_skin_url, get_cape_url, upload_skin, set_skin_url, reset_skin, set_cape, hide_cape, SkinVariant};
use shard::store::{ContentKind, store_content};
use shard::template::{Template, list_templates, load_template, init_builtin_templates};
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
    let stored = store_content(&paths, kind, &path, source, file_name_hint).map_err(|e| e.to_string())?;
    let content_ref = ContentRef {
        name: name.unwrap_or(stored.name),
        hash: stored.hash,
        version,
        source: stored.source,
        file_name: Some(stored.file_name),
    };

    let changed = match kind {
        ContentKind::Mod => upsert_mod(&mut profile_data, content_ref),
        ContentKind::ResourcePack => upsert_resourcepack(&mut profile_data, content_ref),
        ContentKind::ShaderPack => upsert_shaderpack(&mut profile_data, content_ref),
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
pub async fn launch_profile_cmd(app: AppHandle, profile_id: String, account_id: Option<String>) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = run_launch(app_handle.clone(), profile_id, account_id) {
            let _ = app_handle.emit("launch-status", LaunchEvent {
                stage: "error".to_string(),
                message: Some(err),
            });
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
        message: None,
    });
    let paths = load_paths()?;
    let profile = load_profile(&paths, &profile_id).map_err(|e| e.to_string())?;
    let account = resolve_launch_account(&paths, account_id).map_err(|e| e.to_string())?;
    let plan = prepare(&paths, &profile, &account).map_err(|e| e.to_string())?;

    let _ = app.emit("launch-status", LaunchEvent {
        stage: "launching".to_string(),
        message: None,
    });

    let status = Command::new(&plan.java_exec)
        .args(&plan.jvm_args)
        .arg("-cp")
        .arg(&plan.classpath)
        .arg(&plan.main_class)
        .args(&plan.game_args)
        .current_dir(&plan.instance_dir)
        .status()
        .map_err(|e| e.to_string())?;

    if !status.success() {
        return Err(format!("minecraft exited with status {status}"));
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
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    let profile = get_mc_profile(&account.minecraft.access_token).ok();

    Ok(AccountInfo {
        uuid: account.uuid.clone(),
        username: account.username.clone(),
        avatar_url: get_avatar_url(&account.uuid, 128),
        body_url: get_body_url(&account.uuid, 256),
        skin_url: get_skin_url(&account.uuid),
        cape_url: get_cape_url(&account.uuid),
        profile,
    })
}

#[tauri::command]
pub fn upload_skin_cmd(id: Option<String>, path: String, variant: String) -> Result<(), String> {
    let paths = load_paths()?;
    let accounts = load_accounts(&paths).map_err(|e| e.to_string())?;

    let target = id.or_else(|| accounts.active.clone())
        .ok_or_else(|| "no account selected".to_string())?;

    let account = accounts.accounts.iter()
        .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
        .ok_or_else(|| "account not found".to_string())?;

    let variant: SkinVariant = variant.parse().map_err(|e: anyhow::Error| e.to_string())?;
    upload_skin(&account.minecraft.access_token, &PathBuf::from(path), variant)
        .map_err(|e| e.to_string())
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

    let variant: SkinVariant = variant.parse().map_err(|e: anyhow::Error| e.to_string())?;
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
        Some("curseforge") => Err("CurseForge search requires API key".to_string()),
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
) -> Result<Vec<ContentVersion>, String> {
    let paths = load_paths()?;
    let config = load_config(&paths).map_err(|e| e.to_string())?;
    let store = ContentStore::new(config.curseforge_api_key.as_deref());
    let platform = parse_platform(&platform)?;
    store.get_versions(platform, &project_id, game_version.as_deref(), loader.as_deref())
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

    // Get version
    let version = if let Some(v_id) = input.version_id {
        let versions = store.get_versions(platform, &input.project_id, None, None)
            .map_err(|e| e.to_string())?;
        versions.into_iter()
            .find(|v| v.version == v_id || v.id == v_id)
            .ok_or_else(|| "version not found".to_string())?
    } else {
        let loader = profile.loader.as_ref().map(|l| l.loader_type.as_str());
        store.get_latest_version(platform, &input.project_id, Some(&profile.mc_version), loader)
            .map_err(|e| e.to_string())?
    };

    // Download and store
    let content_ref = store.download_to_store(&paths, &version, ct).map_err(|e| e.to_string())?;

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
