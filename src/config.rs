use crate::paths::Paths;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub msa_client_id: Option<String>,
    #[serde(default)]
    pub msa_client_secret: Option<String>,
    #[serde(default)]
    pub curseforge_api_key: Option<String>,
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

    if let Ok(value) = std::env::var("SHARD_MS_CLIENT_ID") {
        if !value.trim().is_empty() {
            config.msa_client_id = Some(value);
        }
    } else if let Ok(value) = std::env::var("MICROSOFT_CLIENT_ID")
        && !value.trim().is_empty() {
            config.msa_client_id = Some(value);
        }

    if let Ok(value) = std::env::var("SHARD_MS_CLIENT_SECRET") {
        if !value.trim().is_empty() {
            config.msa_client_secret = Some(value);
        }
    } else if let Ok(value) = std::env::var("MICROSOFT_CLIENT_SECRET")
        && !value.trim().is_empty() {
            config.msa_client_secret = Some(value);
        }

    if let Ok(value) = std::env::var("SHARD_CURSEFORGE_API_KEY") {
        if !value.trim().is_empty() {
            config.curseforge_api_key = Some(value);
        }
    } else if let Ok(value) = std::env::var("CURSEFORGE_API_KEY")
        && !value.trim().is_empty() {
            config.curseforge_api_key = Some(value);
        }

    Ok(config)
}

pub fn save_config(paths: &Paths, config: &Config) -> Result<()> {
    if let Some(parent) = Path::new(&paths.config).parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config dir: {}", parent.display()))?;
    }
    let data = serde_json::to_string_pretty(config).context("failed to serialize config")?;
    fs::write(&paths.config, data)
        .with_context(|| format!("failed to write config: {}", paths.config.display()))?;
    Ok(())
}
