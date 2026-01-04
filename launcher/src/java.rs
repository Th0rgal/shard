//! Java installation detection and validation.
//!
//! Provides utilities to detect installed Java runtimes across macOS, Windows, and Linux,
//! validate Java paths, parse version information, and check Minecraft version compatibility.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Information about a detected Java installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstallation {
    /// Absolute path to the java executable.
    pub path: String,
    /// Full version string (e.g., "17.0.2").
    pub version: Option<String>,
    /// Major version number (e.g., 17).
    pub major: Option<u32>,
    /// Vendor/distribution name if detected.
    pub vendor: Option<String>,
    /// Architecture (e.g., "aarch64", "x86_64").
    pub arch: Option<String>,
    /// Whether this installation was validated (executable runs successfully).
    pub is_valid: bool,
}

/// Result of validating a Java path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaValidation {
    pub is_valid: bool,
    pub version: Option<String>,
    pub major: Option<u32>,
    pub vendor: Option<String>,
    pub arch: Option<String>,
    pub error: Option<String>,
}

/// Minimum Java version required for each Minecraft version range.
#[derive(Debug, Clone, Copy)]
pub struct JavaRequirement {
    pub mc_version_min: &'static str,
    pub java_major: u32,
}

/// Known Minecraft version to Java requirements.
/// Listed from newest to oldest.
const MC_JAVA_REQUIREMENTS: &[JavaRequirement] = &[
    JavaRequirement { mc_version_min: "1.20.5", java_major: 21 },
    JavaRequirement { mc_version_min: "1.18", java_major: 17 },
    JavaRequirement { mc_version_min: "1.17", java_major: 16 },
    JavaRequirement { mc_version_min: "1.0", java_major: 8 },
];

/// Detect all Java installations on the system.
pub fn detect_installations() -> Vec<JavaInstallation> {
    let mut installations = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    // Collect candidate paths
    let candidates = collect_java_candidates();

    for path in candidates {
        let path_str = path.to_string_lossy().to_string();
        if seen_paths.contains(&path_str) {
            continue;
        }
        seen_paths.insert(path_str.clone());

        if let Some(installation) = validate_and_create_installation(&path) {
            installations.push(installation);
        }
    }

    // Sort by major version (newest first), then by path
    installations.sort_by(|a, b| {
        match (b.major, a.major) {
            (Some(b_major), Some(a_major)) => b_major.cmp(&a_major),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.path.cmp(&b.path),
        }
    });

    installations
}

/// Validate a specific Java path and return detailed information.
pub fn validate_java_path(path: &str) -> JavaValidation {
    let path = Path::new(path);

    if !path.exists() {
        return JavaValidation {
            is_valid: false,
            version: None,
            major: None,
            vendor: None,
            arch: None,
            error: Some("Path does not exist".to_string()),
        };
    }

    match get_java_version_info(path) {
        Ok(info) => JavaValidation {
            is_valid: true,
            version: Some(info.version),
            major: Some(info.major),
            vendor: info.vendor,
            arch: info.arch,
            error: None,
        },
        Err(e) => JavaValidation {
            is_valid: false,
            version: None,
            major: None,
            vendor: None,
            arch: None,
            error: Some(e.to_string()),
        },
    }
}

/// Get the minimum required Java version for a Minecraft version.
pub fn get_required_java_version(mc_version: &str) -> u32 {
    for req in MC_JAVA_REQUIREMENTS {
        if compare_mc_versions(mc_version, req.mc_version_min) >= 0 {
            return req.java_major;
        }
    }
    8 // Default to Java 8 for unknown versions
}

/// Check if a Java version is compatible with a Minecraft version.
pub fn is_java_compatible(java_major: u32, mc_version: &str) -> bool {
    java_major >= get_required_java_version(mc_version)
}

// === Internal helpers ===

struct JavaVersionInfo {
    version: String,
    major: u32,
    vendor: Option<String>,
    arch: Option<String>,
}

fn get_java_version_info(java_path: &Path) -> Result<JavaVersionInfo> {
    let output = Command::new(java_path)
        .arg("-version")
        .output()
        .context("Failed to execute java -version")?;

    // Java prints version info to stderr
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}\n{}", stderr, stdout);

    parse_java_version_output(&combined)
}

