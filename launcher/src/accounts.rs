use crate::paths::Paths;
use crate::util::now_epoch_secs;
use anyhow::{Context, Result};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const KEYRING_SERVICE: &str = "shard";
const KEYRING_CHUNK_MAX_LEN: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Accounts {
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub accounts: Vec<Account>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub uuid: String,
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xuid: Option<String>,
    #[serde(skip_serializing)]
    pub msa: MsaTokens,
    #[serde(skip_serializing)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTokens {
    pub msa: MsaTokens,
    pub minecraft: MinecraftTokens,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredAccounts {
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub accounts: Vec<StoredAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAccount {
    pub uuid: String,
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xuid: Option<String>,
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

fn account_key(uuid: &str) -> String {
    format!("account:{uuid}")
}

fn account_chunk_meta_key(uuid: &str) -> String {
    format!("account:{uuid}:chunks")
}

fn account_chunk_key(uuid: &str, index: usize) -> String {
    format!("account:{uuid}:chunk:{index}")
}

fn keyring_entry(name: &str) -> Result<Entry> {
    Entry::new(KEYRING_SERVICE, name)
        .with_context(|| format!("failed to open keyring entry: {name}"))
}

fn store_tokens(uuid: &str, tokens: &StoredTokens) -> Result<()> {
    delete_account_tokens(uuid)?;
    let data = serde_json::to_string(tokens).context("failed to serialize account tokens")?;
    if data.len() <= KEYRING_CHUNK_MAX_LEN {
        let entry = keyring_entry(&account_key(uuid))?;
        entry
            .set_password(&data)
            .with_context(|| format!("failed to store tokens in keyring for account {uuid}"))?;
        return Ok(());
    }

    let chunks: Vec<String> = data
        .as_bytes()
        .chunks(KEYRING_CHUNK_MAX_LEN)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect();

    let meta_entry = keyring_entry(&account_chunk_meta_key(uuid))?;
    meta_entry
        .set_password(&chunks.len().to_string())
        .with_context(|| format!("failed to store token chunk metadata for account {uuid}"))?;

    for (index, chunk) in chunks.into_iter().enumerate() {
        let entry = keyring_entry(&account_chunk_key(uuid, index))?;
        entry
            .set_password(&chunk)
            .with_context(|| format!("failed to store token chunk {index} for account {uuid}"))?;
    }
    Ok(())
}

fn load_tokens(uuid: &str) -> Result<StoredTokens> {
    let entry = keyring_entry(&account_key(uuid))?;
    match entry.get_password() {
        Ok(data) => {
            return serde_json::from_str(&data)
                .with_context(|| format!("failed to parse keyring tokens for account {uuid}"));
        }
        Err(KeyringError::NoEntry) => {}
        Err(err) => {
            return Err(err)
                .with_context(|| format!("failed to read keyring tokens for account {uuid}"));
        }
    }

    let meta_entry = keyring_entry(&account_chunk_meta_key(uuid))?;
    let count = meta_entry
        .get_password()
        .with_context(|| format!("missing token chunk metadata for account {uuid}"))?;
    let count: usize = count
        .trim()
        .parse()
        .with_context(|| format!("invalid token chunk metadata for account {uuid}"))?;

    let mut data = String::new();
    for index in 0..count {
        let entry = keyring_entry(&account_chunk_key(uuid, index))?;
        let chunk = entry
            .get_password()
            .with_context(|| format!("missing token chunk {index} for account {uuid}"))?;
        data.push_str(&chunk);
    }

    serde_json::from_str(&data)
        .with_context(|| format!("failed to parse keyring tokens for account {uuid}"))
}

pub fn delete_account_tokens(id: &str) -> Result<()> {
    let entry = keyring_entry(&account_key(id))?;
    match entry.delete_password() {
        Ok(()) => {}
        Err(KeyringError::NoEntry) => {}
        Err(err) => {
            return Err(err)
                .with_context(|| format!("failed to delete keyring tokens for account {id}"));
        }
    }

    let meta_entry = keyring_entry(&account_chunk_meta_key(id))?;
    let count = match meta_entry.get_password() {
        Ok(value) => value.trim().parse::<usize>().ok(),
        Err(KeyringError::NoEntry) => None,
        Err(err) => {
            return Err(err)
                .with_context(|| format!("failed to read token chunk metadata for account {id}"));
        }
    };

    if let Some(count) = count {
        for index in 0..count {
            let entry = keyring_entry(&account_chunk_key(id, index))?;
            match entry.delete_password() {
                Ok(()) => {}
                Err(KeyringError::NoEntry) => {}
                Err(err) => {
                    return Err(err).with_context(|| {
                        format!("failed to delete token chunk {index} for account {id}")
                    });
                }
            }
        }
        match meta_entry.delete_password() {
            Ok(()) => {}
            Err(KeyringError::NoEntry) => {}
            Err(err) => {
                return Err(err).with_context(|| {
                    format!("failed to delete token chunk metadata for account {id}")
                });
            }
        }
    }
    Ok(())
}

fn read_accounts_file(paths: &Paths) -> Result<String> {
    fs::read_to_string(&paths.accounts)
        .with_context(|| format!("failed to read accounts file: {}", paths.accounts.display()))
}

fn write_accounts_file(paths: &Paths, accounts: &StoredAccounts) -> Result<()> {
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

fn to_stored_accounts(accounts: &Accounts) -> StoredAccounts {
    StoredAccounts {
        active: accounts.active.clone(),
        accounts: accounts
            .accounts
            .iter()
            .map(|account| StoredAccount {
                uuid: account.uuid.clone(),
                username: account.username.clone(),
                xuid: account.xuid.clone(),
            })
            .collect(),
    }
}

pub fn load_accounts(paths: &Paths) -> Result<Accounts> {
    if !paths.accounts.exists() {
        return Ok(Accounts::default());
    }
    let data = read_accounts_file(paths)?;
    let value: serde_json::Value = serde_json::from_str(&data).with_context(|| {
        format!(
            "failed to parse accounts JSON: {}",
            paths.accounts.display()
        )
    })?;

    let has_legacy_tokens = value
        .get("accounts")
        .and_then(|accounts| accounts.as_array())
        .map(|accounts| {
            accounts
                .iter()
                .any(|account| account.get("msa").is_some() || account.get("minecraft").is_some())
        })
        .unwrap_or(false);

    if has_legacy_tokens {
        let legacy: Accounts = serde_json::from_value(value).with_context(|| {
            format!(
                "failed to parse accounts JSON: {}",
                paths.accounts.display()
            )
        })?;

        for account in &legacy.accounts {
            let tokens = StoredTokens {
                msa: account.msa.clone(),
                minecraft: account.minecraft.clone(),
            };
            store_tokens(&account.uuid, &tokens)?;
        }
        let stored = to_stored_accounts(&legacy);
        write_accounts_file(paths, &stored)?;
        return Ok(legacy);
    }

    let stored: StoredAccounts = serde_json::from_value(value).with_context(|| {
        format!(
            "failed to parse accounts JSON: {}",
            paths.accounts.display()
        )
    })?;
    let mut accounts = Accounts {
        active: stored.active,
        accounts: Vec::with_capacity(stored.accounts.len()),
    };
    for account in stored.accounts {
        let tokens = load_tokens(&account.uuid)?;
        accounts.accounts.push(Account {
            uuid: account.uuid,
            username: account.username,
            xuid: account.xuid,
            msa: tokens.msa,
            minecraft: tokens.minecraft,
        });
    }
    Ok(accounts)
}

pub fn save_accounts(paths: &Paths, accounts: &Accounts) -> Result<()> {
    for account in &accounts.accounts {
        let tokens = StoredTokens {
            msa: account.msa.clone(),
            minecraft: account.minecraft.clone(),
        };
        store_tokens(&account.uuid, &tokens)?;
    }
    let stored = to_stored_accounts(accounts);
    write_accounts_file(paths, &stored)
}

/// Check if account matches by UUID or username (case-insensitive)
fn matches_account(account: &Account, id: &str, id_lower: &str) -> bool {
    account.uuid == id || account.username.to_lowercase() == *id_lower
}

pub fn find_account_mut<'a>(accounts: &'a mut Accounts, id: &str) -> Option<&'a mut Account> {
    let id_lower = id.to_lowercase();
    accounts
        .accounts
        .iter_mut()
        .find(|account| matches_account(account, id, &id_lower))
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
    let id_lower = id.to_lowercase();
    let removed_uuids: Vec<String> = accounts
        .accounts
        .iter()
        .filter(|account| matches_account(account, id, &id_lower))
        .map(|account| account.uuid.clone())
        .collect();

    let before = accounts.accounts.len();
    accounts
        .accounts
        .retain(|account| !removed_uuids.contains(&account.uuid));
    if let Some(active) = accounts.active.as_deref()
        && removed_uuids.iter().any(|uuid| uuid == active)
    {
        accounts.active = None;
    }
    before != accounts.accounts.len()
}

pub fn set_active(accounts: &mut Accounts, id: &str) -> bool {
    let id_lower = id.to_lowercase();
    if let Some(uuid) = accounts
        .accounts
        .iter()
        .find(|account| matches_account(account, id, &id_lower))
        .map(|account| account.uuid.clone())
    {
        accounts.active = Some(uuid);
        return true;
    }
    false
}
