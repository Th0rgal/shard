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

/// Compare two Minecraft version strings.
/// Returns: -1 if a < b, 0 if a == b, 1 if a > b
fn compare_mc_versions(a: &str, b: &str) -> i32 {
    let parse = |s: &str| -> (u32, u32, u32) {
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
