use crate::accounts::{
    Account, MinecraftTokens, MsaTokens, find_account_mut, load_accounts, save_accounts, upsert_account,
};
use crate::auth::{DeviceCode, exchange_for_minecraft, poll_device_code, refresh_msa_token};
use crate::config::load_config;
use crate::minecraft::LaunchAccount;
use crate::paths::Paths;
use crate::profile::Loader;
use crate::store::store_from_url;
use anyhow::{Context, Result};
use std::path::PathBuf;

pub fn parse_loader(value: &str) -> Result<Loader> {
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

pub fn resolve_input(paths: &Paths, input: &str) -> Result<(PathBuf, Option<String>, Option<String>)> {
    if input.starts_with("http://") || input.starts_with("https://") {
        let (download_path, file_name) = store_from_url(paths, input)?;
        Ok((download_path, Some(input.to_string()), Some(file_name)))
    } else {
        let path = expand_tilde(input)?;
        Ok((path, None, None))
    }
}

pub fn expand_tilde(input: &str) -> Result<PathBuf> {
    if let Some(stripped) = input.strip_prefix("~/") {
        let home = dirs::home_dir().context("could not determine home directory")?;
        Ok(home.join(stripped))
    } else {
        Ok(PathBuf::from(input))
    }
}

pub fn finish_device_code_flow(
    paths: &Paths,
    client_id: &str,
    client_secret: Option<&str>,
    device: &DeviceCode,
) -> Result<Account> {
    let token = poll_device_code(client_id, client_secret, device)?;
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
    upsert_account(&mut accounts, account.clone());
    save_accounts(paths, &accounts)?;

    Ok(account)
}

pub fn resolve_launch_account(paths: &Paths, account_id: Option<String>) -> Result<LaunchAccount> {
    let config = load_config(paths)?;
    let client_id = config.msa_client_id.context(
        "missing Microsoft client id; set SHARD_MS_CLIENT_ID or shard config set-client-id",
    )?;
    let client_secret = config.msa_client_secret.as_deref();

    let mut accounts = load_accounts(paths)?;
    let target = account_id
        .or_else(|| accounts.active.clone())
        .context("no account selected; use shard account add or shard account use")?;

    // Refresh MSA token if expired, saving immediately to preserve the new refresh token
    // in case the subsequent Minecraft exchange fails
    {
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
    }
    save_accounts(paths, &accounts)?;

    // Refresh Minecraft token if expired
    let (updated_account, old_uuid) = {
        let account = find_account_mut(&mut accounts, &target)
            .with_context(|| format!("account not found: {target}"))?;

        let old_uuid = account.uuid.clone();
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

        (account.clone(), old_uuid)
    };

    // Update active account reference if UUID changed or not set
    if accounts.active.is_none() || accounts.active.as_deref() == Some(&old_uuid) {
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
