use crate::paths::Paths;
use crate::profile::{ContentRef, Profile};
use crate::store::{ContentKind, content_store_path, hash_file};
use crate::util::{copy_dir_merge, sanitize_filename, unique_path};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Name of the manifest (inside the instance dir) listing every entry shard materialized into
/// the content dirs. It is what lets shard tell its own copies (always used on Windows, and on
/// Unix when symlinking fails) apart from files the user dropped in by hand.
pub const MANAGED_MANIFEST: &str = ".shard-managed.json";

/// Content dirs that shard materializes from the profile.
const CONTENT_DIRS: &[(&str, ContentKind)] = &[
    ("mods", ContentKind::Mod),
    ("resourcepacks", ContentKind::ResourcePack),
    ("shaderpacks", ContentKind::ShaderPack),
];

#[derive(Debug, Default, Serialize, Deserialize)]
struct ManagedManifest {
    #[serde(default)]
    mods: BTreeSet<String>,
    #[serde(default)]
    resourcepacks: BTreeSet<String>,
    #[serde(default)]
    shaderpacks: BTreeSet<String>,
}

impl ManagedManifest {
    fn entries(&self, dir: &str) -> &BTreeSet<String> {
        match dir {
            "mods" => &self.mods,
            "resourcepacks" => &self.resourcepacks,
            _ => &self.shaderpacks,
        }
    }

    fn entries_mut(&mut self, dir: &str) -> &mut BTreeSet<String> {
        match dir {
            "mods" => &mut self.mods,
            "resourcepacks" => &mut self.resourcepacks,
            _ => &mut self.shaderpacks,
        }
    }
}

/// How profile content is placed into the instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinkMode {
    /// Symlink into the content store, falling back to a copy (Unix default).
    Symlink,
    /// Always copy (Windows: symlinks need elevated privileges / developer mode).
    Copy,
}

const DEFAULT_LINK_MODE: LinkMode = if cfg!(windows) {
    LinkMode::Copy
} else {
    LinkMode::Symlink
};

/// Build (or refresh) the instance directory for a profile.
///
/// Only entries shard manages are replaced in `mods/`, `resourcepacks/` and `shaderpacks/`:
/// symlinks into the content store, entries recorded in [`MANAGED_MANIFEST`], and files whose
/// bytes are already in the content store (so removing them loses nothing). Any other file the
/// user put there is left in place with a warning, never deleted.
pub fn materialize_instance(paths: &Paths, profile: &Profile) -> Result<PathBuf> {
    materialize_instance_with(paths, profile, DEFAULT_LINK_MODE)
}

fn materialize_instance_with(paths: &Paths, profile: &Profile, mode: LinkMode) -> Result<PathBuf> {
    let instance_dir = paths.instance_dir(&profile.id);
    fs::create_dir_all(&instance_dir)
        .with_context(|| format!("failed to create instance dir: {}", instance_dir.display()))?;

    let manifest_path = instance_dir.join(MANAGED_MANIFEST);
    let previous = load_manifest(&manifest_path);
    let mut manifest = ManagedManifest::default();

    for &(dir_name, kind) in CONTENT_DIRS {
        let items: &[ContentRef] = match kind {
            ContentKind::Mod => &profile.mods,
            ContentKind::ResourcePack => &profile.resourcepacks,
            _ => &profile.shaderpacks,
        };
        let target_dir = instance_dir.join(dir_name);
        clean_managed_entries(
            paths,
            &profile.id,
            kind,
            &target_dir,
            previous.entries(dir_name),
        )?;
        let created = populate_dir(paths, items, kind, &target_dir, mode)?;
        manifest.entries_mut(dir_name).extend(created);
    }

    let overrides_dir = paths.profile_overrides(&profile.id);
    if overrides_dir.exists() {
        // Overrides that land in content dirs are shard-managed too, so that removing them
        // from the profile's overrides removes them from the instance on the next launch.
        let mut before = Vec::new();
        for &(dir_name, _) in CONTENT_DIRS {
            before.push(list_names(&instance_dir.join(dir_name))?);
        }
        copy_dir_merge(&overrides_dir, &instance_dir)?;
        for (idx, &(dir_name, _)) in CONTENT_DIRS.iter().enumerate() {
            let override_names = list_names(&overrides_dir.join(dir_name))?;
            let now = list_names(&instance_dir.join(dir_name))?;
            manifest.entries_mut(dir_name).extend(
                override_names
                    .into_iter()
                    .filter(|name| now.contains(name) && !before[idx].contains(name)),
            );
        }
    }

    save_manifest(&manifest_path, &manifest)?;
    Ok(instance_dir)
}