fn parse_java_version_output(output: &str) -> Result<JavaVersionInfo> {
    let lines: Vec<&str> = output.lines().collect();

    // First line usually contains version:
    // openjdk version "17.0.2" 2022-01-18
    // java version "1.8.0_321"
    let version_line = lines.first().unwrap_or(&"");

    let version = extract_version_string(version_line)
        .context("Could not parse Java version")?;

    let major = parse_major_version(&version);

    // Try to detect vendor from output
    let vendor = detect_vendor(output);

    // Try to detect architecture
    let arch = detect_architecture(output);

    Ok(JavaVersionInfo {
        version,
        major,
        vendor,
        arch,
    })
}

fn extract_version_string(line: &str) -> Option<String> {
    // Match quoted version string: "17.0.2" or "1.8.0_321"
    if let Some(start) = line.find('"') {
        if let Some(end) = line[start + 1..].find('"') {
            return Some(line[start + 1..start + 1 + end].to_string());
        }
    }
    None
}

fn parse_major_version(version: &str) -> u32 {
    // Handle both old format (1.8.0) and new format (17.0.2)
    let parts: Vec<&str> = version.split('.').collect();

    if let Some(first) = parts.first() {
        if let Ok(n) = first.parse::<u32>() {
            // Old format: 1.8.0 -> major is 8
            if n == 1 && parts.len() > 1 {
                if let Ok(second) = parts[1].parse::<u32>() {
                    return second;
                }
            }
            // New format: 17.0.2 -> major is 17
            return n;
        }
    }
    0
}

fn detect_vendor(output: &str) -> Option<String> {
    let lower = output.to_lowercase();

    if lower.contains("temurin") || lower.contains("adoptium") {
        Some("Eclipse Temurin".to_string())
    } else if lower.contains("zulu") {
        Some("Azul Zulu".to_string())
    } else if lower.contains("corretto") {
        Some("Amazon Corretto".to_string())
    } else if lower.contains("graalvm") {
        Some("GraalVM".to_string())
    } else if lower.contains("microsoft") {
        Some("Microsoft".to_string())
    } else if lower.contains("openjdk") {
        Some("OpenJDK".to_string())
    } else if lower.contains("oracle") || lower.contains("java(tm)") {
        Some("Oracle".to_string())
    } else {
        None
    }
}

fn detect_architecture(output: &str) -> Option<String> {
    let lower = output.to_lowercase();

    if lower.contains("aarch64") || lower.contains("arm64") {
        Some("aarch64".to_string())
    } else if lower.contains("x86_64") || lower.contains("amd64") {
        Some("x86_64".to_string())
    } else if lower.contains("x86") || lower.contains("i386") || lower.contains("i686") {
        Some("x86".to_string())
    } else {
        None
    }
}

fn validate_and_create_installation(path: &Path) -> Option<JavaInstallation> {
    if !path.exists() {
        return None;
    }

    match get_java_version_info(path) {
        Ok(info) => Some(JavaInstallation {
            path: path.to_string_lossy().to_string(),
            version: Some(info.version),
            major: Some(info.major),
            vendor: info.vendor,
            arch: info.arch,
            is_valid: true,
        }),
        Err(_) => None,
    }
}

fn collect_java_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // Check JAVA_HOME first
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let java_bin = Path::new(&java_home).join("bin").join(java_executable_name());
        candidates.push(java_bin);
    }

    // Platform-specific locations
    #[cfg(target_os = "macos")]
    collect_macos_candidates(&mut candidates);

    #[cfg(target_os = "windows")]
    collect_windows_candidates(&mut candidates);

    #[cfg(target_os = "linux")]
    collect_linux_candidates(&mut candidates);

    // Common cross-platform locations
    collect_common_candidates(&mut candidates);

    candidates
}

fn java_executable_name() -> &'static str {
    #[cfg(target_os = "windows")]
    { "java.exe" }
    #[cfg(not(target_os = "windows"))]
    { "java" }
}

#[cfg(target_os = "macos")]
fn collect_macos_candidates(candidates: &mut Vec<PathBuf>) {
    // System Java
    candidates.push(PathBuf::from("/usr/bin/java"));

    // Standard JDK location
    let jvm_dir = Path::new("/Library/Java/JavaVirtualMachines");
    if jvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(jvm_dir) {
            for entry in entries.flatten() {
                let java_path = entry.path()
                    .join("Contents")
                    .join("Home")
                    .join("bin")
                    .join("java");
                candidates.push(java_path);
            }
        }
    }

    // Homebrew (Apple Silicon)
    let homebrew_arm = Path::new("/opt/homebrew/opt");
    if homebrew_arm.exists() {
        collect_homebrew_javas(homebrew_arm, candidates);
    }

    // Homebrew (Intel)
    let homebrew_intel = Path::new("/usr/local/opt");
    if homebrew_intel.exists() {
        collect_homebrew_javas(homebrew_intel, candidates);
    }
}

