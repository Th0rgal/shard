use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand, ValueEnum};
use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use semver::Version;
use serde::Deserialize;
use shard::accounts::{delete_account_tokens, load_accounts, remove_account, save_accounts, set_active};
use shard::auth::request_device_code;
use shard::config::{load_config, save_config};
use shard::content_store::{ContentStore, ContentType, Platform, SearchOptions};
use shard::library::{
    Library, LibraryContentType, LibraryFilter, LibraryItemInput,
};
use shard::logs::{
    filter_by_level, format_entry, list_crash_reports, list_log_files, read_log_file,
    read_log_tail, search_logs, watch_log, LogLevel,
};
use shard::minecraft::{launch, prepare};
use shard::modpack::import_mrpack;
use shard::ops::{finish_device_code_flow, parse_loader, resolve_input, resolve_launch_account};
use shard::paths::Paths;
use shard::profile::{
    ContentRef, Loader, Runtime, clone_profile, create_profile, delete_profile, diff_profiles,
    list_profiles, load_profile, remove_mod, remove_resourcepack, remove_shaderpack, rename_profile,
    save_profile, upsert_mod, upsert_resourcepack, upsert_shaderpack,
};
use shard::skin::{
    get_active_cape, get_active_skin, get_avatar_url, get_body_url, get_profile as get_mc_profile,
    get_skin_url, hide_cape, reset_skin, set_cape, set_skin_url, upload_skin, SkinVariant,
};
use shard::store::{ContentKind, store_content};
use shard::template::{
    delete_template, init_builtin_templates, list_templates, load_template, save_template,
    ContentSource, Template, TemplateLoader, TemplateRuntime,
};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Parser, Debug)]
#[command(name = "shard", version, about = "Minimal Minecraft launcher")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

const DEFAULT_UPDATER_ENDPOINT: &str =
    "https://github.com/th0rgal/shard/releases/latest/download/latest.json";

#[derive(Debug, Deserialize)]
struct ReleaseManifestPlatform {
    url: String,
    signature: String,
}

#[derive(Debug, Deserialize)]
struct ReleaseManifest {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    platforms: HashMap<String, ReleaseManifestPlatform>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// List profiles
    List,
    /// Profile management
    Profile {
        #[command(subcommand)]
        command: ProfileCommand,
    },
    /// Mod management
    Mod {
        #[command(subcommand)]
        command: ModCommand,
    },
    /// Resourcepack management
    Resourcepack {
        #[command(subcommand)]
        command: PackCommand,
    },
    /// Shaderpack management
    Shaderpack {
        #[command(subcommand)]
        command: PackCommand,
    },
    /// Account management
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    /// Template management
    Template {
        #[command(subcommand)]
        command: TemplateCommand,
    },
    /// Content store (Modrinth/CurseForge)
    Store {
        #[command(subcommand)]
        command: StoreCommand,
    },
    /// Log viewing
    Logs {
        #[command(subcommand)]
        command: LogsCommand,
    },
    /// Content library management
    Library {
        #[command(subcommand)]
        command: LibraryCommand,
    },
    /// Modpack management
    Modpack {
        #[command(subcommand)]
        command: ModpackCommand,
    },
    /// Configuration
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Desktop app update checks
    AppUpdate {
        #[command(subcommand)]
        command: AppUpdateCommand,
    },
    /// Prepare and launch a profile
    Launch {
        profile: String,
        #[arg(long)]
        account: Option<String>,
        #[arg(long)]
        prepare_only: bool,
    },
}

#[derive(Subcommand, Debug)]
enum ProfileCommand {
    /// Create a new profile
    Create {
        id: String,
        #[arg(long = "mc")]
        mc_version: String,
        #[arg(long)]
        loader: Option<String>,
        #[arg(long)]
        java: Option<String>,
        #[arg(long)]
        memory: Option<String>,
        #[arg(long = "arg")]
        args: Vec<String>,
        /// Create from a template
        #[arg(long)]
        template: Option<String>,
    },
    /// Clone an existing profile
    Clone { src: String, dst: String },
    /// Rename a profile
    Rename {
        /// Current profile ID
        id: String,
        /// New profile ID
        new_id: String,
    },
    /// Diff two profiles by mod names
    Diff { a: String, b: String },
    /// Print a profile manifest
    Show { id: String },
    /// Delete a profile
    Delete { id: String },
    /// List all profiles
    List,
}

#[derive(Subcommand, Debug)]
enum ModCommand {
    /// Add a mod file or URL to a profile
    Add {
        profile: String,
        input: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        version: Option<String>,
    },
    /// Remove a mod by name or hash from a profile
    Remove { profile: String, target: String },
    /// List mods in a profile
    List { profile: String },
}

#[derive(Subcommand, Debug)]
enum PackCommand {
    /// Add a pack file or URL to a profile
    Add {
        profile: String,
        input: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        version: Option<String>,
    },
    /// Remove a pack by name or hash from a profile
    Remove { profile: String, target: String },
    /// List packs in a profile
    List { profile: String },
}