fn load_manifest(path: &Path) -> ManagedManifest {
    fs::read_to_string(path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

fn save_manifest(path: &Path, manifest: &ManagedManifest) -> Result<()> {
    let data = serde_json::to_string_pretty(manifest)?;
    fs::write(path, data)
        .with_context(|| format!("failed to write instance manifest: {}", path.display()))
}

fn list_names(dir: &Path) -> Result<BTreeSet<String>> {
    let mut names = BTreeSet::new();
    if !dir.exists() {
        return Ok(names);
    }
    for entry in
        fs::read_dir(dir).with_context(|| format!("failed to read dir: {}", dir.display()))?
    {
        let entry = entry.context("failed to read dir entry")?;
        names.insert(entry.file_name().to_string_lossy().into_owned());
    }
    Ok(names)
}

/// Remove every shard-managed entry from `dir` (creating it if missing) and keep the rest.
fn clean_managed_entries(
    paths: &Paths,
    profile_id: &str,
    kind: ContentKind,
    dir: &Path,
    previously_managed: &BTreeSet<String>,
) -> Result<()> {
    fs::create_dir_all(dir)
        .with_context(|| format!("failed to create directory: {}", dir.display()))?;

    let store_dir = match kind {
        ContentKind::Mod => &paths.store_mods,
        ContentKind::ResourcePack => &paths.store_resourcepacks,
        ContentKind::ShaderPack => &paths.store_shaderpacks,
        ContentKind::Skin => &paths.store_skins,
    };

    for entry in
        fs::read_dir(dir).with_context(|| format!("failed to read dir: {}", dir.display()))?
    {
        let entry = entry.context("failed to read dir entry")?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = fs::symlink_metadata(&path)
            .with_context(|| format!("failed to stat {}", path.display()))?;

        let managed = if previously_managed.contains(&name) {
            true
        } else if meta.file_type().is_symlink() {
            fs::read_link(&path)
                .map(|target| is_store_path(&target, store_dir))
                .unwrap_or(false)
        } else if meta.is_file() {
            // Legacy instances have no manifest (and Windows used plain copies): a file whose
            // bytes are already in the content store can be removed without losing anything.
            // This also drops a hand-copied duplicate of a profile mod (same mod loaded twice).
            hash_file(&path)
                .map(|hash| content_store_path(paths, kind, &hash).exists())
                .unwrap_or(false)
        } else {
            false
        };

        if managed {
            remove_entry(&path, &meta)?;
        } else if meta.is_file() && !name.starts_with('.') {
            eprintln!(
                "warning: unmanaged file kept: {}; add it with `shard {} add {profile_id} <file>` \
                 to manage it",
                path.display(),
                kind.label(),
            );
        }
    }
    Ok(())
}

/// Whether a symlink target points into the content store (`.../sha256/<hash>`).
fn is_store_path(target: &Path, store_dir: &Path) -> bool {
    if target.starts_with(store_dir) {
        return true;
    }
    // The data dir may have moved since the link was made; the store layout is still
    // recognizable.
    target
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == "sha256")
}

fn remove_entry(path: &Path, meta: &fs::Metadata) -> Result<()> {
    let result = if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.with_context(|| format!("failed to remove managed entry: {}", path.display()))
}

/// Link/copy enabled items into `target_dir`; returns the names of the entries created.
fn populate_dir(
    paths: &Paths,
    items: &[ContentRef],
    kind: ContentKind,
    target_dir: &Path,
    mode: LinkMode,
) -> Result<Vec<String>> {
    let default_ext = match kind {
        ContentKind::Mod => "jar",
        ContentKind::ResourcePack | ContentKind::ShaderPack => "zip",
        ContentKind::Skin => "png",
    };

    let mut created = Vec::new();
    for item in items {
        if !item.enabled {
            continue;
        }
        let store_path = content_store_path(paths, kind, &item.hash);
        if !store_path.exists() {
            eprintln!(
                "warning: {} '{}' not found in store (hash: {}), skipping",
                kind.label(),
                item.name,
                item.hash
            );
            continue;
        }

        let file_name = item.file_name.as_deref().unwrap_or(&item.name);
        let mut file_name = sanitize_filename(file_name);
        if Path::new(&file_name).extension().is_none() {
            file_name.push('.');
            file_name.push_str(default_ext);
        }

        let target_path = unique_path(target_dir, &file_name);
        link_or_copy(&store_path, &target_path, mode)?;
        if let Some(name) = target_path.file_name() {
            created.push(name.to_string_lossy().into_owned());
        }
    }

    Ok(created)
}

fn link_or_copy(src: &Path, dst: &Path, mode: LinkMode) -> Result<()> {
    if mode == LinkMode::Symlink {
        match symlink_file(src, dst) {
            Ok(()) => return Ok(()),
            Err(err) => {
                return fs::copy(src, dst).map(|_| ()).with_context(|| {
                    format!(
                        "failed to copy {} to {} after symlink error: {err}",
                        src.display(),
                        dst.display()
                    )
                });
            }
        }
    }
    fs::copy(src, dst)
        .with_context(|| format!("failed to copy {} to {}", src.display(), dst.display()))?;
    Ok(())
}

#[cfg(not(windows))]
fn symlink_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

#[cfg(windows)]
fn symlink_file(_src: &Path, _dst: &Path) -> std::io::Result<()> {
    // Never used by default on Windows (LinkMode::Copy); symlinks need special privileges.
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "symlinks are not used on Windows",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{Files, Runtime};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_paths() -> Paths {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!("shard-instance-test-{unique}"));

        Paths {
            store_mods: base.join("store").join("mods").join("sha256"),
            store_resourcepacks: base.join("store").join("resourcepacks").join("sha256"),
            store_shaderpacks: base.join("store").join("shaderpacks").join("sha256"),
            store_skins: base.join("store").join("skins").join("sha256"),
            profiles: base.join("profiles"),
            instances: base.join("instances"),
            cache_downloads: base.join("caches").join("downloads"),
            cache_manifests: base.join("caches").join("manifests"),
            logs: base.join("logs"),
            minecraft_versions: base.join("minecraft").join("versions"),
            minecraft_libraries: base.join("minecraft").join("libraries"),
            minecraft_assets_objects: base.join("minecraft").join("assets").join("objects"),
            minecraft_assets_indexes: base.join("minecraft").join("assets").join("indexes"),
            accounts: base.join("accounts.json"),
            tokens: base.join("tokens.json"),
            secrets: base.join("secrets.json"),
            config: base.join("config.json"),
            library_db: base.join("library.db"),
            profile_organization: base.join("profile-organization.json"),
            java_runtimes: base.join("java"),
        }
    }

    fn content(name: &str, hash: &str, file_name: &str, enabled: bool) -> ContentRef {
        ContentRef {
            name: name.to_string(),
            hash: format!("sha256:{hash}"),
            version: None,
            source: None,
            file_name: Some(file_name.to_string()),
            platform: None,
            project_id: None,
            version_id: None,
            enabled,
            pinned: false,
        }
    }

    #[test]
    fn materializes_enabled_profile_content() {
        let paths = test_paths();
        paths.ensure().unwrap();
        fs::write(paths.store_mod_path("modhash"), "mod bytes").unwrap();
        fs::write(paths.store_resourcepack_path("packhash"), "pack bytes").unwrap();
        fs::write(paths.store_shaderpack_path("shaderhash"), "shader bytes").unwrap();

        let profile = Profile {
            id: "profile".to_string(),
            mc_version: "1.21.4".to_string(),
            loader: None,
            mods: vec![content("Mod", "modhash", "mod.jar", true)],
            resourcepacks: vec![content("Pack", "packhash", "pack.zip", true)],
            shaderpacks: vec![
                content("Shader", "shaderhash", "shader.zip", true),
                content("Disabled", "missinghash", "disabled.zip", false),
            ],
            runtime: Runtime::default(),
            files: Files::default(),
        };

        let instance_dir = materialize_instance(&paths, &profile).unwrap();

        assert_eq!(
            fs::read_to_string(instance_dir.join("mods").join("mod.jar")).unwrap(),
            "mod bytes"
        );
        assert_eq!(
            fs::read_to_string(instance_dir.join("resourcepacks").join("pack.zip")).unwrap(),
            "pack bytes"
        );
        assert_eq!(
            fs::read_to_string(instance_dir.join("shaderpacks").join("shader.zip")).unwrap(),
            "shader bytes"
        );
        assert!(
            !instance_dir
                .join("shaderpacks")
                .join("disabled.zip")
                .exists()
        );

        let _ = fs::remove_dir_all(paths.instances.parent().unwrap());
    }

    /// Put `bytes` in the mod store under their real sha256 and return a profile ref to it.
    fn store_mod(paths: &Paths, file_name: &str, bytes: &str, enabled: bool) -> ContentRef {
        use sha2::{Digest, Sha256};
        let hash = hex::encode(Sha256::digest(bytes.as_bytes()));
        fs::write(paths.store_mod_path(&hash), bytes).unwrap();
        content(file_name, &hash, file_name, enabled)
    }

    fn mod_profile(mods: Vec<ContentRef>) -> Profile {
        Profile {
            id: "profile".to_string(),
            mc_version: "26.3".to_string(),
            loader: None,
            mods,
            resourcepacks: Vec::new(),
            shaderpacks: Vec::new(),
            runtime: Runtime::default(),
            files: Files::default(),
        }
    }

    fn cleanup(paths: &Paths) {
        let _ = fs::remove_dir_all(paths.instances.parent().unwrap());
    }

    fn check_unmanaged_preserved_and_removed_mod_dropped(mode: LinkMode) {
        let paths = test_paths();
        paths.ensure().unwrap();
        let keep = store_mod(&paths, "keep.jar", "keep bytes", true);
        let drop = store_mod(&paths, "drop.jar", "drop bytes", true);

        // Pre-existing instance with a hand-dropped mod and a mod-created directory.
        let mods_dir = paths.instance_dir("profile").join("mods");
        fs::create_dir_all(mods_dir.join("some-mod-data")).unwrap();
        fs::write(mods_dir.join("meteor-client.jar"), "user bytes").unwrap();
        fs::write(mods_dir.join("some-mod-data").join("cfg.txt"), "cfg").unwrap();

        let profile = mod_profile(vec![keep.clone(), drop]);
        materialize_instance_with(&paths, &profile, mode).unwrap();
        assert!(mods_dir.join("keep.jar").exists());
        assert!(mods_dir.join("drop.jar").exists());
        if mode == LinkMode::Copy {
            let meta = fs::symlink_metadata(mods_dir.join("keep.jar")).unwrap();
            assert!(meta.is_file() && !meta.file_type().is_symlink());
        }

        // Remove a mod from the profile and re-materialize.
        let profile = mod_profile(vec![keep]);
        materialize_instance_with(&paths, &profile, mode).unwrap();

        assert_eq!(
            fs::read_to_string(mods_dir.join("keep.jar")).unwrap(),
            "keep bytes"
        );
        assert!(!mods_dir.join("keep-1.jar").exists());
        assert!(fs::symlink_metadata(mods_dir.join("drop.jar")).is_err());
        assert_eq!(
            fs::read_to_string(mods_dir.join("meteor-client.jar")).unwrap(),
            "user bytes"
        );
        assert_eq!(
            fs::read_to_string(mods_dir.join("some-mod-data").join("cfg.txt")).unwrap(),
            "cfg"
        );

        let manifest = load_manifest(&paths.instance_dir("profile").join(MANAGED_MANIFEST));
        assert_eq!(
            manifest.mods.iter().map(String::as_str).collect::<Vec<_>>(),
            vec!["keep.jar"]
        );

        cleanup(&paths);
    }

    #[test]
    fn symlink_mode_preserves_unmanaged_and_removes_dropped_mod() {
        check_unmanaged_preserved_and_removed_mod_dropped(LinkMode::Symlink);
    }

    #[test]
    fn copy_mode_preserves_unmanaged_and_removes_dropped_mod() {
        // Windows materializes content as plain copies; the manifest must still mark them
        // as managed.
        check_unmanaged_preserved_and_removed_mod_dropped(LinkMode::Copy);
    }

    #[test]
    fn legacy_copies_without_manifest_are_recognized_by_hash() {
        // Instances materialized by shard <= 0.1.26 on Windows: plain copies, no manifest.
        let paths = test_paths();
        paths.ensure().unwrap();
        let old = store_mod(&paths, "old.jar", "old bytes", true);
        let current = store_mod(&paths, "current.jar", "current bytes", true);

        let mods_dir = paths.instance_dir("profile").join("mods");
        fs::create_dir_all(&mods_dir).unwrap();
        fs::write(
            mods_dir.join(old.file_name.as_deref().unwrap()),
            "old bytes",
        )
        .unwrap();
        fs::write(mods_dir.join("current.jar"), "current bytes").unwrap();
        fs::write(mods_dir.join("mine.jar"), "not in store").unwrap();

        materialize_instance_with(&paths, &mod_profile(vec![current]), LinkMode::Copy).unwrap();

        assert!(!mods_dir.join("old.jar").exists());
        assert!(mods_dir.join("current.jar").exists());
        assert!(!mods_dir.join("current-1.jar").exists());
        assert_eq!(
            fs::read_to_string(mods_dir.join("mine.jar")).unwrap(),
            "not in store"
        );

        cleanup(&paths);
    }

    #[test]
    fn disabled_mod_is_removed_from_instance() {
        let paths = test_paths();
        paths.ensure().unwrap();
        let mut item = store_mod(&paths, "toggle.jar", "toggle bytes", true);
        let mods_dir = paths.instance_dir("profile").join("mods");

        materialize_instance(&paths, &mod_profile(vec![item.clone()])).unwrap();
        assert!(mods_dir.join("toggle.jar").exists());

        item.enabled = false;
        materialize_instance(&paths, &mod_profile(vec![item])).unwrap();
        assert!(fs::symlink_metadata(mods_dir.join("toggle.jar")).is_err());

        cleanup(&paths);
    }

    #[test]
    fn overrides_in_content_dirs_are_managed() {
        let paths = test_paths();
        paths.ensure().unwrap();
        let override_mods = paths.profile_overrides("profile").join("mods");
        fs::create_dir_all(&override_mods).unwrap();
        fs::write(override_mods.join("override.jar"), "v1").unwrap();
        let mods_dir = paths.instance_dir("profile").join("mods");

        materialize_instance(&paths, &mod_profile(Vec::new())).unwrap();
        assert_eq!(
            fs::read_to_string(mods_dir.join("override.jar")).unwrap(),
            "v1"
        );

        // Updated override is re-copied; removed override disappears.
        fs::write(override_mods.join("override.jar"), "v2").unwrap();
        materialize_instance(&paths, &mod_profile(Vec::new())).unwrap();
        assert_eq!(
            fs::read_to_string(mods_dir.join("override.jar")).unwrap(),
            "v2"
        );

        fs::remove_file(override_mods.join("override.jar")).unwrap();
        materialize_instance(&paths, &mod_profile(Vec::new())).unwrap();
        assert!(!mods_dir.join("override.jar").exists());

        cleanup(&paths);
    }
}