#[cfg(target_os = "macos")]
fn collect_homebrew_javas(homebrew_opt: &Path, candidates: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(homebrew_opt) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("openjdk") || name.contains("java") || name.contains("jdk") {
                let java_path = entry.path().join("bin").join("java");
                if java_path.exists() {
                    candidates.push(java_path);
                }
                // Also check libexec for some Homebrew formulas
                let libexec_path = entry.path().join("libexec").join("bin").join("java");
                if libexec_path.exists() {
                    candidates.push(libexec_path);
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_candidates(candidates: &mut Vec<PathBuf>) {
    let program_files = vec![
        std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string()),
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string()),
    ];

    let java_dirs = vec![
        "Java",
        "Eclipse Adoptium",
        "AdoptOpenJDK",
        "Microsoft",
        "Zulu",
        "Amazon Corretto",
        "BellSoft",
    ];

    for pf in &program_files {
        for java_dir in &java_dirs {
            let base = Path::new(pf).join(java_dir);
            if base.exists() {
                if let Ok(entries) = std::fs::read_dir(&base) {
                    for entry in entries.flatten() {
                        let java_path = entry.path().join("bin").join("java.exe");
                        candidates.push(java_path);
                    }
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn collect_linux_candidates(candidates: &mut Vec<PathBuf>) {
    // System Java
    candidates.push(PathBuf::from("/usr/bin/java"));

    // Standard JVM locations
    let jvm_dirs = vec![
        "/usr/lib/jvm",
        "/usr/lib64/jvm",
        "/usr/java",
    ];

    for jvm_dir in jvm_dirs {
        let dir = Path::new(jvm_dir);
        if dir.exists() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let java_path = entry.path().join("bin").join("java");
                    candidates.push(java_path);
                }
            }
        }
    }

    // Snap packages
    let snap_dir = Path::new("/snap");
    if snap_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(snap_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains("openjdk") || name.contains("java") {
                    // Snap has versioned current symlink
                    let java_path = entry.path().join("current").join("jdk").join("bin").join("java");
                    candidates.push(java_path);
                }
            }
        }
    }
}

fn collect_common_candidates(candidates: &mut Vec<PathBuf>) {
    // SDKMAN (cross-platform)
    if let Ok(home) = std::env::var("HOME") {
        let sdkman_dir = Path::new(&home).join(".sdkman").join("candidates").join("java");
        if sdkman_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&sdkman_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name != "current" {
                        let java_path = entry.path().join("bin").join(java_executable_name());
                        candidates.push(java_path);
                    }
                }
            }
            // Also add current symlink
            let current = sdkman_dir.join("current").join("bin").join(java_executable_name());
            candidates.push(current);
        }

        // asdf
        let asdf_dir = Path::new(&home).join(".asdf").join("installs").join("java");
        if asdf_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&asdf_dir) {
                for entry in entries.flatten() {
                    let java_path = entry.path().join("bin").join(java_executable_name());
                    candidates.push(java_path);
                }
            }
        }
    }
}

/// Check if a version string is a snapshot (e.g., "24w14a", "23w51b")
fn is_snapshot_version(version: &str) -> bool {
    // Snapshot format: YYwWWx where YY is year, WW is week, x is letter
    // Examples: 24w14a, 23w51b, 24w06a
    if version.len() >= 5 && version.contains('w') {
        let parts: Vec<&str> = version.split('w').collect();
        if parts.len() == 2 {
            // Check if first part is a 2-digit year
            if let Some(year) = parts[0].parse::<u32>().ok() {
                // Year should be reasonable (20-30 for 2020-2030 era snapshots)
                return year >= 11 && year <= 99;
            }
        }
    }
    false
}

