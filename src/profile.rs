use crate::paths::Paths;
use crate::util::copy_dir_all;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    #[serde(rename = "mcVersion")]
    pub mc_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loader: Option<Loader>,
    #[serde(default)]
    pub mods: Vec<ContentRef>,
    #[serde(default)]
    pub resourcepacks: Vec<ContentRef>,
    #[serde(default)]
    pub shaderpacks: Vec<ContentRef>,
    #[serde(default)]
    pub runtime: Runtime,
    #[serde(default)]
    pub files: Files,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Loader {
    #[serde(rename = "type")]
    pub loader_type: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentRef {
    pub name: String,
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(Default)]
pub struct Runtime {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub java: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Files {
    #[serde(default = "default_overrides")]
    pub config_overrides: String,
}

fn default_overrides() -> String {
    "overrides".to_string()
}

impl Default for Files {
    fn default() -> Self {
        Self {
            config_overrides: default_overrides(),
        }
    }
}

pub fn load_profile(paths: &Paths, id: &str) -> Result<Profile> {
    let path = paths.profile_json(id);
    let data = fs::read_to_string(&path)
        .with_context(|| format!("failed to read profile file: {}", path.display()))?;
    let profile: Profile = serde_json::from_str(&data)
        .with_context(|| format!("failed to parse profile JSON: {}", path.display()))?;
    Ok(profile)
}

pub fn save_profile(paths: &Paths, profile: &Profile) -> Result<()> {
    let dir = paths.profile_dir(&profile.id);
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create profile directory: {}", dir.display()))?;
    let path = paths.profile_json(&profile.id);
    let data = serde_json::to_string_pretty(profile).context("failed to serialize profile")?;
    fs::write(&path, data)
        .with_context(|| format!("failed to write profile file: {}", path.display()))?;
    Ok(())
}

pub fn list_profiles(paths: &Paths) -> Result<Vec<String>> {
    let mut ids = Vec::new();
    if !paths.profiles.exists() {
        return Ok(ids);
    }
    for entry in fs::read_dir(&paths.profiles)
        .with_context(|| format!("failed to read profiles dir: {}", paths.profiles.display()))?
    {
        let entry = entry.context("failed to read profiles dir entry")?;
        if entry
            .file_type()
            .context("failed to read entry type")?
            .is_dir()
        {
            let name = entry.file_name().to_string_lossy().to_string();
            ids.push(name);
        }
    }
    ids.sort();
    Ok(ids)
}

pub fn create_profile(
    paths: &Paths,
    id: &str,
    mc_version: &str,
    loader: Option<Loader>,
    runtime: Runtime,
) -> Result<Profile> {
    if paths.is_profile_present(id) {
        bail!("profile already exists: {id}");
    }
    let profile = Profile {
        id: id.to_string(),
        mc_version: mc_version.to_string(),
        loader,
        mods: Vec::new(),
        resourcepacks: Vec::new(),
        shaderpacks: Vec::new(),
        runtime,
        files: Files::default(),
    };
    save_profile(paths, &profile)?;

    let overrides_dir = paths.profile_overrides(id);
    fs::create_dir_all(&overrides_dir).with_context(|| {
        format!(
            "failed to create overrides dir: {}",
            overrides_dir.display()
        )
    })?;

    Ok(profile)
}

pub fn clone_profile(paths: &Paths, src: &str, dst: &str) -> Result<Profile> {
    if paths.is_profile_present(dst) {
        bail!("profile already exists: {dst}");
    }

    let mut profile = load_profile(paths, src)
        .with_context(|| format!("failed to load source profile: {src}"))?;
    profile.id = dst.to_string();
    save_profile(paths, &profile)?;

    let src_overrides = paths.profile_overrides(src);
    let dst_overrides = paths.profile_overrides(dst);
    if src_overrides.exists() {
        copy_dir_all(&src_overrides, &dst_overrides)?;
    } else {
        fs::create_dir_all(&dst_overrides).with_context(|| {
            format!(
                "failed to create overrides dir: {}",
                dst_overrides.display()
            )
        })?;
    }

    Ok(profile)
}

fn upsert_content(list: &mut Vec<ContentRef>, new_item: ContentRef) -> bool {
    if list.iter().any(|m| m.hash == new_item.hash) {
        return false;
    }

    if let Some(existing) = list.iter_mut().find(|m| m.name == new_item.name) {
        *existing = new_item;
        return true;
    }

    list.push(new_item);
    true
}

fn remove_content(list: &mut Vec<ContentRef>, target: &str) -> bool {
    let before = list.len();
    list.retain(|m| m.name != target && m.hash != target);
    before != list.len()
}

pub fn upsert_mod(profile: &mut Profile, new_mod: ContentRef) -> bool {
    upsert_content(&mut profile.mods, new_mod)
}

pub fn upsert_resourcepack(profile: &mut Profile, new_pack: ContentRef) -> bool {
    upsert_content(&mut profile.resourcepacks, new_pack)
}

pub fn upsert_shaderpack(profile: &mut Profile, new_pack: ContentRef) -> bool {
    upsert_content(&mut profile.shaderpacks, new_pack)
}

pub fn remove_mod(profile: &mut Profile, target: &str) -> bool {
    remove_content(&mut profile.mods, target)
}

pub fn remove_resourcepack(profile: &mut Profile, target: &str) -> bool {
    remove_content(&mut profile.resourcepacks, target)
}

pub fn remove_shaderpack(profile: &mut Profile, target: &str) -> bool {
    remove_content(&mut profile.shaderpacks, target)
}

pub fn diff_profiles(a: &Profile, b: &Profile) -> (Vec<String>, Vec<String>, Vec<String>) {
    use std::collections::BTreeSet;

    let set_a: BTreeSet<String> = a.mods.iter().map(|m| m.name.clone()).collect();
    let set_b: BTreeSet<String> = b.mods.iter().map(|m| m.name.clone()).collect();

    let only_a = set_a.difference(&set_b).cloned().collect::<Vec<_>>();
    let only_b = set_b.difference(&set_a).cloned().collect::<Vec<_>>();
    let both = set_a.intersection(&set_b).cloned().collect::<Vec<_>>();

    (only_a, only_b, both)
}
