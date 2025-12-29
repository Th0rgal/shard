use anyhow::{Context, Result, bail};
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
const MC_SKINS_URL: &str = "https://api.minecraftservices.com/minecraft/profile/skins";
const MC_CAPES_ACTIVE_URL: &str = "https://api.minecraftservices.com/minecraft/profile/capes/active";

/// Check response status and return error with body if failed
fn check_response(resp: Response, context: &str) -> Result<()> {
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        bail!("{context} failed: {status} - {body}")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<Skin>,
    #[serde(default)]
    pub capes: Vec<Cape>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skin {
    pub id: String,
    pub state: String,
    pub url: String,
    #[serde(default)]
    pub variant: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cape {
    pub id: String,
    pub state: String,
    pub url: String,
    #[serde(default)]
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkinVariant {
    Classic,
    Slim,
}

impl Default for SkinVariant {
    fn default() -> Self {
        SkinVariant::Classic
    }
}

impl std::fmt::Display for SkinVariant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkinVariant::Classic => write!(f, "classic"),
            SkinVariant::Slim => write!(f, "slim"),
        }
    }
}

impl std::str::FromStr for SkinVariant {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "classic" | "steve" | "default" => Ok(SkinVariant::Classic),
            "slim" | "alex" => Ok(SkinVariant::Slim),
            _ => bail!("invalid skin variant: {s} (expected 'classic' or 'slim')"),
        }
    }
}

/// Fetch the full Minecraft profile including skins and capes
pub fn get_profile(access_token: &str) -> Result<MinecraftProfile> {
    let client = Client::new();
    let resp = client
        .get(MC_PROFILE_URL)
        .bearer_auth(access_token)
        .send()
        .context("failed to fetch Minecraft profile")?
        .error_for_status()
        .context("Minecraft profile request failed")?;

    let profile: MinecraftProfile = resp.json().context("failed to parse Minecraft profile")?;
    Ok(profile)
}

/// Upload a skin from a local file
pub fn upload_skin(access_token: &str, skin_path: &Path, variant: SkinVariant) -> Result<()> {
    if !skin_path.exists() {
        bail!("skin file not found: {}", skin_path.display());
    }

    let file_name = skin_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("skin.png")
        .to_string();

    let skin_data = fs::read(skin_path)
        .with_context(|| format!("failed to read skin file: {}", skin_path.display()))?;

    let client = Client::new();
    let form = reqwest::blocking::multipart::Form::new()
        .text("variant", variant.to_string())
        .part(
            "file",
            reqwest::blocking::multipart::Part::bytes(skin_data)
                .file_name(file_name)
                .mime_str("image/png")
                .context("failed to set mime type")?,
        );

    let resp = client
        .post(MC_SKINS_URL)
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .context("failed to upload skin")?;

    check_response(resp, "skin upload")
}

/// Set skin from a URL
pub fn set_skin_url(access_token: &str, url: &str, variant: SkinVariant) -> Result<()> {
    #[derive(Serialize)]
    struct SkinRequest<'a> {
        variant: &'a str,
        url: &'a str,
    }

    let client = Client::new();
    let body = SkinRequest {
        variant: match variant {
            SkinVariant::Classic => "classic",
            SkinVariant::Slim => "slim",
        },
        url,
    };

    let resp = client
        .post(MC_SKINS_URL)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .context("failed to set skin from URL")?;

    check_response(resp, "set skin from URL")
}

/// Reset skin to default (Steve/Alex based on UUID)
pub fn reset_skin(access_token: &str) -> Result<()> {
    let client = Client::new();
    let url = format!("{}/active", MC_SKINS_URL);

    let resp = client
        .delete(&url)
        .bearer_auth(access_token)
        .send()
        .context("failed to reset skin")?;

    check_response(resp, "skin reset")
}

/// Set the active cape by cape ID
pub fn set_cape(access_token: &str, cape_id: &str) -> Result<()> {
    #[derive(Serialize)]
    struct CapeRequest<'a> {
        #[serde(rename = "capeId")]
        cape_id: &'a str,
    }

    let client = Client::new();
    let body = CapeRequest { cape_id };

    let resp = client
        .put(MC_CAPES_ACTIVE_URL)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .context("failed to set cape")?;

    check_response(resp, "set cape")
}

/// Hide/remove the active cape
pub fn hide_cape(access_token: &str) -> Result<()> {
    let client = Client::new();

    let resp = client
        .delete(MC_CAPES_ACTIVE_URL)
        .bearer_auth(access_token)
        .send()
        .context("failed to hide cape")?;

    check_response(resp, "hide cape")
}

/// Get the active skin for a profile, if any
pub fn get_active_skin(profile: &MinecraftProfile) -> Option<&Skin> {
    profile.skins.iter().find(|s| s.state == "ACTIVE")
}

/// Get the active cape for a profile, if any
pub fn get_active_cape(profile: &MinecraftProfile) -> Option<&Cape> {
    profile.capes.iter().find(|c| c.state == "ACTIVE")
}

/// Normalize UUID by removing dashes
fn normalize_uuid(uuid: &str) -> String {
    uuid.chars().filter(|c| *c != '-').collect()
}

/// Get skin texture URL for rendering (works for any player by UUID)
pub fn get_skin_url(uuid: &str) -> String {
    format!("https://crafatar.com/skins/{}?overlay", normalize_uuid(uuid))
}

/// Get rendered avatar URL for a player
pub fn get_avatar_url(uuid: &str, size: u32) -> String {
    format!(
        "https://crafatar.com/avatars/{}?size={}&overlay",
        normalize_uuid(uuid),
        size
    )
}

/// Get full body render URL for a player
pub fn get_body_url(uuid: &str, size: u32) -> String {
    format!(
        "https://crafatar.com/renders/body/{}?size={}&overlay",
        normalize_uuid(uuid),
        size
    )
}

/// Get head render URL for a player (3D)
pub fn get_head_url(uuid: &str, size: u32) -> String {
    format!(
        "https://crafatar.com/renders/head/{}?size={}&overlay",
        normalize_uuid(uuid),
        size
    )
}

/// Get cape texture URL if available
pub fn get_cape_url(uuid: &str) -> String {
    format!("https://crafatar.com/capes/{}", normalize_uuid(uuid))
}
