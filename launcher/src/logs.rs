//! Log management and viewing for Minecraft instances
//!
//! Handles reading logs from running and past game sessions.

use crate::paths::Paths;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

/// Log entry parsed from Minecraft log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// Timestamp string (e.g., "10:30:45")
    pub timestamp: Option<String>,
    /// Log level (INFO, WARN, ERROR, DEBUG)
    pub level: LogLevel,
    /// Logger/Thread name
    pub thread: Option<String>,
    /// Log message content
    pub message: String,
    /// Raw line from log file
    pub raw: String,
    /// Line number in log file
    pub line_number: u64,
}

/// Log level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
    #[default]
    Unknown,
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogLevel::Debug => write!(f, "DEBUG"),
            LogLevel::Info => write!(f, "INFO"),
            LogLevel::Warn => write!(f, "WARN"),
            LogLevel::Error => write!(f, "ERROR"),
            LogLevel::Fatal => write!(f, "FATAL"),
            LogLevel::Unknown => write!(f, "???"),
        }
    }
}


/// Log file information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFile {
    /// File name
    pub name: String,
    /// Full path
    pub path: PathBuf,
    /// File size in bytes
    pub size: u64,
    /// Last modified timestamp
    pub modified: u64,
    /// Whether this is the current/latest log
    pub is_current: bool,
}

/// Log session representing a game run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogSession {
    /// Profile ID
    pub profile_id: String,
    /// Log files for this session
    pub files: Vec<LogFile>,
    /// Session start time (from log file)
    pub started: Option<u64>,
}

impl Paths {
    /// Get the logs directory for a profile instance
    pub fn instance_logs_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("logs")
    }

    /// Get the current log file path for a profile instance
    pub fn instance_latest_log(&self, profile_id: &str) -> PathBuf {
        self.instance_logs_dir(profile_id).join("latest.log")
    }

    /// Get the crash reports directory for a profile instance
    pub fn instance_crash_reports(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("crash-reports")
    }
}

/// Parse a single log line into a LogEntry
pub fn parse_log_line(line: &str, line_number: u64) -> LogEntry {
    // Minecraft log format: [HH:MM:SS] [Thread/LEVEL]: Message
    // or: [HH:MM:SS] [Thread/LEVEL] [Logger]: Message

    let raw = line.to_string();

    // Try to parse the standard format
    if let Some(rest) = line.strip_prefix('[')
        && let Some(time_end) = rest.find(']') {
            let timestamp = Some(rest[..time_end].to_string());
            let after_time = &rest[time_end + 1..].trim_start();

            if let Some(rest2) = after_time.strip_prefix('[')
                && let Some(bracket_end) = rest2.find(']') {
                    let thread_level = &rest2[..bracket_end];
                    let message_start = &rest2[bracket_end + 1..];

                    // Parse thread and level
                    let (thread, level) = if let Some(slash_pos) = thread_level.rfind('/') {
                        let thread = &thread_level[..slash_pos];
                        let level_str = &thread_level[slash_pos + 1..];
                        let level = match level_str.to_uppercase().as_str() {
                            "DEBUG" => LogLevel::Debug,
                            "INFO" => LogLevel::Info,
                            "WARN" | "WARNING" => LogLevel::Warn,
                            "ERROR" => LogLevel::Error,
                            "FATAL" => LogLevel::Fatal,
                            _ => LogLevel::Unknown,
                        };
                        (Some(thread.to_string()), level)
                    } else {
                        (Some(thread_level.to_string()), LogLevel::Unknown)
                    };

                    // Get the message (skip the colon if present)
                    let message = message_start
                        .trim_start()
                        .strip_prefix(':')
                        .unwrap_or(message_start)
                        .trim_start()
                        .to_string();

                    return LogEntry {
                        timestamp,
                        level,
                        thread,
                        message,
                        raw,
                        line_number,
                    };
                }
        }

    // Fallback: treat entire line as message
    LogEntry {
        timestamp: None,
        level: LogLevel::Unknown,
        thread: None,
        message: line.to_string(),
        raw,
        line_number,
    }
}

/// Read all log entries from a file
pub fn read_log_file(path: &PathBuf) -> Result<Vec<LogEntry>> {
    let file = File::open(path)
        .with_context(|| format!("failed to open log file: {}", path.display()))?;
    let reader = BufReader::new(file);

    let entries: Vec<LogEntry> = reader
        .lines()
        .enumerate()
        .filter_map(|(i, line)| {
            line.ok().map(|l| parse_log_line(&l, i as u64 + 1))
        })
        .collect();

    Ok(entries)
}

/// Read the last N lines from a log file
pub fn read_log_tail(path: &PathBuf, lines: usize) -> Result<Vec<LogEntry>> {
    let entries = read_log_file(path)?;
    let start = entries.len().saturating_sub(lines);
    Ok(entries[start..].to_vec())
}

/// List all log files for a profile
pub fn list_log_files(paths: &Paths, profile_id: &str) -> Result<Vec<LogFile>> {
    let logs_dir = paths.instance_logs_dir(profile_id);
    let mut files = Vec::new();

    if !logs_dir.exists() {
        return Ok(files);
    }

    for entry in fs::read_dir(&logs_dir)
        .with_context(|| format!("failed to read logs dir: {}", logs_dir.display()))?
    {
        let entry = entry.context("failed to read dir entry")?;
        let path = entry.path();

        if path.is_file() {
            let name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let metadata = fs::metadata(&path).ok();
            let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = metadata
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let is_current = name == "latest.log";

            files.push(LogFile {
                name,
                path,
                size,
                modified,
                is_current,
            });
        }
    }

    // Sort by modified time, newest first
    files.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(files)
}