#[derive(Subcommand, Debug)]
enum ModpackCommand {
    /// Import a Modrinth .mrpack into a new profile
    Import {
        /// Path to .mrpack file
        path: PathBuf,
        /// Optional profile id (defaults to pack name)
        #[arg(long)]
        id: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum AccountCommand {
    /// Add a Microsoft account (device code flow)
    Add {
        #[arg(long)]
        client_id: Option<String>,
        #[arg(long)]
        client_secret: Option<String>,
    },
    /// List accounts
    List,
    /// Set active account by UUID or username
    Use { id: String },
    /// Remove an account by UUID or username
    Remove { id: String },
    /// Show account profile info (skin, cape)
    Info { id: Option<String> },
    /// Skin management
    Skin {
        #[command(subcommand)]
        command: SkinCommand,
    },
    /// Cape management
    Cape {
        #[command(subcommand)]
        command: CapeCommand,
    },
}

#[derive(Subcommand, Debug)]
enum SkinCommand {
    /// Set skin from a local file
    Upload {
        /// Path to skin image (64x64 PNG)
        path: PathBuf,
        /// Skin variant (classic or slim)
        #[arg(long, default_value = "classic")]
        variant: String,
        /// Account to modify (default: active)
        #[arg(long)]
        account: Option<String>,
    },
    /// Set skin from a URL
    Url {
        /// URL to skin image
        url: String,
        /// Skin variant (classic or slim)
        #[arg(long, default_value = "classic")]
        variant: String,
        /// Account to modify (default: active)
        #[arg(long)]
        account: Option<String>,
    },
    /// Reset skin to default (Steve/Alex based on UUID)
    Reset {
        /// Account to modify (default: active)
        #[arg(long)]
        account: Option<String>,
    },
    /// Check the active skin URL and download headers
    Check {
        /// Account to query (default: active)
        #[arg(long)]
        account: Option<String>,
        /// Save the skin PNG to a file
        #[arg(long)]
        save: Option<PathBuf>,
    },
}

#[derive(Subcommand, Debug)]
enum CapeCommand {
    /// List available capes for an account
    List {
        /// Account to query (default: active)
        #[arg(long)]
        account: Option<String>,
    },
    /// Set active cape
    Set {
        /// Cape ID to activate
        cape_id: String,
        /// Account to modify (default: active)
        #[arg(long)]
        account: Option<String>,
    },
    /// Hide/remove active cape
    Hide {
        /// Account to modify (default: active)
        #[arg(long)]
        account: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum TemplateCommand {
    /// List available templates
    List,
    /// Show template details
    Show { id: String },
    /// Create a new template
    Create {
        id: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        description: Option<String>,
        #[arg(long = "mc")]
        mc_version: String,
        #[arg(long)]
        loader: Option<String>,
    },
    /// Import a template from JSON file
    Import { path: PathBuf },
    /// Export a template to JSON file
    Export { id: String, path: PathBuf },
    /// Delete a template
    Delete { id: String },
    /// Initialize built-in templates
    Init,
}

#[derive(Subcommand, Debug)]
enum StoreCommand {
    /// Search for content
    Search {
        query: String,
        /// Content type (mod, resourcepack, shader)
        #[arg(long, short = 't')]
        content_type: Option<StoreContentType>,
        /// Game version filter
        #[arg(long = "mc")]
        game_version: Option<String>,
        /// Loader filter (fabric, forge, quilt)
        #[arg(long)]
        loader: Option<String>,
        /// Platform filter (modrinth, curseforge)
        #[arg(long)]
        platform: Option<StorePlatform>,
        /// Maximum results
        #[arg(long, default_value = "10")]
        limit: u32,
    },
    /// Get project info
    Info {
        /// Project slug or ID
        project: String,
        /// Platform (modrinth or curseforge)
        #[arg(long, default_value = "modrinth")]
        platform: StorePlatform,
    },
    /// List available versions for a project
    Versions {
        /// Project slug or ID
        project: String,
        /// Platform
        #[arg(long, default_value = "modrinth")]
        platform: StorePlatform,
        /// Game version filter
        #[arg(long = "mc")]
        game_version: Option<String>,
        /// Loader filter
        #[arg(long)]
        loader: Option<String>,
    },
    /// Download and add content to a profile
    Install {
        /// Profile to add content to
        profile: String,
        /// Project slug or ID
        project: String,
        /// Platform
        #[arg(long, default_value = "modrinth")]
        platform: StorePlatform,
        /// Specific version (default: latest)
        #[arg(long)]
        version: Option<String>,
        /// Content type (default: auto-detect)
        #[arg(long, short = 't')]
        content_type: Option<StoreContentType>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum StoreContentType {
    Mod,
    Resourcepack,
    Shader,
}

impl From<StoreContentType> for ContentType {
    fn from(t: StoreContentType) -> Self {
        match t {
            StoreContentType::Mod => ContentType::Mod,
            StoreContentType::Resourcepack => ContentType::ResourcePack,
            StoreContentType::Shader => ContentType::ShaderPack,
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum StorePlatform {
    Modrinth,
    Curseforge,
}

impl StorePlatform {
    fn as_str(&self) -> &'static str {
        match self {
            StorePlatform::Modrinth => "modrinth",
            StorePlatform::Curseforge => "curseforge",
        }
    }
}

impl From<StorePlatform> for Platform {
    fn from(p: StorePlatform) -> Self {
        match p {
            StorePlatform::Modrinth => Platform::Modrinth,
            StorePlatform::Curseforge => Platform::CurseForge,
        }
    }
}

#[derive(Subcommand, Debug)]
enum LogsCommand {
    /// List log files for a profile
    List { profile: String },
    /// Show logs from a profile
    Show {
        profile: String,
        /// Number of lines to show (default: all)
        #[arg(long, short = 'n')]
        lines: Option<usize>,
        /// Minimum log level (debug, info, warn, error)
        #[arg(long)]
        level: Option<String>,
        /// Search for text in logs
        #[arg(long)]
        search: Option<String>,
        /// Show specific log file instead of latest
        #[arg(long)]
        file: Option<String>,
    },
    /// Watch logs in real-time
    Watch {
        profile: String,
        /// Minimum log level
        #[arg(long)]
        level: Option<String>,
    },
    /// List crash reports for a profile
    Crashes { profile: String },
    /// Show a crash report
    Crash {
        profile: String,
        /// Crash report filename (default: latest)
        file: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum ConfigCommand {
    /// Show current config
    Show,
    /// Set Microsoft client id
    SetClientId { client_id: String },
    /// Set Microsoft client secret
    SetClientSecret { client_secret: String },
    /// Set CurseForge API key
    SetCurseforgeKey { api_key: String },
}

#[derive(Subcommand, Debug)]
enum AppUpdateCommand {
    /// Check the desktop app update manifest
    Check {
        /// Override the updater manifest endpoint
        #[arg(long)]
        endpoint: Option<String>,
        /// Override the platform target (default: current platform)
        #[arg(long)]
        platform: Option<String>,
        /// Override the current app version used for comparison
        #[arg(long)]
        current: Option<String>,
        /// Print the raw manifest JSON
        #[arg(long)]
        print_manifest: bool,
    },
}

#[derive(Subcommand, Debug)]
enum LibraryCommand {
    /// List library items
    List {
        /// Content type filter (mod, resourcepack, shaderpack, skin)
        #[arg(long, short = 't')]
        content_type: Option<String>,
        /// Search by name
        #[arg(long, short = 's')]
        search: Option<String>,
        /// Filter by tag
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Maximum results
        #[arg(long, default_value = "50")]
        limit: u32,
    },
    /// Show details of a library item
    Show {
        /// Item ID or hash
        id: String,
    },
    /// Import a file or folder into the library
    Import {
        /// Path to file or folder
        path: PathBuf,
        /// Content type (mod, resourcepack, shaderpack, skin)
        #[arg(long, short = 't')]
        content_type: String,
        /// Recursive import for folders
        #[arg(long, short = 'r')]
        recursive: bool,
    },
    /// Remove an item from the library
    Remove {
        /// Item ID or hash
        id: String,
        /// Also delete the file from the content store
        #[arg(long)]
        delete_file: bool,
    },
    /// Update an item's metadata
    Update {
        /// Item ID or hash
        id: String,
        /// New name
        #[arg(long)]
        name: Option<String>,
        /// Notes
        #[arg(long)]
        notes: Option<String>,
    },
    /// Show library statistics
    Stats,
    /// Sync library with content store
    Sync,
    /// Tag management
    Tag {
        #[command(subcommand)]
        command: TagCommand,
    },
}

#[derive(Subcommand, Debug)]
enum TagCommand {
    /// List all tags
    List,
    /// Create a new tag
    Create {
        /// Tag name
        name: String,
        /// Tag color (hex)
        #[arg(long)]
        color: Option<String>,
    },
    /// Delete a tag
    Delete {
        /// Tag name
        name: String,
    },
    /// Add a tag to an item
    Add {
        /// Item ID or hash
        item: String,
        /// Tag name
        tag: String,
    },
    /// Remove a tag from an item
    Remove {
        /// Item ID or hash
        item: String,
        /// Tag name
        tag: String,
    },
}

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err}");
        let mut source = err.source();
        while let Some(inner) = source {
            eprintln!("  caused by: {inner}");
            source = inner.source();
        }
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let paths = Paths::new()?;
    paths.ensure()?;

    match cli.command {
        Command::List => {
            let profiles = list_profiles(&paths)?;
            if profiles.is_empty() {
                println!("no profiles found");
            } else {
                for id in profiles {
                    println!("{id}");
                }
            }
        }
        Command::Profile { command } => match command {
            ProfileCommand::Create {
                id,
                mc_version,
                loader,
                java,
                memory,
                args,
                template,
            } => {
                if let Some(template_id) = template {
                    // Initialize templates first
                    init_builtin_templates(&paths)?;
                    create_profile_from_template(&paths, &id, &template_id, java, memory, args)?;
                } else {
                    let loader = match loader {
                        Some(value) => Some(parse_loader(&value)?),
                        None => None,
                    };
                    let runtime = Runtime { java, memory, args };
                    create_profile(&paths, &id, &mc_version, loader, runtime)?;
                    println!("created profile {id}");
                }
            }
            ProfileCommand::Clone { src, dst } => {
                clone_profile(&paths, &src, &dst)?;
                println!("cloned profile {src} -> {dst}");
            }
            ProfileCommand::Diff { a, b } => {
                let profile_a = load_profile(&paths, &a)?;
                let profile_b = load_profile(&paths, &b)?;
                let (only_a, only_b, both) = diff_profiles(&profile_a, &profile_b);
                println!("only in {a}:");
                if only_a.is_empty() {
                    println!("  (none)");
                } else {
                    for name in only_a {
                        println!("  {name}");
                    }
                }
                println!("only in {b}:");
                if only_b.is_empty() {
                    println!("  (none)");
                } else {
                    for name in only_b {
                        println!("  {name}");
                    }
                }
                println!("in both:");
                if both.is_empty() {
                    println!("  (none)");
                } else {
                    for name in both {
                        println!("  {name}");
                    }
                }
            }
            ProfileCommand::Show { id } => {
                let profile = load_profile(&paths, &id)?;
                let data = serde_json::to_string_pretty(&profile)?;
                println!("{data}");
            }
            ProfileCommand::Rename { id, new_id } => {
                rename_profile(&paths, &id, &new_id)?;
                println!("renamed profile {id} -> {new_id}");
            }
            ProfileCommand::Delete { id } => {
                delete_profile(&paths, &id)?;
                println!("deleted profile {id}");
            }
            ProfileCommand::List => {
                let profiles = list_profiles(&paths)?;
                if profiles.is_empty() {
                    println!("no profiles");
                } else {
                    for id in profiles {
                        println!("{id}");
                    }
                }
            }
        },
        Command::Mod { command } => match command {
            ModCommand::Add {
                profile,
                input,
                name,
                version,
            } => {
                let mut profile_data = load_profile(&paths, &profile)?;
                let (path, source, file_name_hint) = resolve_input(&paths, &input)?;
                let stored =
                    store_content(&paths, ContentKind::Mod, &path, source, file_name_hint)?;
                let mod_ref = ContentRef {
                    name: name.unwrap_or(stored.name),
                    hash: stored.hash,
                    version,
                    source: stored.source,
                    file_name: Some(stored.file_name),
                    platform: None, // CLI imports are local
                    project_id: None,
                    version_id: None,
                    enabled: true,
                    pinned: false,
                };
                let changed = upsert_mod(&mut profile_data, mod_ref);
                save_profile(&paths, &profile_data)?;
                if changed {
                    println!("updated profile {profile}");
                } else {
                    println!("mod already present in profile {profile}");
                }
            }
            ModCommand::Remove { profile, target } => {
                let mut profile_data = load_profile(&paths, &profile)?;
                if remove_mod(&mut profile_data, &target) {
                    save_profile(&paths, &profile_data)?;
                    println!("removed mod from profile {profile}");
                } else {
                    bail!("mod not found in profile {profile}");
                }
            }
            ModCommand::List { profile } => {
                let profile_data = load_profile(&paths, &profile)?;
                if profile_data.mods.is_empty() {
                    println!("no mods in profile {profile}");
                } else {
                    for mod_ref in profile_data.mods {
                        println!("{}\t{}", mod_ref.name, mod_ref.hash);
                    }
                }
            }
        },
        Command::Resourcepack { command } => {
            handle_pack_command(&paths, ContentKind::ResourcePack, command)?
        }
        Command::Shaderpack { command } => {
            handle_pack_command(&paths, ContentKind::ShaderPack, command)?
        }
        Command::Account { command } => handle_account_command(&paths, command)?,
        Command::Template { command } => handle_template_command(&paths, command)?,
        Command::Store { command } => handle_store_command(&paths, command)?,
        Command::Logs { command } => handle_logs_command(&paths, command)?,
        Command::Library { command } => handle_library_command(&paths, command)?,
        Command::Modpack { command } => handle_modpack_command(&paths, command)?,
        Command::Config { command } => match command {
            ConfigCommand::Show => {
                let config = load_config(&paths)?;
                let data = serde_json::to_string_pretty(&config)?;
                println!("{data}");
            }
            ConfigCommand::SetClientId { client_id } => {
                let mut config = load_config(&paths)?;
                config.msa_client_id = Some(client_id.clone());
                save_config(&paths, &config)?;
                println!("saved Microsoft client id");
            }
            ConfigCommand::SetClientSecret { client_secret } => {
                let mut config = load_config(&paths)?;
                config.msa_client_secret = Some(client_secret.clone());
                save_config(&paths, &config)?;
                println!("saved Microsoft client secret");
            }
            ConfigCommand::SetCurseforgeKey { api_key } => {
                let mut config = load_config(&paths)?;
                config.curseforge_api_key = Some(api_key.clone());
                save_config(&paths, &config)?;
                println!("saved CurseForge API key");
            }
        },
        Command::AppUpdate { command } => handle_app_update_command(command)?,
        Command::Launch {
            profile,
            account,
            prepare_only,
        } => {
            let profile_data = load_profile(&paths, &profile)?;
            let launch_account = resolve_launch_account(&paths, account)?;
            if prepare_only {
                let plan = prepare(&paths, &profile_data, &launch_account)?;
                println!("prepared instance: {}", plan.instance_dir.display());
                println!("java: {}", plan.java_exec);
                println!("main class: {}", plan.main_class);
                println!("classpath: {}", plan.classpath);
                println!("jvm args: {}", plan.jvm_args.join(" "));
                println!("game args: {}", plan.game_args.join(" "));
            } else {
                launch(&paths, &profile_data, &launch_account)?;
            }
        }
    }

    Ok(())
}

fn handle_app_update_command(command: AppUpdateCommand) -> Result<()> {
    match command {
        AppUpdateCommand::Check {
            endpoint,
            platform,
            current,
            print_manifest,
        } => {
            let endpoint = endpoint.unwrap_or_else(|| DEFAULT_UPDATER_ENDPOINT.to_string());
            let target = match platform {
                Some(value) => value,
                None => updater_target()
                    .context("unsupported OS/arch for updater target; use --platform to override")?,
            };

            let client = Client::builder()
                .user_agent(format!("ShardCLI/{}", env!("CARGO_PKG_VERSION")))
                .build()?;

            let response = client
                .get(&endpoint)
                .send()
                .with_context(|| format!("failed to GET {endpoint}"))?;

            let status = response.status();
            let headers = response.headers().clone();
            let body = response.bytes()?;

            println!("manifest: {endpoint}");
            println!("status: {status}");
            if let Some(content_type) = headers.get(reqwest::header::CONTENT_TYPE) {
                if let Ok(value) = content_type.to_str() {
                    println!("content-type: {value}");
                }
            }

            if !status.is_success() {
                bail!("updater manifest request failed ({status})");
            }

            if print_manifest {
                println!("{}", String::from_utf8_lossy(&body));
            }

            let value: serde_json::Value = serde_json::from_slice(&body).map_err(|err| {
                let tail = String::from_utf8_lossy(&body[body.len().saturating_sub(120)..]);
                anyhow::anyhow!("failed to parse updater manifest: {err}. tail: {tail:?}")
            })?;
            let manifest: ReleaseManifest =
                serde_json::from_value(value).context("updater manifest format error")?;

            println!("target: {target}");
            println!("latest version: {}", manifest.version);
            let current_version =
                current.unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
            let latest_semver = parse_version(&manifest.version)?;
            let current_semver = parse_version(&current_version)?;
            let update_available = latest_semver > current_semver;
            println!("current version: {current_semver}");
            println!(
                "update available: {}",
                if update_available { "yes" } else { "no" }
            );
            if let Some(notes) = manifest.notes.as_ref().filter(|value| !value.trim().is_empty())
            {
                println!("notes: {notes}");
            }
            if let Some(pub_date) = manifest.pub_date.as_deref() {
                println!("pub date: {pub_date}");
            }

            let platform = manifest.platforms.get(&target).with_context(|| {
                let available = manifest
                    .platforms
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("target {target} not found in manifest; available: {available}")
            })?;
            println!("download url: {}", platform.url);
            println!("signature: {}", platform.signature);
        }
    }
    Ok(())
}

fn updater_target() -> Option<String> {
    let os = match std::env::consts::OS {
        "linux" => "linux",
        "macos" => "darwin",
        "windows" => "windows",
        _ => return None,
    };

    let arch = match std::env::consts::ARCH {
        "x86" => "i686",
        "x86_64" => "x86_64",
        "arm" => "armv7",
        "aarch64" => "aarch64",
        _ => return None,
    };

    Some(format!("{os}-{arch}"))
}

fn parse_version(value: &str) -> Result<Version> {
    let trimmed = value.trim().trim_start_matches('v');
    Version::parse(trimmed).with_context(|| format!("invalid version: {value}"))
}

fn normalize_texture_url(url: &str) -> String {
    if let Some(stripped) = url.strip_prefix("http://") {
        format!("https://{}", stripped)
    } else {
        url.to_string()
    }
}

fn handle_pack_command(paths: &Paths, kind: ContentKind, command: PackCommand) -> Result<()> {
    match command {
        PackCommand::Add {
            profile,
            input,
            name,
            version,
        } => {
            let mut profile_data = load_profile(paths, &profile)?;
            let (path, source, file_name_hint) = resolve_input(paths, &input)?;
            let stored = store_content(paths, kind, &path, source, file_name_hint)?;
            let pack_ref = ContentRef {
                name: name.unwrap_or(stored.name),
                hash: stored.hash,
                version,
                source: stored.source,
                file_name: Some(stored.file_name),
                platform: None, // CLI imports are local
                project_id: None,
                version_id: None,
                enabled: true,
                pinned: false,
            };
            let changed = match kind {
                ContentKind::ResourcePack => upsert_resourcepack(&mut profile_data, pack_ref),
                ContentKind::ShaderPack => upsert_shaderpack(&mut profile_data, pack_ref),
                ContentKind::Mod | ContentKind::Skin => false,
            };
            save_profile(paths, &profile_data)?;
            if changed {
                println!("updated profile {profile}");
            } else {
                println!("pack already present in profile {profile}");
            }
        }
        PackCommand::Remove { profile, target } => {
            let mut profile_data = load_profile(paths, &profile)?;
            let changed = match kind {
                ContentKind::ResourcePack => remove_resourcepack(&mut profile_data, &target),
                ContentKind::ShaderPack => remove_shaderpack(&mut profile_data, &target),
                ContentKind::Mod | ContentKind::Skin => false,
            };
            if changed {
                save_profile(paths, &profile_data)?;
                println!("removed pack from profile {profile}");
            } else {
                bail!("pack not found in profile {profile}");
            }
        }
        PackCommand::List { profile } => {
            let profile_data = load_profile(paths, &profile)?;
            let list = match kind {
                ContentKind::ResourcePack => profile_data.resourcepacks,
                ContentKind::ShaderPack => profile_data.shaderpacks,
                ContentKind::Mod | ContentKind::Skin => Vec::new(),
            };
            if list.is_empty() {
                println!("no packs in profile {profile}");
            } else {
                for pack in list {
                    println!("{}\t{}", pack.name, pack.hash);
                }
            }
        }
    }
    Ok(())
}

fn handle_account_command(paths: &Paths, command: AccountCommand) -> Result<()> {
    match command {
        AccountCommand::Add {
            client_id,
            client_secret,
        } => {
            let config = load_config(paths)?;
            let client_id = client_id.or(config.msa_client_id).context(
                "missing Microsoft client id; set SHARD_MS_CLIENT_ID or shard config set-client-id",
            )?;
            let secret = client_secret.or(config.msa_client_secret);
            add_account_flow(paths, &client_id, secret.as_deref())?;
        }
        AccountCommand::List => {
            let accounts = load_accounts(paths)?;
            if accounts.accounts.is_empty() {
                println!("no accounts configured");
            } else {
                for account in accounts.accounts {
                    let active = accounts.active.as_deref() == Some(&account.uuid);
                    let marker = if active { "*" } else { " " };
                    println!("{marker} {} ({})", account.username, account.uuid);
                }
            }
        }
        AccountCommand::Use { id } => {
            let mut accounts = load_accounts(paths)?;
            if set_active(&mut accounts, &id) {
                save_accounts(paths, &accounts)?;
                println!("active account set to {id}");
            } else {
                bail!("account not found: {id}");
            }
        }
        AccountCommand::Remove { id } => {
            let mut accounts = load_accounts(paths)?;
            if accounts.accounts.is_empty() {
                bail!("no accounts configured");
            }
            if remove_account(&mut accounts, &id) {
                delete_account_tokens(&id)?;
                save_accounts(paths, &accounts)?;
                println!("removed account {id}");
            } else {
                bail!("account not found: {id}");
            }
        }
        AccountCommand::Info { id } => {
            let accounts = load_accounts(paths)?;
            let target = id
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;

            let account = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            println!("Username: {}", account.username);
            println!("UUID: {}", account.uuid);
            println!("Avatar: {}", get_avatar_url(&account.uuid, 128));
            println!("Body: {}", get_body_url(&account.uuid, 256));

            // Try to get full profile for skin/cape info
            let mc_profile = get_mc_profile(&account.minecraft.access_token);
            match mc_profile {
                Ok(profile) => {
                    if let Some(skin) = get_active_skin(&profile) {
                        println!(
                            "Skin: {} ({})",
                            skin.url,
                            skin.variant.as_deref().unwrap_or("classic")
                        );
                    }
                    if let Some(cape) = get_active_cape(&profile) {
                        println!(
                            "Cape: {} ({})",
                            cape.alias.as_deref().unwrap_or(&cape.id),
                            cape.url
                        );
                    }
                    if profile.capes.is_empty() {
                        println!("Capes: (none)");
                    } else {
                        println!("Available capes:");
                        for cape in &profile.capes {
                            let active = cape.state == "ACTIVE";
                            let marker = if active { "*" } else { " " };
                            println!(
                                "  {marker} {} - {}",
                                cape.id,
                                cape.alias.as_deref().unwrap_or("(no alias)")
                            );
                        }
                    }
                }
                Err(e) => {
                    println!("(could not fetch skin/cape info: {e})");
                }
            }
        }
        AccountCommand::Skin { command } => handle_skin_command(paths, command)?,
        AccountCommand::Cape { command } => handle_cape_command(paths, command)?,
    }
    Ok(())
}

fn handle_skin_command(paths: &Paths, command: SkinCommand) -> Result<()> {
    let accounts = load_accounts(paths)?;

    match command {
        SkinCommand::Upload {
            path,
            variant,
            account,
        } => {
            let target = account
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;
            let acc = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            let variant: SkinVariant = variant.parse()?;
            upload_skin(&acc.minecraft.access_token, &path, variant)?;
            println!("uploaded skin for {}", acc.username);
        }
        SkinCommand::Url {
            url,
            variant,
            account,
        } => {
            let target = account
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;
            let acc = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            let variant: SkinVariant = variant.parse()?;
            set_skin_url(&acc.minecraft.access_token, &url, variant)?;
            println!("set skin from URL for {}", acc.username);
        }
        SkinCommand::Reset { account } => {
            let target = account
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;
            let acc = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            reset_skin(&acc.minecraft.access_token)?;
            println!("reset skin for {}", acc.username);
        }
        SkinCommand::Check { account, save } => {
            let target = account
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;
            let acc = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            let profile = get_mc_profile(&acc.minecraft.access_token).ok();
            let skin_url = profile
                .as_ref()
                .and_then(get_active_skin)
                .map(|skin| skin.url.clone())
                .unwrap_or_else(|| get_skin_url(&acc.uuid));
            let normalized_url = normalize_texture_url(&skin_url);

            println!("account: {} ({})", acc.username, acc.uuid);
            println!("skin url: {skin_url}");
            println!("normalized: {normalized_url}");

            let client = Client::builder()
                .user_agent(format!("ShardCLI/{}", env!("CARGO_PKG_VERSION")))
                .build()?;
            let response = client
                .get(&normalized_url)
                .send()
                .with_context(|| format!("failed to GET {normalized_url}"))?;
            let status = response.status();
            let headers = response.headers().clone();
            let bytes = response.bytes()?;

            println!("status: {status}");
            if let Some(content_type) = headers.get(CONTENT_TYPE) {
                if let Ok(value) = content_type.to_str() {
                    println!("content-type: {value}");
                }
            }
            println!("bytes: {}", bytes.len());

            if let Some(path) = save {
                fs::write(&path, &bytes)
                    .with_context(|| format!("failed to write {}", path.display()))?;
                println!("saved: {}", path.display());
            }
        }
    }
    Ok(())
}

fn handle_cape_command(paths: &Paths, command: CapeCommand) -> Result<()> {
    let accounts = load_accounts(paths)?;

    match command {
        CapeCommand::List { account } => {
            let target = account
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;
            let acc = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            let profile = get_mc_profile(&acc.minecraft.access_token)?;
            if profile.capes.is_empty() {
                println!("no capes available for {}", acc.username);
            } else {
                println!("capes for {}:", acc.username);
                for cape in &profile.capes {
                    let active = cape.state == "ACTIVE";
                    let marker = if active { "*" } else { " " };
                    println!(
                        "  {marker} {} - {}",
                        cape.id,
                        cape.alias.as_deref().unwrap_or("(no alias)")
                    );
                }
            }
        }
        CapeCommand::Set { cape_id, account } => {
            let target = account
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;
            let acc = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            set_cape(&acc.minecraft.access_token, &cape_id)?;
            println!("set cape to {} for {}", cape_id, acc.username);
        }
        CapeCommand::Hide { account } => {
            let target = account
                .or_else(|| accounts.active.clone())
                .context("no account selected")?;
            let acc = accounts
                .accounts
                .iter()
                .find(|a| a.uuid == target || a.username.to_lowercase() == target.to_lowercase())
                .context("account not found")?;

            hide_cape(&acc.minecraft.access_token)?;
            println!("hidden cape for {}", acc.username);
        }
    }
    Ok(())
}

fn handle_template_command(paths: &Paths, command: TemplateCommand) -> Result<()> {
    match command {
        TemplateCommand::List => {
            init_builtin_templates(paths)?;
            let templates = list_templates(paths)?;
            if templates.is_empty() {
                println!("no templates found");
            } else {
                for id in templates {
                    if let Ok(template) = load_template(paths, &id) {
                        println!("{}\t{}", id, template.name);
                    } else {
                        println!("{}", id);
                    }
                }
            }
        }
        TemplateCommand::Show { id } => {
            init_builtin_templates(paths)?;
            let template = load_template(paths, &id)?;
            let data = serde_json::to_string_pretty(&template)?;
            println!("{data}");
        }
        TemplateCommand::Create {
            id,
            name,
            description,
            mc_version,
            loader,
        } => {
            let loader = match loader {
                Some(value) => {
                    let l = parse_loader(&value)?;
                    Some(TemplateLoader {
                        loader_type: l.loader_type,
                        version: l.version,
                    })
                }
                None => None,
            };

            let template = Template {
                id: id.clone(),
                name,
                description: description.unwrap_or_default(),
                mc_version,
                loader,
                mods: Vec::new(),
                resourcepacks: Vec::new(),
                shaderpacks: Vec::new(),
                runtime: TemplateRuntime::default(),
            };

            save_template(paths, &template)?;
            println!("created template {id}");
        }
        TemplateCommand::Import { path } => {
            let data = std::fs::read_to_string(&path)
                .with_context(|| format!("failed to read file: {}", path.display()))?;
            let template: Template =
                serde_json::from_str(&data).context("failed to parse template JSON")?;
            save_template(paths, &template)?;
            println!("imported template {}", template.id);
        }
        TemplateCommand::Export { id, path } => {
            let template = load_template(paths, &id)?;
            let data = serde_json::to_string_pretty(&template)?;
            std::fs::write(&path, data)
                .with_context(|| format!("failed to write file: {}", path.display()))?;
            println!("exported template {} to {}", id, path.display());
        }
        TemplateCommand::Delete { id } => {
            if delete_template(paths, &id)? {
                println!("deleted template {id}");
            } else {
                bail!("template not found: {id}");
            }
        }
        TemplateCommand::Init => {
            init_builtin_templates(paths)?;
            println!("initialized built-in templates");
        }
    }
    Ok(())
}

fn handle_store_command(paths: &Paths, command: StoreCommand) -> Result<()> {
    let config = load_config(paths)?;
    let store = ContentStore::new(config.curseforge_api_key.as_deref());

    match command {
        StoreCommand::Search {
            query,
            content_type,
            game_version,
            loader,
            platform,
            limit,
        } => {
            let options = SearchOptions {
                query,
                content_type: content_type.map(ContentType::from),
                game_version,
                loader,
                limit,
                offset: 0,
            };

            let results = match platform {
                Some(StorePlatform::Modrinth) => store.search_modrinth(&options)?,
                Some(StorePlatform::Curseforge) => store.search_curseforge_only(&options)?,
                None => store.search(&options)?,
            };

            if results.is_empty() {
                println!("no results found");
            } else {
                for item in results {
                    println!(
                        "[{}] {} - {} ({} downloads)",
                        item.platform, item.slug, item.name, item.downloads
                    );
                    println!("  {}", item.description);
                }
            }
        }
        StoreCommand::Info { project, platform } => {
            let item = store.get_project(platform.into(), &project)?;
            println!("Name: {}", item.name);
            println!("Slug: {}", item.slug);
            println!("Platform: {}", item.platform);
            println!("Type: {:?}", item.content_type);
            println!("Downloads: {}", item.downloads);
            println!("Description: {}", item.description);
            if !item.game_versions.is_empty() {
                println!(
                    "Game versions: {}",
                    item.game_versions[..std::cmp::min(10, item.game_versions.len())].join(", ")
                );
            }
            if !item.loaders.is_empty() {
                println!("Loaders: {}", item.loaders.join(", "));
            }
            if let Some(icon) = item.icon_url {
                println!("Icon: {}", icon);
            }
        }
        StoreCommand::Versions {
            project,
            platform,
            game_version,
            loader,
        } => {
            let versions = store.get_versions(
                platform.into(),
                &project,
                game_version.as_deref(),
                loader.as_deref(),
            )?;

            if versions.is_empty() {
                println!("no versions found");
            } else {
                for v in versions.iter().take(20) {
                    println!(
                        "{} - {} [{}] ({})",
                        v.version,
                        v.name,
                        v.release_type,
                        v.game_versions.join(", ")
                    );
                }
            }
        }
        StoreCommand::Install {
            profile,
            project,
            platform,
            version,
            content_type,
        } => {
            let mut profile_data = load_profile(paths, &profile)?;

            // Get project info to determine content type
            let item = store.get_project(platform.into(), &project)?;
            let ct = content_type.map(ContentType::from).unwrap_or(item.content_type);

            // Determine effective loader based on content type
            let effective_loader: Option<String> = match ct {
                ContentType::Mod | ContentType::ModPack => {
                    profile_data.loader.as_ref().map(|l| l.loader_type.clone())
                }
                ContentType::ShaderPack => {
                    // For shaders, detect if profile has iris/optifine installed
                    profile_data
                        .primary_shader_loader()
                        .map(|sl| sl.modrinth_name().to_string())
                }
                ContentType::ResourcePack => None,
            };

            // Get version
            let ver = if let Some(v) = version {
                let versions = store.get_versions(platform.into(), &project, None, None)?;
                versions
                    .into_iter()
                    .find(|ver| ver.version == v || ver.id == v)
                    .context("version not found")?
            } else {
                store.get_latest_version(
                    platform.into(),
                    &project,
                    Some(&profile_data.mc_version),
                    effective_loader.as_deref(),
                )?
            };

            // Download and store
            let mut content_ref = store.download_to_store(paths, &ver, ct)?;

            // Add platform/project tracking for update checking
            content_ref.platform = Some(platform.as_str().to_string());
            content_ref.project_id = Some(project.clone());
            content_ref.version_id = Some(ver.id.clone());
            content_ref.pinned = false;

            // Add to profile
            let changed = match ct {
                ContentType::Mod | ContentType::ModPack => upsert_mod(&mut profile_data, content_ref),
                ContentType::ResourcePack => upsert_resourcepack(&mut profile_data, content_ref),
                ContentType::ShaderPack => upsert_shaderpack(&mut profile_data, content_ref),
            };

            save_profile(paths, &profile_data)?;
            if changed {
                println!("installed {} to profile {}", item.name, profile);
            } else {
                println!("{} already in profile {}", item.name, profile);
            }
        }
    }
    Ok(())
}

fn handle_logs_command(paths: &Paths, command: LogsCommand) -> Result<()> {
    match command {
        LogsCommand::List { profile } => {
            let files = list_log_files(paths, &profile)?;
            if files.is_empty() {
                println!("no log files found for profile {profile}");
            } else {
                for file in files {
                    let current = if file.is_current { " (current)" } else { "" };
                    println!("{}\t{} bytes{}", file.name, file.size, current);
                }
            }
        }
        LogsCommand::Show {
            profile,
            lines,
            level,
            search,
            file,
        } => {
            let log_path = if let Some(filename) = file {
                paths.instance_logs_dir(&profile).join(filename)
            } else {
                paths.instance_latest_log(&profile)
            };

            if !log_path.exists() {
                bail!("log file not found: {}", log_path.display());
            }

            let entries = if let Some(n) = lines {
                read_log_tail(&log_path, n)?
            } else {
                read_log_file(&log_path)?
            };

            let entries: Vec<_> = if let Some(level_str) = level {
                let min_level = parse_log_level(&level_str)?;
                filter_by_level(&entries, min_level)
                    .into_iter()
                    .cloned()
                    .collect()
            } else {
                entries
            };

            let entries: Vec<_> = if let Some(query) = search {
                search_logs(&entries, &query)
                    .into_iter()
                    .cloned()
                    .collect()
            } else {
                entries
            };

            let colored = atty::is(atty::Stream::Stdout);
            for entry in entries {
                println!("{}", format_entry(&entry, colored));
            }
        }
        LogsCommand::Watch { profile, level } => {
            let log_path = paths.instance_latest_log(&profile);
            let min_level = level.map(|l| parse_log_level(&l)).transpose()?;
            let colored = atty::is(atty::Stream::Stdout);

            println!("watching logs for profile {profile} (Ctrl+C to stop)");

            let (rx, _stop) = watch_log(log_path, Duration::from_millis(100));

            while let Ok(entries) = rx.recv() {
                for entry in entries {
                    if let Some(min) = min_level
                        && level_priority(entry.level) < level_priority(min)
                    {
                        continue;
                    }
                    println!("{}", format_entry(&entry, colored));
                }
            }
        }
        LogsCommand::Crashes { profile } => {
            let files = list_crash_reports(paths, &profile)?;
            if files.is_empty() {
                println!("no crash reports found for profile {profile}");
            } else {
                for file in files {
                    println!("{}\t{} bytes", file.name, file.size);
                }
            }
        }
        LogsCommand::Crash { profile, file } => {
            let crash_dir = paths.instance_crash_reports(&profile);
            let crash_path = if let Some(filename) = file {
                crash_dir.join(filename)
            } else {
                let files = list_crash_reports(paths, &profile)?;
                files
                    .into_iter()
                    .next()
                    .map(|f| f.path)
                    .context("no crash reports found")?
            };

            if !crash_path.exists() {
                bail!("crash report not found: {}", crash_path.display());
            }

            let content = std::fs::read_to_string(&crash_path)?;
            println!("{content}");
        }
    }
    Ok(())
}

fn add_account_flow(paths: &Paths, client_id: &str, client_secret: Option<&str>) -> Result<()> {
    let device = request_device_code(client_id, client_secret)?;
    println!("{}", device.message);
    println!(
        "If your browser did not open, visit {} and enter code {}",
        device.verification_uri, device.user_code
    );

    let account = finish_device_code_flow(paths, client_id, client_secret, &device)?;
    println!("added account {}", account.username);
    Ok(())
}

fn create_profile_from_template(
    paths: &Paths,
    profile_id: &str,
    template_id: &str,
    java: Option<String>,
    memory: Option<String>,
    args: Vec<String>,
) -> Result<()> {
    let template = load_template(paths, template_id)?;

    // Create loader from template
    let loader = template.loader.map(|l| Loader {
        loader_type: l.loader_type,
        version: l.version,
    });

    // Merge runtime settings (CLI overrides template)
    let runtime = Runtime {
        java: java.or(template.runtime.java),
        memory: memory.or(template.runtime.memory),
        args: if args.is_empty() {
            template.runtime.args
        } else {
            args
        },
    };

    // Create the profile
    let mut profile =
        create_profile(paths, profile_id, &template.mc_version, loader.clone(), runtime)?;

    println!("created profile {profile_id} from template {template_id}");
    println!("downloading content from template...");

    // Download mods from template
    let store = ContentStore::modrinth_only();
    let loader_type = loader.as_ref().map(|l| l.loader_type.as_str());

    for mod_content in &template.mods {
        if !mod_content.required {
            continue;
        }
        match &mod_content.source {
            ContentSource::Modrinth { project } => {
                match store.get_latest_version(
                    Platform::Modrinth,
                    project,
                    Some(&template.mc_version),
                    loader_type,
                ) {
                    Ok(version) => {
                        match store.download_to_store(paths, &version, ContentType::Mod) {
                            Ok(content_ref) => {
                                upsert_mod(&mut profile, content_ref);
                                println!("  + {}", mod_content.name);
                            }
                            Err(e) => {
                                println!("  ! {} (download failed: {e})", mod_content.name);
                            }
                        }
                    }
                    Err(e) => {
                        println!("  ! {} (no compatible version: {e})", mod_content.name);
                    }
                }
            }
            ContentSource::Url { url } => {
                match resolve_input(paths, url) {
                    Ok((path, source, file_name)) => {
                        match store_content(paths, ContentKind::Mod, &path, source, file_name) {
                            Ok(stored) => {
                                let content_ref = ContentRef {
                                    name: mod_content.name.clone(),
                                    hash: stored.hash,
                                    version: mod_content.version.clone(),
                                    source: stored.source,
                                    file_name: Some(stored.file_name),
                                    platform: None,
                                    project_id: None,
                                    version_id: None,
                                    enabled: true,
                                    pinned: false,
                                };
                                upsert_mod(&mut profile, content_ref);
                                println!("  + {}", mod_content.name);
                            }
                            Err(e) => {
                                println!("  ! {} (download failed: {e})", mod_content.name);
                            }
                        }
                    }
                    Err(e) => {
                        println!("  ! {} (download failed: {e})", mod_content.name);
                    }
                }
            }
            ContentSource::CurseForge { .. } => {
                println!(
                    "  ! {} (CurseForge requires API key)",
                    mod_content.name
                );
            }
        }
    }

    // Download shaderpacks
    for shader in &template.shaderpacks {
        if !shader.required {
            continue;
        }
        match &shader.source {
            ContentSource::Modrinth { project } => {
                match store.get_latest_version(Platform::Modrinth, project, None, None) {
                    Ok(version) => {
                        match store.download_to_store(paths, &version, ContentType::ShaderPack) {
                            Ok(content_ref) => {
                                upsert_shaderpack(&mut profile, content_ref);
                                println!("  + {} (shader)", shader.name);
                            }
                            Err(e) => {
                                println!("  ! {} (download failed: {e})", shader.name);
                            }
                        }
                    }
                    Err(e) => {
                        println!("  ! {} (not found: {e})", shader.name);
                    }
                }
            }
            ContentSource::Url { url } => {
                match resolve_input(paths, url) {
                    Ok((path, source, file_name)) => {
                        match store_content(paths, ContentKind::ShaderPack, &path, source, file_name)
                        {
                            Ok(stored) => {
                                let content_ref = ContentRef {
                                    name: shader.name.clone(),
                                    hash: stored.hash,
                                    version: shader.version.clone(),
                                    source: stored.source,
                                    file_name: Some(stored.file_name),
                                    platform: None,
                                    project_id: None,
                                    version_id: None,
                                    enabled: true,
                                    pinned: false,
                                };
                                upsert_shaderpack(&mut profile, content_ref);
                                println!("  + {} (shader)", shader.name);
                            }
                            Err(e) => {
                                println!("  ! {} (download failed: {e})", shader.name);
                            }
                        }
                    }
                    Err(e) => {
                        println!("  ! {} (download failed: {e})", shader.name);
                    }
                }
            }
            _ => {}
        }
    }

    // Download resourcepacks
    for pack in &template.resourcepacks {
        if !pack.required {
            continue;
        }
        match &pack.source {
            ContentSource::Modrinth { project } => {
                match store.get_latest_version(Platform::Modrinth, project, None, None) {
                    Ok(version) => {
                        match store.download_to_store(paths, &version, ContentType::ResourcePack) {
                            Ok(content_ref) => {
                                upsert_resourcepack(&mut profile, content_ref);
                                println!("  + {} (resourcepack)", pack.name);
                            }
                            Err(e) => {
                                println!("  ! {} (download failed: {e})", pack.name);
                            }
                        }
                    }
                    Err(e) => {
                        println!("  ! {} (not found: {e})", pack.name);
                    }
                }
            }
            ContentSource::Url { url } => {
                match resolve_input(paths, url) {
                    Ok((path, source, file_name)) => {
                        match store_content(paths, ContentKind::ResourcePack, &path, source, file_name)
                        {
                            Ok(stored) => {
                                let content_ref = ContentRef {
                                    name: pack.name.clone(),
                                    hash: stored.hash,
                                    version: pack.version.clone(),
                                    source: stored.source,
                                    file_name: Some(stored.file_name),
                                    platform: None,
                                    project_id: None,
                                    version_id: None,
                                    enabled: true,
                                    pinned: false,
                                };
                                upsert_resourcepack(&mut profile, content_ref);
                                println!("  + {} (resourcepack)", pack.name);
                            }
                            Err(e) => {
                                println!("  ! {} (download failed: {e})", pack.name);
                            }
                        }
                    }
                    Err(e) => {
                        println!("  ! {} (download failed: {e})", pack.name);
                    }
                }
            }
            _ => {}
        }
    }

    save_profile(paths, &profile)?;
    println!("profile {profile_id} is ready!");
    Ok(())
}

fn parse_log_level(s: &str) -> Result<LogLevel> {
    match s.to_lowercase().as_str() {
        "debug" => Ok(LogLevel::Debug),
        "info" => Ok(LogLevel::Info),
        "warn" | "warning" => Ok(LogLevel::Warn),
        "error" => Ok(LogLevel::Error),
        "fatal" => Ok(LogLevel::Fatal),
        _ => bail!("invalid log level: {s}"),
    }
}

fn level_priority(level: LogLevel) -> u8 {
    match level {
        LogLevel::Debug => 0,
        LogLevel::Info => 1,
        LogLevel::Warn => 2,
        LogLevel::Error => 3,
        LogLevel::Fatal => 4,
        LogLevel::Unknown => 1,
    }
}

fn handle_library_command(paths: &Paths, command: LibraryCommand) -> Result<()> {
    let library = Library::from_paths(paths)?;

    match command {
        LibraryCommand::List {
            content_type,
            search,
            tag,
            limit,
        } => {
            let filter = LibraryFilter {
                content_type,
                search,
                tags: tag,
                limit: Some(limit),
                offset: None,
            };
            let items = library.list_items(&filter)?;
            if items.is_empty() {
                println!("no items in library");
            } else {
                for item in items {
                    let tags_str = if item.tags.is_empty() {
                        String::new()
                    } else {
                        format!(
                            " [{}]",
                            item.tags.iter().map(|t| &t.name).cloned().collect::<Vec<_>>().join(", ")
                        )
                    };
                    println!(
                        "{}\t{}\t{}{}\t{}",
                        item.id,
                        item.content_type.as_str(),
                        item.name,
                        tags_str,
                        &item.hash[..16]
                    );
                }
            }
        }
        LibraryCommand::Show { id } => {
            let item = if let Ok(id_num) = id.parse::<i64>() {
                library.get_item(id_num)?
            } else {
                library.get_item_by_hash(&id)?
            };

            match item {
                Some(item) => {
                    println!("ID: {}", item.id);
                    println!("Hash: {}", item.hash);
                    println!("Type: {}", item.content_type.label());
                    println!("Name: {}", item.name);
                    if let Some(file_name) = &item.file_name {
                        println!("File: {file_name}");
                    }
                    if let Some(size) = item.file_size {
                        println!("Size: {} bytes", size);
                    }
                    if let Some(platform) = &item.source_platform {
                        println!("Source: {platform}");
                    }
                    if let Some(url) = &item.source_url {
                        println!("URL: {url}");
                    }
                    println!("Added: {}", item.added_at);
                    println!("Updated: {}", item.updated_at);
                    if !item.tags.is_empty() {
                        println!(
                            "Tags: {}",
                            item.tags.iter().map(|t| &t.name).cloned().collect::<Vec<_>>().join(", ")
                        );
                    }
                    if !item.used_by_profiles.is_empty() {
                        println!("Used by: {}", item.used_by_profiles.join(", "));
                    }
                    if let Some(notes) = &item.notes {
                        println!("Notes: {notes}");
                    }
                }
                None => bail!("item not found: {id}"),
            }
        }
        LibraryCommand::Import {
            path,
            content_type,
            recursive,
        } => {
            let ct = LibraryContentType::from_str(&content_type)
                .context("invalid content type; use: mod, resourcepack, shaderpack, skin")?;

            if path.is_dir() {
                let result = library.import_folder(paths, &path, ct, recursive)?;
                println!(
                    "imported {} items, skipped {} (already in library)",
                    result.added, result.skipped
                );
                if !result.errors.is_empty() {
                    println!("errors:");
                    for err in result.errors {
                        println!("  {err}");
                    }
                }
            } else {
                let item = library.import_file(paths, &path, ct)?;
                println!("imported {} ({})", item.name, item.hash);
            }
        }
        LibraryCommand::Remove { id, delete_file } => {
            let item = if let Ok(id_num) = id.parse::<i64>() {
                library.get_item(id_num)?
            } else {
                library.get_item_by_hash(&id)?
            };

            match item {
                Some(item) => {
                    if delete_file {
                        // Delete from content store
                        let store_path = match item.content_type {
                            LibraryContentType::Mod => paths.store_mod_path(&item.hash),
                            LibraryContentType::ResourcePack => {
                                paths.store_resourcepack_path(&item.hash)
                            }
                            LibraryContentType::ShaderPack => paths.store_shaderpack_path(&item.hash),
                            LibraryContentType::Skin => paths.store_skin_path(&item.hash),
                        };
                        if store_path.exists() {
                            std::fs::remove_file(&store_path)?;
                            println!("deleted file from store");
                        }
                    }
                    library.delete_item(item.id)?;
                    println!("removed {} from library", item.name);
                }
                None => bail!("item not found: {id}"),
            }
        }
        LibraryCommand::Update { id, name, notes } => {
            let item = if let Ok(id_num) = id.parse::<i64>() {
                library.get_item(id_num)?
            } else {
                library.get_item_by_hash(&id)?
            };

            match item {
                Some(item) => {
                    let input = LibraryItemInput {
                        hash: item.hash,
                        name,
                        notes,
                        ..Default::default()
                    };
                    let updated = library.update_item(item.id, &input)?;
                    println!("updated {}", updated.name);
                }
                None => bail!("item not found: {id}"),
            }
        }
        LibraryCommand::Stats => {
            let stats = library.stats()?;
            println!("Library Statistics:");
            println!("  Total items: {}", stats.total_items);
            println!("  Mods: {}", stats.mods_count);
            println!("  Resource packs: {}", stats.resourcepacks_count);
            println!("  Shader packs: {}", stats.shaderpacks_count);
            println!("  Skins: {}", stats.skins_count);
            println!("  Total size: {} bytes", stats.total_size);
            println!("  Tags: {}", stats.tags_count);
        }
        LibraryCommand::Sync => {
            let result = library.sync_with_store(paths)?;
            println!(
                "synced library: {} added, {} already present",
                result.added, result.skipped
            );
            if !result.errors.is_empty() {
                println!("errors:");
                for err in result.errors {
                    println!("  {err}");
                }
            }

            // Enrich library items with metadata from profiles
            let profiles = list_profiles(paths)?;
            let mut enriched = 0;
            for profile_id in profiles {
                if let Ok(profile) = load_profile(paths, &profile_id) {
                    for content in profile.mods.iter().chain(profile.resourcepacks.iter()).chain(profile.shaderpacks.iter()) {
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
            if enriched > 0 {
                println!("enriched {} items with profile metadata", enriched);
            }
        }
        LibraryCommand::Tag { command } => handle_tag_command(&library, command)?,
    }

    Ok(())
}

fn handle_modpack_command(paths: &Paths, command: ModpackCommand) -> Result<()> {
    match command {
        ModpackCommand::Import { path, id } => {
            let profile = import_mrpack(paths, &path, id.as_deref())?;
            println!("imported modpack into profile {}", profile.id);
        }
    }
    Ok(())
}

fn handle_tag_command(library: &Library, command: TagCommand) -> Result<()> {
    match command {
        TagCommand::List => {
            let tags = library.list_tags()?;
            if tags.is_empty() {
                println!("no tags defined");
            } else {
                for tag in tags {
                    let color = tag.color.as_deref().unwrap_or("-");
                    println!("{}\t{}", tag.name, color);
                }
            }
        }
        TagCommand::Create { name, color } => {
            let tag = library.create_tag(&name, color.as_deref())?;
            println!("created tag: {}", tag.name);
        }
        TagCommand::Delete { name } => {
            if library.delete_tag_by_name(&name)? {
                println!("deleted tag: {name}");
            } else {
                bail!("tag not found: {name}");
            }
        }
        TagCommand::Add { item, tag } => {
            let library_item = if let Ok(id_num) = item.parse::<i64>() {
                library.get_item(id_num)?
            } else {
                library.get_item_by_hash(&item)?
            };

            match library_item {
                Some(library_item) => {
                    library.add_tag_to_item(library_item.id, &tag)?;
                    println!("added tag '{}' to {}", tag, library_item.name);
                }
                None => bail!("item not found: {item}"),
            }
        }
        TagCommand::Remove { item, tag } => {
            let library_item = if let Ok(id_num) = item.parse::<i64>() {
                library.get_item(id_num)?
            } else {
                library.get_item_by_hash(&item)?
            };

            match library_item {
                Some(library_item) => {
                    library.remove_tag_from_item(library_item.id, &tag)?;
                    println!("removed tag '{}' from {}", tag, library_item.name);
                }
                None => bail!("item not found: {item}"),
            }
        }
    }

    Ok(())
}