/// Compare two Minecraft version strings.
/// Returns: -1 if a < b, 0 if a == b, 1 if a > b
fn compare_mc_versions(a: &str, b: &str) -> i32 {
    // Handle snapshot versions - treat them as "latest" (very high version)
    // This ensures snapshots get modern Java requirements
    let parse = |s: &str| -> (u32, u32, u32) {
        if is_snapshot_version(s) {
            // Extract year from snapshot (e.g., "24" from "24w14a")
            // Map to a high version number so it gets modern Java
            // 24wXXx -> treat as ~1.24.0 (higher than any release)
            if let Some(year) = s.split('w').next().and_then(|y| y.parse::<u32>().ok()) {
                return (1, year, 99);
            }
            // Fallback: treat as very recent version
            return (1, 99, 0);
        }

        let parts: Vec<&str> = s.split('.').collect();
        let major = parts.first().and_then(|p| p.parse().ok()).unwrap_or(0);
        let minor = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(0);
        let patch = parts.get(2).and_then(|p| p.parse().ok()).unwrap_or(0);
        (major, minor, patch)
    };

    let a_parts = parse(a);
    let b_parts = parse(b);

    match a_parts.cmp(&b_parts) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        std::cmp::Ordering::Greater => 1,
    }
}

// === Java Download from Adoptium ===

use reqwest::blocking::Client;
use serde_json::Value;
use std::fs;
use std::io::{Read as IoRead, Write};

/// Information about a downloadable Java release from Adoptium.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdoptiumRelease {
    pub version: String,
    pub major: u32,
    pub download_url: String,
    pub filename: String,
    pub size: u64,
    pub checksum: Option<String>,
}

/// Progress callback type for download operations.
pub type ProgressCallback = Box<dyn Fn(u64, u64) + Send>;

/// Get the current platform's OS identifier for Adoptium API.
fn get_adoptium_os() -> &'static str {
    #[cfg(target_os = "windows")]
    { "windows" }
    #[cfg(target_os = "macos")]
    { "mac" }
    #[cfg(target_os = "linux")]
    { "linux" }
}

/// Get the current platform's architecture for Adoptium API.
fn get_adoptium_arch() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    { "x64" }
    #[cfg(target_arch = "aarch64")]
    { "aarch64" }
    #[cfg(target_arch = "x86")]
    { "x32" }
}

/// Get the archive extension for the current platform.
fn get_archive_extension() -> &'static str {
    #[cfg(target_os = "windows")]
    { "zip" }
    #[cfg(not(target_os = "windows"))]
    { "tar.gz" }
}

/// Fetch available Java release info from Adoptium for a specific major version.
pub fn fetch_adoptium_release(java_major: u32) -> Result<AdoptiumRelease> {
    let os = get_adoptium_os();
    let arch = get_adoptium_arch();

    let url = format!(
        "https://api.adoptium.net/v3/assets/latest/{}/hotspot?architecture={}&image_type=jdk&os={}&vendor=eclipse",
        java_major, arch, os
    );

    let client = Client::builder()
        .user_agent("Shard-Launcher")
        .build()
        .context("failed to create HTTP client")?;

    let resp = client.get(&url)
        .send()
        .context("failed to fetch Adoptium release info")?
        .error_for_status()
        .context("Adoptium API returned error")?;

    let releases: Vec<Value> = resp.json()
        .context("failed to parse Adoptium response")?;

    let release = releases.first()
        .context("no releases found for this Java version")?;

    let binary = release.get("binary")
        .context("no binary info in release")?;

    let package = binary.get("package")
        .context("no package info in binary")?;

    let version_data = release.get("version")
        .context("no version info in release")?;

    let semver = version_data.get("semver")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    let download_url = package.get("link")
        .and_then(|v| v.as_str())
        .context("no download link in package")?
        .to_string();

    let filename = package.get("name")
        .and_then(|v| v.as_str())
        .context("no filename in package")?
        .to_string();

    let size = package.get("size")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let checksum = package.get("checksum")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(AdoptiumRelease {
        version: semver.to_string(),
        major: java_major,
        download_url,
        filename,
        size,
        checksum,
    })
}

/// Download and install Java from Adoptium.
/// Returns the path to the java executable.
pub fn download_and_install_java(
    java_major: u32,
    install_dir: &Path,
    progress_callback: Option<ProgressCallback>,
) -> Result<PathBuf> {
    let release = fetch_adoptium_release(java_major)?;

    // Create install directory
    fs::create_dir_all(install_dir)
        .context("failed to create Java install directory")?;

    // Download the archive
    let archive_path = install_dir.join(&release.filename);
    download_file_with_progress(
        &release.download_url,
        &archive_path,
        release.size,
        progress_callback,
    )?;

    // Extract the archive
    let extracted_dir = extract_java_archive(&archive_path, install_dir)?;

    // Clean up the archive
    let _ = fs::remove_file(&archive_path);

    // Find the java executable
    let java_executable = find_java_in_extracted(&extracted_dir)?;

    Ok(java_executable)
}

