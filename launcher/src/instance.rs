use crate::paths::Paths;
use crate::profile::{ContentRef, Profile};
use crate::store::{ContentKind, content_store_path};
use crate::util::{copy_dir_merge, sanitize_filename, unique_path};
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;

pub fn materialize_instance(paths: &Paths, profile: &Profile) -> Result<std::path::PathBuf> {
    let instance_dir = paths.instance_dir(&profile.id);
    fs::create_dir_all(&instance_dir)
        .with_context(|| format!("failed to create instance dir: {}", instance_dir.display()))?;

    sync_dir(&instance_dir.join("mods"))?;
    sync_dir(&instance_dir.join("resourcepacks"))?;
    sync_dir(&instance_dir.join("shaderpacks"))?;

    populate_dir(
        paths,
        &profile.mods,
        ContentKind::Mod,
        &instance_dir.join("mods"),
    )?;
    populate_dir(
        paths,
        &profile.resourcepacks,
        ContentKind::ResourcePack,
        &instance_dir.join("resourcepacks"),
    )?;
    populate_dir(
        paths,
        &profile.shaderpacks,
        ContentKind::ShaderPack,
        &instance_dir.join("shaderpacks"),
    )?;

    let overrides_dir = paths.profile_overrides(&profile.id);
    if overrides_dir.exists() {
        copy_dir_merge(&overrides_dir, &instance_dir)?;
    }

    Ok(instance_dir)
}

fn sync_dir(path: &Path) -> Result<()> {
    if path.exists() {
        fs::remove_dir_all(path)
            .with_context(|| format!("failed to remove existing directory: {}", path.display()))?;
    }
    fs::create_dir_all(path)
        .with_context(|| format!("failed to create directory: {}", path.display()))?;
    Ok(())
}

fn populate_dir(
    paths: &Paths,
    items: &[ContentRef],
    kind: ContentKind,
    target_dir: &Path,
) -> Result<()> {
    let default_ext = match kind {
        ContentKind::Mod => "jar",
        ContentKind::ResourcePack | ContentKind::ShaderPack => "zip",
        ContentKind::Skin => "png",
    };

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
        link_or_copy(&store_path, &target_path)?;
    }

    Ok(())
}

fn link_or_copy(src: &Path, dst: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        fs::copy(src, dst)
            .with_context(|| format!("failed to copy {} to {}", src.display(), dst.display()))?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        if let Err(err) = symlink_file(src, dst) {
            fs::copy(src, dst).with_context(|| {
                format!(
                    "failed to copy {} to {} after symlink error: {err}",
                    src.display(),
                    dst.display()
                )
            })?;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
fn symlink_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
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
}
