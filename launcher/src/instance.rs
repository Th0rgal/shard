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

#[cfg(unix)]
fn symlink_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

#[cfg(windows)]
fn symlink_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(src, dst)
}