/// Download a file with progress reporting.
fn download_file_with_progress(
    url: &str,
    dest: &Path,
    total_size: u64,
    progress_callback: Option<ProgressCallback>,
) -> Result<()> {
    let client = Client::builder()
        .user_agent("Shard-Launcher")
        .build()
        .context("failed to create HTTP client")?;

    let mut resp = client.get(url)
        .send()
        .context("failed to start download")?
        .error_for_status()
        .context("download failed")?;

    let mut file = fs::File::create(dest)
        .context("failed to create destination file")?;

    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = resp.read(&mut buffer)
            .context("failed to read from download stream")?;

        if bytes_read == 0 {
            break;
        }

        file.write_all(&buffer[..bytes_read])
            .context("failed to write to file")?;

        downloaded += bytes_read as u64;

        if let Some(ref callback) = progress_callback {
            callback(downloaded, total_size);
        }
    }

    Ok(())
}

/// Extract Java archive (zip on Windows, tar.gz on others).
fn extract_java_archive(archive_path: &Path, dest_dir: &Path) -> Result<PathBuf> {
    let extension = get_archive_extension();

    if extension == "zip" {
        extract_zip(archive_path, dest_dir)
    } else {
        extract_tar_gz(archive_path, dest_dir)
    }
}

/// Extract a zip archive.
#[cfg(target_os = "windows")]
fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<PathBuf> {
    let file = fs::File::open(archive_path)
        .context("failed to open zip archive")?;

    let mut archive = zip::ZipArchive::new(file)
        .context("failed to read zip archive")?;

    // Get the root directory name from the first entry
    let root_dir_name = archive.by_index(0)
        .context("zip archive is empty")?
        .name()
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .context("failed to read zip entry")?;

        let outpath = dest_dir.join(file.name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .context("failed to create directory from zip")?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)
                    .context("failed to create parent directory")?;
            }
            let mut outfile = fs::File::create(&outpath)
                .context("failed to create file from zip")?;
            std::io::copy(&mut file, &mut outfile)
                .context("failed to extract file from zip")?;
        }
    }

    Ok(dest_dir.join(root_dir_name))
}

/// Stub for non-Windows platforms (they use tar.gz).
#[cfg(not(target_os = "windows"))]
fn extract_zip(_archive_path: &Path, _dest_dir: &Path) -> Result<PathBuf> {
    anyhow::bail!("zip extraction not supported on this platform")
}

/// Extract a tar.gz archive.
#[cfg(not(target_os = "windows"))]
fn extract_tar_gz(archive_path: &Path, dest_dir: &Path) -> Result<PathBuf> {
    use std::process::Command;

    // Use system tar for simplicity and reliability
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(archive_path)
        .arg("-C")
        .arg(dest_dir)
        .status()
        .context("failed to run tar command")?;

    if !status.success() {
        anyhow::bail!("tar extraction failed");
    }

    // Find the extracted directory (should be the only new directory)
    let entries: Vec<_> = fs::read_dir(dest_dir)
        .context("failed to read install directory")?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();

    // Find the JDK directory (usually starts with "jdk" or contains version info)
    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("jdk") || name.contains("temurin") || name.contains("adoptium") {
            return Ok(entry.path());
        }
    }

    // Fallback: return first directory
    entries.first()
        .map(|e| e.path())
        .context("no directory found after extraction")
}

/// Stub for Windows (uses zip).
#[cfg(target_os = "windows")]
fn extract_tar_gz(_archive_path: &Path, _dest_dir: &Path) -> Result<PathBuf> {
    anyhow::bail!("tar.gz extraction not supported on Windows")
}

/// Find the java executable within an extracted JDK directory.
fn find_java_in_extracted(jdk_dir: &Path) -> Result<PathBuf> {
    let java_name = java_executable_name();

    // Standard location: bin/java or bin/java.exe
    let standard_path = jdk_dir.join("bin").join(java_name);
    if standard_path.exists() {
        return Ok(standard_path);
    }

    // macOS bundle: Contents/Home/bin/java
    #[cfg(target_os = "macos")]
    {
        let macos_path = jdk_dir.join("Contents").join("Home").join("bin").join(java_name);
        if macos_path.exists() {
            return Ok(macos_path);
        }
    }

    anyhow::bail!("could not find java executable in extracted JDK at {}", jdk_dir.display())
}