/// List crash reports for a profile
pub fn list_crash_reports(paths: &Paths, profile_id: &str) -> Result<Vec<LogFile>> {
    let crash_dir = paths.instance_crash_reports(profile_id);
    let mut files = Vec::new();

    if !crash_dir.exists() {
        return Ok(files);
    }

    for entry in fs::read_dir(&crash_dir)
        .with_context(|| format!("failed to read crash reports dir: {}", crash_dir.display()))?
    {
        let entry = entry.context("failed to read dir entry")?;
        let path = entry.path();

        if path.is_file() && path.extension().map(|e| e == "txt").unwrap_or(false) {
            let name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let metadata = fs::metadata(&path).ok();
            let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = metadata
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(LogFile {
                name,
                path,
                size,
                modified,
                is_current: false,
            });
        }
    }

    // Sort by modified time, newest first
    files.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(files)
}

/// Log watcher for real-time log streaming
pub struct LogWatcher {
    path: PathBuf,
    position: u64,
    line_number: u64,
}

impl LogWatcher {
    /// Create a new log watcher starting from the current end of file
    pub fn new(path: PathBuf) -> Result<Self> {
        let position = if path.exists() {
            fs::metadata(&path)
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        Ok(Self {
            path,
            position,
            line_number: 0,
        })
    }

    /// Create a new log watcher starting from the beginning
    pub fn from_start(path: PathBuf) -> Self {
        Self {
            path,
            position: 0,
            line_number: 0,
        }
    }

    /// Read new entries since last check
    pub fn read_new(&mut self) -> Result<Vec<LogEntry>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let mut file = File::open(&self.path)
            .with_context(|| format!("failed to open log file: {}", self.path.display()))?;

        // Check if file was truncated/rotated
        let current_size = file.metadata()?.len();
        if current_size < self.position {
            // File was truncated, start from beginning
            self.position = 0;
            self.line_number = 0;
        }

        // Seek to last position
        file.seek(SeekFrom::Start(self.position))?;

        let mut reader = BufReader::new(&mut file);
        let mut entries = Vec::new();

        for line in (&mut reader).lines().map_while(Result::ok) {
            self.line_number += 1;
            entries.push(parse_log_line(&line, self.line_number));
        }

        // Update position to actual file position after reading
        // This avoids race conditions if the file grew during reading
        self.position = reader.stream_position()?;

        Ok(entries)
    }
}

/// Start watching a log file and send entries through a channel
pub fn watch_log(path: PathBuf, poll_interval: Duration) -> (Receiver<Vec<LogEntry>>, Sender<()>) {
    let (tx, rx) = mpsc::channel();
    let (stop_tx, stop_rx) = mpsc::channel();

    thread::spawn(move || {
        let mut watcher = LogWatcher::from_start(path);

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // Read new entries
            if let Ok(entries) = watcher.read_new()
                && !entries.is_empty()
                    && tx.send(entries).is_err() {
                        break;
                    }

            thread::sleep(poll_interval);
        }
    });

    (rx, stop_tx)
}

/// Filter log entries by level
pub fn filter_by_level(entries: &[LogEntry], min_level: LogLevel) -> Vec<&LogEntry> {
    let min_priority = level_priority(min_level);
    entries
        .iter()
        .filter(|e| level_priority(e.level) >= min_priority)
        .collect()
}

fn level_priority(level: LogLevel) -> u8 {
    match level {
        LogLevel::Debug => 0,
        LogLevel::Info => 1,
        LogLevel::Warn => 2,
        LogLevel::Error => 3,
        LogLevel::Fatal => 4,
        LogLevel::Unknown => 1,
    }
}

/// Search log entries by message content
pub fn search_logs<'a>(entries: &'a [LogEntry], query: &str) -> Vec<&'a LogEntry> {
    let query_lower = query.to_lowercase();
    entries
        .iter()
        .filter(|e| e.message.to_lowercase().contains(&query_lower))
        .collect()
}

/// Format a log entry for display
pub fn format_entry(entry: &LogEntry, colored: bool) -> String {
    if colored {
        let level_color = match entry.level {
            LogLevel::Debug => "\x1b[90m",    // Gray
            LogLevel::Info => "\x1b[37m",     // White
            LogLevel::Warn => "\x1b[33m",     // Yellow
            LogLevel::Error => "\x1b[31m",    // Red
            LogLevel::Fatal => "\x1b[91m",    // Bright red
            LogLevel::Unknown => "\x1b[90m",  // Gray
        };
        let reset = "\x1b[0m";

        if let Some(ts) = &entry.timestamp {
            format!(
                "\x1b[90m[{}]\x1b[0m {}[{}]{} {}",
                ts,
                level_color,
                entry.level,
                reset,
                entry.message
            )
        } else {
            format!("{}{}{}", level_color, entry.message, reset)
        }
    } else if let Some(ts) = &entry.timestamp {
        format!("[{}] [{}] {}", ts, entry.level, entry.message)
    } else {
        entry.message.clone()
    }
}
