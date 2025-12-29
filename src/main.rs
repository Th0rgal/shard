mod accounts;
mod auth;
mod config;
mod instance;
mod minecraft;
mod paths;
mod profile;
mod store;
mod util;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

use accounts::{
    Account, MinecraftTokens, MsaTokens, find_account_mut, load_accounts, save_accounts,
    set_active, upsert_account,
};
use auth::{exchange_for_minecraft, poll_device_code, refresh_msa_token, request_device_code};
use config::{load_config, save_config};
use minecraft::{LaunchAccount, launch, prepare};
use paths::Paths;
use profile::{
    ContentRef, Loader, Runtime, clone_profile, create_profile, diff_profiles, list_profiles,
    load_profile, remove_mod, remove_resourcepack, remove_shaderpack, save_profile, upsert_mod,
    upsert_resourcepack, upsert_shaderpack,
};
use store::{ContentKind, store_content, store_from_url};

#[derive(Parser, Debug)]
#[command(name = "shard", version, about = "Minimal Minecraft launcher")]
struct Cli {
    #[command(subcommand)]
    command: Command,
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
    /// Configuration
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
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
    },
    /// Clone an existing profile
    Clone { src: String, dst: String },
    /// Diff two profiles by mod names
    Diff { a: String, b: String },
    /// Print a profile manifest
    Show { id: String },
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
}

#[derive(Subcommand, Debug)]
enum ConfigCommand {
    /// Show current config
    Show,
    /// Set Microsoft client id
    SetClientId { client_id: String },
    /// Set Microsoft client secret
    SetClientSecret { client_secret: String },
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
            } => {
                let loader = match loader {
                    Some(value) => Some(parse_loader(&value)?),
                    None => None,
                };
                let runtime = Runtime { java, memory, args };
                create_profile(&paths, &id, &mc_version, loader, runtime)?;
                println!("created profile {id}");
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
                let stored = store_content(&paths, ContentKind::Mod, &path, source, file_name_hint)?;
                let mod_ref = ContentRef {
                    name: name.unwrap_or(stored.name),
                    hash: stored.hash,
                    version,
                    source: stored.source,
                    file_name: Some(stored.file_name),
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
        Command::Account { command } => match command {
            AccountCommand::Add {
                client_id,
                client_secret,
            } => {
                let config = load_config(&paths)?;
                let client_id = client_id
                    .or(config.msa_client_id)
                    .context("missing Microsoft client id; set SHARD_MS_CLIENT_ID or shard config set-client-id")?;
                let secret = client_secret.or(config.msa_client_secret);
                add_account_flow(&paths, &client_id, secret.as_deref())?;
            }
            AccountCommand::List => {
                let accounts = load_accounts(&paths)?;
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
                let mut accounts = load_accounts(&paths)?;
                if set_active(&mut accounts, &id) {
                    save_accounts(&paths, &accounts)?;
                    println!("active account set to {id}");
                } else {
                    bail!("account not found: {id}");
                }
            }
            AccountCommand::Remove { id } => {
                let mut accounts = load_accounts(&paths)?;
                if accounts.accounts.is_empty() {
                    bail!("no accounts configured");
                }
                if accounts::remove_account(&mut accounts, &id) {
                    save_accounts(&paths, &accounts)?;
                    println!("removed account {id}");
                } else {
                    bail!("account not found: {id}");
                }
            }
        },
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
        },
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
            };
            let changed = match kind {
                ContentKind::ResourcePack => upsert_resourcepack(&mut profile_data, pack_ref),
                ContentKind::ShaderPack => upsert_shaderpack(&mut profile_data, pack_ref),
                ContentKind::Mod => false,
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
                ContentKind::Mod => false,
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
                ContentKind::Mod => Vec::new(),
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

fn parse_loader(value: &str) -> Result<Loader> {
    let mut parts = value.splitn(2, '@');
    let loader_type = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .context("loader type missing")?;
    let version = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .context("loader version missing (expected type@version)")?;
    Ok(Loader {
        loader_type: loader_type.to_string(),
        version: version.to_string(),
    })
}

fn resolve_input(paths: &Paths, input: &str) -> Result<(PathBuf, Option<String>, Option<String>)> {
    if input.starts_with("http://") || input.starts_with("https://") {
        let (download_path, file_name) = store_from_url(paths, input)?;
        Ok((download_path, Some(input.to_string()), Some(file_name)))
    } else {
        let path = expand_tilde(input)?;
        Ok((path, None, None))
    }
}

fn expand_tilde(input: &str) -> Result<PathBuf> {
    if let Some(stripped) = input.strip_prefix("~/") {
        let home = dirs::home_dir().context("could not determine home directory")?;
        Ok(home.join(stripped))
    } else {
        Ok(PathBuf::from(input))
    }
}

fn add_account_flow(paths: &Paths, client_id: &str, client_secret: Option<&str>) -> Result<()> {
    let device = request_device_code(client_id, client_secret)?;
    println!("{}", device.message);
    println!(
        "If your browser did not open, visit {} and enter code {}",
        device.verification_uri, device.user_code
    );

    let token = poll_device_code(client_id, client_secret, &device)?;
    let minecraft_auth = exchange_for_minecraft(&token.access_token)?;

    let account = Account {
        uuid: minecraft_auth.uuid.clone(),
        username: minecraft_auth.username.clone(),
        xuid: minecraft_auth.xuid.clone(),
        msa: MsaTokens {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_at: token.expires_at,
        },
        minecraft: MinecraftTokens {
            access_token: minecraft_auth.access_token,
            expires_at: minecraft_auth.expires_at,
        },
    };

    let mut accounts = load_accounts(paths)?;
    if accounts.active.is_none() {
        accounts.active = Some(account.uuid.clone());
    }
    upsert_account(&mut accounts, account);
    save_accounts(paths, &accounts)?;
    println!("added account {}", minecraft_auth.username);
    Ok(())
}

fn resolve_launch_account(paths: &Paths, account_id: Option<String>) -> Result<LaunchAccount> {
    let config = load_config(paths)?;
    let client_id = config.msa_client_id.context(
        "missing Microsoft client id; set SHARD_MS_CLIENT_ID or shard config set-client-id",
    )?;
    let client_secret = config.msa_client_secret.as_deref();

    let mut accounts = load_accounts(paths)?;
    let target = account_id
        .or_else(|| accounts.active.clone())
        .context("no account selected; use shard account add or shard account use")?;

    let updated_account = {
        let account = find_account_mut(&mut accounts, &target)
            .with_context(|| format!("account not found: {target}"))?;

        if account.msa.is_expired() {
            let refreshed =
                refresh_msa_token(&client_id, client_secret, &account.msa.refresh_token)?;
            account.msa = MsaTokens {
                access_token: refreshed.access_token,
                refresh_token: refreshed.refresh_token,
                expires_at: refreshed.expires_at,
            };
        }

        if account.minecraft.is_expired() {
            let minecraft_auth = exchange_for_minecraft(&account.msa.access_token)?;
            account.minecraft = MinecraftTokens {
                access_token: minecraft_auth.access_token,
                expires_at: minecraft_auth.expires_at,
            };
            account.username = minecraft_auth.username;
            account.xuid = minecraft_auth.xuid;
            account.uuid = minecraft_auth.uuid;
        }

        account.clone()
    };

    if accounts.active.is_none() {
        accounts.active = Some(updated_account.uuid.clone());
    }
    save_accounts(paths, &accounts)?;

    Ok(LaunchAccount {
        uuid: updated_account.uuid,
        username: updated_account.username,
        access_token: updated_account.minecraft.access_token,
        xuid: updated_account.xuid,
    })
}