/// Check if a managed Java runtime for the given version exists.
pub fn get_managed_java(java_runtimes_dir: &Path, java_major: u32) -> Option<PathBuf> {
    let runtime_dir = java_runtimes_dir.join(format!("temurin-{}", java_major));

    if !runtime_dir.exists() {
        return None;
    }

    // Look for the java executable in the runtime directory
    if let Ok(entries) = fs::read_dir(&runtime_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Ok(java_path) = find_java_in_extracted(&entry.path()) {
                    // Validate that it actually works
                    if validate_java_path(&java_path.to_string_lossy()).is_valid {
                        return Some(java_path);
                    }
                }
            }
        }
    }

    None
}

/// List all managed Java runtimes.
pub fn list_managed_runtimes(java_runtimes_dir: &Path) -> Vec<JavaInstallation> {
    let mut runtimes = Vec::new();

    if let Ok(entries) = fs::read_dir(java_runtimes_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("temurin-") {
                // Look for java executable
                if let Ok(inner_entries) = fs::read_dir(entry.path()) {
                    for inner in inner_entries.flatten() {
                        if inner.path().is_dir() {
                            if let Ok(java_path) = find_java_in_extracted(&inner.path()) {
                                if let Some(installation) = validate_and_create_installation(&java_path) {
                                    runtimes.push(installation);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    runtimes
}

/// Find a compatible Java for a Minecraft version, including managed runtimes.
pub fn find_compatible_java(mc_version: &str, java_runtimes_dir: &Path) -> Option<String> {
    let required = get_required_java_version(mc_version);

    // First check for managed runtime
    if let Some(managed) = get_managed_java(java_runtimes_dir, required) {
        return Some(managed.to_string_lossy().to_string());
    }

    // Fall back to system-installed Java
    let installations = detect_installations();
    for install in &installations {
        if let Some(major) = install.major {
            if is_java_compatible(major, mc_version) {
                return Some(install.path.clone());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_major_version() {
        assert_eq!(parse_major_version("17.0.2"), 17);
        assert_eq!(parse_major_version("21.0.1"), 21);
        assert_eq!(parse_major_version("1.8.0_321"), 8);
        assert_eq!(parse_major_version("1.8.0"), 8);
        assert_eq!(parse_major_version("11.0.12"), 11);
    }

    #[test]
    fn test_get_required_java_version() {
        assert_eq!(get_required_java_version("1.20.6"), 21);
        assert_eq!(get_required_java_version("1.20.5"), 21);
        assert_eq!(get_required_java_version("1.20.4"), 17);
        assert_eq!(get_required_java_version("1.18"), 17);
        assert_eq!(get_required_java_version("1.17"), 16);
        assert_eq!(get_required_java_version("1.16.5"), 8);
        assert_eq!(get_required_java_version("1.12.2"), 8);
    }

    #[test]
    fn test_is_java_compatible() {
        assert!(is_java_compatible(21, "1.20.6"));
        assert!(is_java_compatible(21, "1.18"));
        assert!(!is_java_compatible(17, "1.20.6"));
        assert!(is_java_compatible(17, "1.20.4"));
        assert!(is_java_compatible(17, "1.18"));
        assert!(!is_java_compatible(16, "1.18"));
        assert!(is_java_compatible(16, "1.17"));
        assert!(is_java_compatible(8, "1.16.5"));
    }

    #[test]
    fn test_compare_mc_versions() {
        assert_eq!(compare_mc_versions("1.20.5", "1.20.5"), 0);
        assert_eq!(compare_mc_versions("1.20.6", "1.20.5"), 1);
        assert_eq!(compare_mc_versions("1.20.4", "1.20.5"), -1);
        assert_eq!(compare_mc_versions("1.21", "1.20.5"), 1);
        assert_eq!(compare_mc_versions("1.18", "1.17"), 1);
    }

    #[test]
    fn test_detect_vendor() {
        assert_eq!(detect_vendor("OpenJDK Runtime Environment Temurin-17.0.2+8"), Some("Eclipse Temurin".to_string()));
        assert_eq!(detect_vendor("OpenJDK Runtime Environment Zulu17.32+13-CA"), Some("Azul Zulu".to_string()));
        assert_eq!(detect_vendor("OpenJDK Runtime Environment Corretto-17.0.2.8.1"), Some("Amazon Corretto".to_string()));
        assert_eq!(detect_vendor("openjdk version \"17.0.2\""), Some("OpenJDK".to_string()));
        assert_eq!(detect_vendor("Java(TM) SE Runtime Environment"), Some("Oracle".to_string()));
    }
}
