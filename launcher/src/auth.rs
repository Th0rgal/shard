use crate::util::now_epoch_secs;
use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::thread::sleep;
use std::time::Duration;

const MS_DEVICE_CODE_URL: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub message: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
pub struct MinecraftAuth {
    pub access_token: String,
    pub expires_at: u64,
    pub uuid: String,
    pub username: String,
    pub xuid: Option<String>,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    message: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

#[derive(Serialize)]
struct XblRequest<'a> {
    #[serde(rename = "Properties")]
    properties: XblProperties<'a>,
    #[serde(rename = "RelyingParty")]
    relying_party: &'a str,
    #[serde(rename = "TokenType")]
    token_type: &'a str,
}

#[derive(Serialize)]
struct XblProperties<'a> {
    #[serde(rename = "AuthMethod")]
    auth_method: &'a str,
    #[serde(rename = "SiteName")]
    site_name: &'a str,
    #[serde(rename = "RpsTicket")]
    rps_ticket: String,
}

#[derive(Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: DisplayClaims,
}

#[derive(Deserialize)]
struct DisplayClaims {
    xui: Vec<Xui>,
}

#[derive(Deserialize)]
struct Xui {
    #[serde(default)]
    uhs: String,
    #[serde(default)]
    xid: Option<String>,
    #[serde(default)]
    xuid: Option<String>,
}

#[derive(Serialize)]
struct XstsRequest<'a> {
    #[serde(rename = "Properties")]
    properties: XstsProperties<'a>,
    #[serde(rename = "RelyingParty")]
    relying_party: &'a str,
    #[serde(rename = "TokenType")]
    token_type: &'a str,
}

#[derive(Serialize)]
struct XstsProperties<'a> {
    #[serde(rename = "SandboxId")]
    sandbox_id: &'a str,
    #[serde(rename = "UserTokens")]
    user_tokens: Vec<&'a str>,
}

#[derive(Serialize)]
struct McLoginRequest<'a> {
    #[serde(rename = "identityToken")]
    identity_token: String,
    #[serde(
        rename = "ensureLegacyEnabled",
        skip_serializing_if = "Option::is_none"
    )]
    ensure_legacy_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    platform: Option<&'a str>,
}

#[derive(Deserialize)]
struct McLoginResponse {
    access_token: String,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct McProfile {
    id: String,
    name: String,
}

pub fn request_device_code(client_id: &str, client_secret: Option<&str>) -> Result<DeviceCode> {
    let client = Client::new();
    let scope = "XboxLive.signin offline_access";
    let mut params = vec![("client_id", client_id), ("scope", scope)];
    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
    }

    let resp = client
        .post(MS_DEVICE_CODE_URL)
        .form(&params)
        .send()
        .context("failed to request device code")?;

    if !resp.status().is_success() {
        return Err(format_oauth_error("device code request failed", resp));
    }

    let data: DeviceCodeResponse = resp
        .json()
        .context("failed to parse device code response")?;
    Ok(DeviceCode {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        message: data.message,
        expires_in: data.expires_in,
        interval: data.interval,
    })
}

pub fn poll_device_code(
    client_id: &str,
    client_secret: Option<&str>,
    device: &DeviceCode,
) -> Result<OAuthToken> {
    let client = Client::new();
    let mut interval = device.interval;
    let deadline = now_epoch_secs() + device.expires_in;

    loop {
        if now_epoch_secs() >= deadline {
            bail!("device code expired; please try again");
        }

        let mut params = vec![
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", client_id),
            ("device_code", device.device_code.as_str()),
        ];
        if let Some(secret) = client_secret {
            params.push(("client_secret", secret));
        }

        let resp = client
            .post(MS_TOKEN_URL)
            .form(&params)
            .send()
            .context("failed to poll token endpoint")?;

        if resp.status().is_success() {
            let data: TokenResponse = resp.json().context("failed to parse token response")?;
            let refresh_token = data
                .refresh_token
                .context("refresh token missing; ensure offline_access scope")?;
            let expires_at = now_epoch_secs() + data.expires_in;
            return Ok(OAuthToken {
                access_token: data.access_token,
                refresh_token,
                expires_at,
            });
        }

        let err_body: Value = resp.json().unwrap_or(Value::Null);
        let error = err_body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown_error");

        match error {
            "authorization_pending" => {}
            "slow_down" => interval += 5,
            "authorization_declined" => bail!("authorization was declined"),
            "expired_token" => bail!("device code expired; please try again"),
            _ => {
                let desc = err_body
                    .get("error_description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                bail!("token polling failed: {error}: {desc}");
            }
        }

        sleep(Duration::from_secs(interval));
    }
}

pub fn refresh_msa_token(
    client_id: &str,
    client_secret: Option<&str>,
    refresh_token: &str,
) -> Result<OAuthToken> {
    let client = Client::new();
    let mut params = vec![
        ("grant_type", "refresh_token"),
        ("client_id", client_id),
        ("refresh_token", refresh_token),
    ];
    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
    }

    let resp = client
        .post(MS_TOKEN_URL)
        .form(&params)
        .send()
        .context("failed to refresh token")?;

    if !resp.status().is_success() {
        return Err(format_oauth_error("refresh failed", resp));
    }

    let data: TokenResponse = resp.json().context("failed to parse refresh response")?;
    let refresh_token = data
        .refresh_token
        .unwrap_or_else(|| refresh_token.to_string());
    let expires_at = now_epoch_secs() + data.expires_in;

    Ok(OAuthToken {
        access_token: data.access_token,
        refresh_token,
        expires_at,
    })
}

