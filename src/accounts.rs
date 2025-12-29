use crate::paths::Paths;
use crate::util::now_epoch_secs;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Accounts {
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub accounts: Vec<Account>,
}

impl Default for Accounts {
    fn default() -> Self {
        Self {
            active: None,
            accounts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub uuid: String,
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xuid: Option<String>,
    pub msa: MsaTokens,
    pub minecraft: MinecraftTokens,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsaTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftTokens {
    pub access_token: String,
    pub expires_at: u64,
}

impl MsaTokens {
    pub fn is_expired(&self) -> bool {
        now_epoch_secs() + 60 >= self.expires_at
    }
}

impl MinecraftTokens {
    pub fn is_expired(&self) -> bool {
        now_epoch_secs() + 60 >= self.expires_at
    }
}

pub fn load_accounts(paths: &Paths) -> Result<Accounts> {
    if !paths.accounts.exists() {
        return Ok(Accounts::default());
    }
    let data = fs::read_to_string(&paths.accounts)
        .with_context(|| format!("failed to read accounts file: {}", paths.accounts.display()))?;
    let accounts: Accounts = serde_json::from_str(&data).with_context(|| {
        format!(
            "failed to parse accounts JSON: {}",
            paths.accounts.display()
        )
    })?;
    Ok(accounts)
}

pub fn save_accounts(paths: &Paths, accounts: &Accounts) -> Result<()> {
    if let Some(parent) = Path::new(&paths.accounts).parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory: {}", parent.display()))?;
    }
    let data = serde_json::to_string_pretty(accounts).context("failed to serialize accounts")?;
    fs::write(&paths.accounts, data).with_context(|| {
        format!(
            "failed to write accounts file: {}",
            paths.accounts.display()
        )
    })?;
    Ok(())
}

pub fn find_account_mut<'a>(accounts: &'a mut Accounts, id: &str) -> Option<&'a mut Account> {
    let id_lower = id.to_lowercase();
    accounts
        .accounts
        .iter_mut()
        .find(|account| account.uuid == id || account.username.to_lowercase() == id_lower)
}

pub fn upsert_account(accounts: &mut Accounts, account: Account) {
    if let Some(existing) = accounts
        .accounts
        .iter_mut()
        .find(|a| a.uuid == account.uuid)
    {
        *existing = account;
    } else {
        accounts.accounts.push(account);
    }
}

pub fn remove_account(accounts: &mut Accounts, id: &str) -> bool {
    let mut removed_uuids = Vec::new();
    for account in &accounts.accounts {
        if account.uuid == id || account.username == id {
            removed_uuids.push(account.uuid.clone());
        }
    }

    let before = accounts.accounts.len();
    accounts
        .accounts
        .retain(|account| !removed_uuids.contains(&account.uuid));
    if let Some(active) = accounts.active.as_deref() {
        if removed_uuids.iter().any(|uuid| uuid == active) {
            accounts.active = None;
        }
    }
    before != accounts.accounts.len()
}

pub fn set_active(accounts: &mut Accounts, id: &str) -> bool {
    if accounts
        .accounts
        .iter()
        .any(|account| account.uuid == id || account.username == id)
    {
        let uuid = accounts
            .accounts
            .iter()
            .find(|account| account.uuid == id || account.username == id)
            .map(|account| account.uuid.clone());
        accounts.active = uuid;
        return true;
    }
    false
}
