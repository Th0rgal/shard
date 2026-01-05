use crate::paths::Paths;
use anyhow::{Context, Result};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const KEYRING_SERVICE: &str = "shard";
const MSA_CLIENT_SECRET_KEY: &str = "config:msa_client_secret";
const CURSEFORGE_API_KEY: &str = "config:curseforge_api_key";

/// Microsoft Client ID baked in at compile time (for release builds)
const BUILTIN_MS_CLIENT_ID: Option<&str> = option_env!("SHARD_MS_CLIENT_ID");

/// CurseForge API key baked in at compile time (for release builds)
const BUILTIN_CURSEFORGE_API_KEY: Option<&str> = option_env!("SHARD_CURSEFORGE_API_KEY");

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub msa_client_id: Option<String>,
    #[serde(default)]
    pub msa_client_secret: Option<String>,
    #[serde(default)]
    pub curseforge_api_key: Option<String>,
    /// Whether to automatically check for content updates on launcher start
    #[serde(default = "default_auto_update")]
    pub auto_update_enabled: bool,
}

fn default_auto_update() -> bool {
    true
}

fn keyring_entry(name: &str) -> Result<Entry> {
    Entry::new(KEYRING_SERVICE, name)
        .with_context(|| format!("failed to open keyring entry: {name}"))
}

fn load_keyring_secret(name: &str) -> Result<Option<String>> {
    let entry = keyring_entry(name)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(err).with_context(|| format!("failed to read keyring entry: {name}")),
    }
}

fn store_keyring_secret(name: &str, value: Option<&str>) -> Result<()> {
    let entry = keyring_entry(name)?;
    match value {
        Some(secret) => entry
            .set_password(secret)
            .with_context(|| format!("failed to store keyring entry: {name}"))?,
        None => match entry.delete_password() {
            Ok(()) => {}
            Err(KeyringError::NoEntry) => {}
            Err(err) => {
                return Err(err).with_context(|| format!("failed to delete keyring entry: {name}"));
            }
        },
    }
    Ok(())
}

pub fn load_config(paths: &Paths) -> Result<Config> {
    let mut config = if paths.config.exists() {
        let data = fs::read_to_string(&paths.config)
            .with_context(|| format!("failed to read config: {}", paths.config.display()))?;
        serde_json::from_str(&data)
            .with_context(|| format!("failed to parse config: {}", paths.config.display()))?
    } else {
        Config::default()
    };

    // Priority for MS Client ID:
    // 1. Config file (user override)
    // 2. Runtime env var
    // 3. Compile-time embedded value
    if config.msa_client_id.is_none() {
        if let Ok(value) = std::env::var("SHARD_MS_CLIENT_ID") {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                config.msa_client_id = Some(trimmed);
            }
        } else if let Ok(value) = std::env::var("MICROSOFT_CLIENT_ID") {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                config.msa_client_id = Some(trimmed);
            }
        } else if let Some(builtin) = BUILTIN_MS_CLIENT_ID {
            let trimmed = builtin.trim();
            if !trimmed.is_empty() {
                config.msa_client_id = Some(trimmed.to_string());
            }
        }
    }

    let mut migrate_secrets = false;
    if config.msa_client_secret.is_some() {
        store_keyring_secret(MSA_CLIENT_SECRET_KEY, config.msa_client_secret.as_deref())?;
        migrate_secrets = true;
    }
    if config.curseforge_api_key.is_some() {
        store_keyring_secret(CURSEFORGE_API_KEY, config.curseforge_api_key.as_deref())?;
        migrate_secrets = true;
    }

    // MS Client Secret (rarely used, but follow same pattern)
    if config.msa_client_secret.is_none() {
        if let Ok(value) = std::env::var("SHARD_MS_CLIENT_SECRET") {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                config.msa_client_secret = Some(trimmed);
            }
        } else if let Ok(value) = std::env::var("MICROSOFT_CLIENT_SECRET") {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                config.msa_client_secret = Some(trimmed);
            }
        } else if let Some(secret) = load_keyring_secret(MSA_CLIENT_SECRET_KEY)? {
            config.msa_client_secret = Some(secret);
        }
    }

    // Priority for CurseForge API key:
    // 1. Config file (user override)
    // 2. Runtime env var
    // 3. Compile-time embedded value
    if config.curseforge_api_key.is_none() {
        if let Ok(value) = std::env::var("SHARD_CURSEFORGE_API_KEY") {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                config.curseforge_api_key = Some(trimmed);
            }
        } else if let Ok(value) = std::env::var("CURSEFORGE_API_KEY") {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                config.curseforge_api_key = Some(trimmed);
            }
        } else if let Some(secret) = load_keyring_secret(CURSEFORGE_API_KEY)? {
            config.curseforge_api_key = Some(secret);
        } else if let Some(builtin) = BUILTIN_CURSEFORGE_API_KEY {
            let trimmed = builtin.trim();
            if !trimmed.is_empty() {
                config.curseforge_api_key = Some(trimmed.to_string());
            }
        }
    }

    if migrate_secrets {
        save_config(paths, &config)?;
    }

    Ok(config)
}

pub fn save_config(paths: &Paths, config: &Config) -> Result<()> {
    store_keyring_secret(MSA_CLIENT_SECRET_KEY, config.msa_client_secret.as_deref())?;
    store_keyring_secret(CURSEFORGE_API_KEY, config.curseforge_api_key.as_deref())?;

    if let Some(parent) = Path::new(&paths.config).parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config dir: {}", parent.display()))?;
    }
    let scrubbed = Config {
        msa_client_id: config.msa_client_id.clone(),
        msa_client_secret: None,
        curseforge_api_key: None,
        auto_update_enabled: config.auto_update_enabled,
    };
    let data = serde_json::to_string_pretty(&scrubbed).context("failed to serialize config")?;
    fs::write(&paths.config, data)
        .with_context(|| format!("failed to write config: {}", paths.config.display()))?;
    Ok(())
}