pub fn exchange_for_minecraft(ms_access_token: &str) -> Result<MinecraftAuth> {
    let (xbl_token, user_hash, xuid) = xbox_live_auth(ms_access_token)?;
    let (xsts_token, xsts_uhs, xsts_xuid) = xsts_auth(&xbl_token)?;
    let uhs = if !xsts_uhs.is_empty() {
        xsts_uhs
    } else {
        user_hash
    };
    let xuid = xsts_xuid.or(xuid);

    let mc_token = minecraft_login(&xsts_token, &uhs)?;
    let profile = minecraft_profile(&mc_token.access_token)?;

    Ok(MinecraftAuth {
        access_token: mc_token.access_token,
        expires_at: mc_token.expires_at,
        uuid: profile.id,
        username: profile.name,
        xuid,
    })
}

fn xbox_live_auth(ms_access_token: &str) -> Result<(String, String, Option<String>)> {
    let client = Client::new();
    let body = XblRequest {
        properties: XblProperties {
            auth_method: "RPS",
            site_name: "user.auth.xboxlive.com",
            rps_ticket: format!("d={ms_access_token}"),
        },
        relying_party: "http://auth.xboxlive.com",
        token_type: "JWT",
    };

    let resp = client
        .post(XBL_AUTH_URL)
        .json(&body)
        .send()
        .context("failed xbox live auth request")?;

    if !resp.status().is_success() {
        return Err(format_xbox_error("xbox live auth failed", resp));
    }

    let data: XblResponse = resp.json().context("failed to parse xbox live response")?;
    let xui = data
        .display_claims
        .xui
        .into_iter()
        .next()
        .context("missing xbox user hash")?;
    let xuid = xui.xuid.or(xui.xid);
    Ok((data.token, xui.uhs, xuid))
}

fn xsts_auth(xbl_token: &str) -> Result<(String, String, Option<String>)> {
    let client = Client::new();
    let body = XstsRequest {
        properties: XstsProperties {
            sandbox_id: "RETAIL",
            user_tokens: vec![xbl_token],
        },
        relying_party: "rp://api.minecraftservices.com/",
        token_type: "JWT",
    };

    let resp = client
        .post(XSTS_AUTH_URL)
        .json(&body)
        .send()
        .context("failed xsts auth request")?;

    if !resp.status().is_success() {
        return Err(format_xsts_error("xsts auth failed", resp));
    }

    let data: XblResponse = resp.json().context("failed to parse xsts response")?;
    let xui = data
        .display_claims
        .xui
        .into_iter()
        .next()
        .context("missing xsts user hash")?;
    let xuid = xui.xuid.or(xui.xid);
    Ok((data.token, xui.uhs, xuid))
}

fn minecraft_login(xsts_token: &str, user_hash: &str) -> Result<MinecraftToken> {
    let client = Client::new();
    let identity_token = format!("XBL3.0 x={user_hash};{xsts_token}");
    let body = McLoginRequest {
        identity_token,
        ensure_legacy_enabled: None,
        platform: None,
    };

    let resp = client
        .post(MC_LOGIN_URL)
        .json(&body)
        .send()
        .context("failed minecraft login request")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp
            .text()
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(anyhow::anyhow!("minecraft login failed: {status} {body}"));
    }

    let data: McLoginResponse = resp.json().context("failed to parse minecraft login")?;
    let expires_in = data.expires_in.unwrap_or(24 * 60 * 60);
    Ok(MinecraftToken {
        access_token: data.access_token,
        expires_at: now_epoch_secs() + expires_in,
    })
}

fn minecraft_profile(access_token: &str) -> Result<McProfile> {
    let client = Client::new();
    let resp = client
        .get(MC_PROFILE_URL)
        .bearer_auth(access_token)
        .send()
        .context("failed minecraft profile request")?
        .error_for_status()
        .context("minecraft profile request failed (does the account own Minecraft?)")?;
    let profile: McProfile = resp.json().context("failed to parse minecraft profile")?;
    Ok(profile)
}

struct MinecraftToken {
    access_token: String,
    expires_at: u64,
}

fn format_oauth_error(prefix: &str, resp: reqwest::blocking::Response) -> anyhow::Error {
    let status = resp.status();
    let body = resp.json::<Value>().unwrap_or(Value::Null);
    let error = body
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown_error");
    let desc = body
        .get("error_description")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error");
    anyhow::anyhow!("{prefix}: {status} {error}: {desc}")
}

fn format_xbox_error(prefix: &str, resp: reqwest::blocking::Response) -> anyhow::Error {
    let status = resp.status();
    let body = resp.json::<Value>().unwrap_or(Value::Null);
    let message = body
        .get("Message")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error");
    anyhow::anyhow!("{prefix}: {status} {message}")
}

fn format_xsts_error(prefix: &str, resp: reqwest::blocking::Response) -> anyhow::Error {
    let status = resp.status();
    let body = resp.json::<Value>().unwrap_or(Value::Null);
    let message = body
        .get("Message")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error");
    let xerr = body.get("XErr").and_then(|v| v.as_i64());
    let hint = match xerr {
        Some(2148916233) => Some(
            "This account has no Xbox Live account. Sign in at https://xbox.com and accept terms, then retry.",
        ),
        Some(2148916235) => Some(
            "This account is in a family or underage. Update Xbox privacy/family settings, then retry.",
        ),
        Some(2148916236) => {
            Some("This account is blocked by region. Check account region settings, then retry.")
        }
        _ => None,
    };

    if let Some(hint) = hint {
        anyhow::anyhow!("{prefix}: {status} {message} (XErr={xerr:?}). {hint}")
    } else {
        anyhow::anyhow!("{prefix}: {status} {message} (XErr={xerr:?})")
    }
}
