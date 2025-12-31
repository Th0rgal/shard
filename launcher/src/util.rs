use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

pub fn copy_dir_all(src: &Path, dst: &Path) -> Result<()> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst).with_context(|| format!("failed to create dir: {}", dst.display()))?;
    for entry in
        fs::read_dir(src).with_context(|| format!("failed to read dir: {}", src.display()))?
    {
        let entry = entry.context("failed to read dir entry")?;
        let file_type = entry.file_type().context("failed to read entry type")?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to).with_context(|| {
                format!("failed to copy {} to {}", from.display(), to.display())
            })?;
        }
    }
    Ok(())
}

pub fn copy_dir_merge(src: &Path, dst: &Path) -> Result<()> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst).with_context(|| format!("failed to create dir: {}", dst.display()))?;
    for entry in
        fs::read_dir(src).with_context(|| format!("failed to read dir: {}", src.display()))?
    {
        let entry = entry.context("failed to read dir entry")?;
        let file_type = entry.file_type().context("failed to read entry type")?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_merge(&from, &to)?;
        } else if !to.exists() {
            fs::copy(&from, &to).with_context(|| {
                format!("failed to copy {} to {}", from.display(), to.display())
            })?;
        }
    }
    Ok(())
}

pub fn sanitize_filename(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch == '/' || ch == '\\' || ch == '\0' {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    if out.is_empty() {
        "file".to_string()
    } else {
        out
    }
}

pub fn unique_path(base_dir: &Path, file_name: &str) -> PathBuf {
    let mut candidate = base_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let ext = Path::new(file_name).extension().and_then(|s| s.to_str());
    for idx in 1..1000 {
        let mut name = format!("{}-{}", stem, idx);
        if let Some(ext) = ext {
            name.push('.');
            name.push_str(ext);
        }
        candidate = base_dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
    }
    base_dir.join(file_name)
}

pub fn normalize_path_separator(input: &str) -> String {
    input.replace('\\', "/")
}

pub fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
