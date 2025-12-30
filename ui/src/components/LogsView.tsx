import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import clsx from "clsx";
import { useAppStore } from "../store";
import type { LogEntry, LogFile, LogLevel } from "../types";
import { formatFileSize, formatTimeAgo } from "../utils";

type LogTab = "latest" | "history" | "crashes";

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "var(--text-muted)",
  info: "var(--text-secondary)",
  warn: "#f4b27f",
  error: "var(--accent-danger)",
  fatal: "#ff4444",
  unknown: "var(--text-muted)",
};

// Keep max entries to avoid memory issues
const MAX_LOG_ENTRIES = 2000;

export function LogsView() {
  const { selectedProfileId, notify } = useAppStore();
  const [tab, setTab] = useState<LogTab>("latest");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [crashReports, setCrashReports] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null);
  const [filter, setFilter] = useState("");
  const [minLevel, setMinLevel] = useState<LogLevel>("info");
  const [autoScroll, setAutoScroll] = useState(true);
  const [watching, setWatching] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Load log file list
  const loadLogFiles = useCallback(async () => {
    if (!selectedProfileId) return;
    try {
      const files = await invoke<LogFile[]>("list_log_files_cmd", { profile_id: selectedProfileId });
      setLogFiles(files);
    } catch {
      setLogFiles([]);
    }
  }, [selectedProfileId]);

  // Load crash reports
  const loadCrashReports = useCallback(async () => {
    if (!selectedProfileId) return;
    try {
      const files = await invoke<LogFile[]>("list_crash_reports_cmd", { profile_id: selectedProfileId });
      setCrashReports(files);
    } catch {
      setCrashReports([]);
    }
  }, [selectedProfileId]);

  // Load a specific file
  const loadFile = useCallback(async (file: LogFile) => {
    setSelectedFile(file);
    setLoading(true);
    try {
      if (tab === "crashes") {
        const content = await invoke<string>("read_crash_report_cmd", {
          profile_id: selectedProfileId,
          file: file.name,
        });
        // Parse crash report as single entry
        setLogs([{
          timestamp: null,
          level: "error",
          thread: null,
          message: content,
          raw: content,
          line_number: 1,
        }]);
      } else {
        const entries = await invoke<LogEntry[]>("read_logs_cmd", {
          profile_id: selectedProfileId,
          file: file.name,
          lines: null,
        });
        setLogs(entries);
      }
    } catch (err) {
      notify("Failed to load file", String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId, tab, notify]);

  // Start real-time log watching
  useEffect(() => {
    if (!selectedProfileId || tab !== "latest") return;

    let cancelled = false;

    const startWatching = async () => {
      setLoading(true);
      setLogs([]);

      try {
        // Set up event listener for new log entries
        const eventName = `log-entries-${selectedProfileId}`;
        unlistenRef.current = await listen<LogEntry[]>(eventName, (event) => {
          if (cancelled) return;
          setLogs(prev => {
            const newLogs = [...prev, ...event.payload];
            // Keep only the last MAX_LOG_ENTRIES entries
            if (newLogs.length > MAX_LOG_ENTRIES) {
              return newLogs.slice(-MAX_LOG_ENTRIES);
            }
            return newLogs;
          });
        });

        // Start the watcher on the backend
        await invoke("start_log_watch", { profile_id: selectedProfileId });
        setWatching(true);
      } catch (err) {
        console.error("Failed to start log watch:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void startWatching();

    return () => {
      cancelled = true;
      setWatching(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [selectedProfileId, tab]);

  // Load history/crashes when switching tabs
  useEffect(() => {
    if (!selectedProfileId) return;

    if (tab === "history") {
      void loadLogFiles();
    } else if (tab === "crashes") {
      void loadCrashReports();
    }
  }, [selectedProfileId, tab, loadLogFiles, loadCrashReports]);

  // Auto-scroll to bottom (within the logs container only)
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      const container = logsContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Filter logs
  const filteredLogs = logs.filter((entry) => {
    // Level filter
    const levelPriority: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      fatal: 4,
      unknown: 1,
    };
    if (levelPriority[entry.level] < levelPriority[minLevel]) return false;

    // Text filter
    if (filter && !entry.message.toLowerCase().includes(filter.toLowerCase())) return false;

    return true;
  });


  if (!selectedProfileId) {
    return (
      <div className="view-transition">
        <div className="empty-state">
          <h3>No profile selected</h3>
          <p>Select a profile to view its logs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-transition" style={{ overflow: "hidden" }}>
      {/* Tabs */}
      <div className="content-tabs" style={{ marginBottom: 12, flexShrink: 0 }}>
        <button
          className={clsx("content-tab", tab === "latest" && "active")}
          onClick={() => { setTab("latest"); setSelectedFile(null); }}
        >
          Latest
        </button>
        <button
          className={clsx("content-tab", tab === "history" && "active")}
          onClick={() => { setTab("history"); setSelectedFile(null); }}
        >
          History
          {logFiles.length > 0 && <span className="count">{logFiles.length}</span>}
        </button>
        <button
          className={clsx("content-tab", tab === "crashes" && "active")}
          onClick={() => { setTab("crashes"); setSelectedFile(null); }}
        >
          Crashes
          {crashReports.length > 0 && (
            <span className="count" style={{ background: "rgba(248, 113, 113, 0.2)", color: "var(--accent-danger)" }}>
              {crashReports.length}
            </span>
          )}
        </button>
      </div>

      {/* File list for history/crashes */}
      {(tab === "history" || tab === "crashes") && !selectedFile && (
        <div>
          {((tab === "history" ? logFiles : crashReports).length === 0) && (
            <div className="empty-state" style={{ padding: 40 }}>
              <h3>No {tab === "history" ? "log files" : "crash reports"}</h3>
              <p>
                {tab === "history"
                  ? "Log files appear after you launch the game."
                  : "Crash reports appear when the game encounters an error."}
              </p>
            </div>
          )}

          {(tab === "history" ? logFiles : crashReports).map((file) => (
            <div
              key={file.name}
              className="content-item"
              onClick={() => loadFile(file)}
              style={{ cursor: "pointer" }}
            >
              <div className="content-item-info">
                <h5>{file.name}</h5>
                <p>
                  {formatFileSize(file.size)} &middot; {formatTimeAgo(file.modified)}
                  {file.is_current && (
                    <span style={{ marginLeft: 8, color: "var(--accent-primary)" }}>Current</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Log viewer */}
      {(tab === "latest" || selectedFile) && (
        <>
          {/* Controls */}
          <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center", flexShrink: 0 }}>
            <input
              type="text"
              className="input"
              placeholder="Filter logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ flex: 1, maxWidth: 300 }}
            />
            <select
              className="select"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value as LogLevel)}
            >
              <option value="debug">All</option>
              <option value="info">Info+</option>
              <option value="warn">Warnings+</option>
              <option value="error">Errors only</option>
            </select>
            {tab === "latest" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  style={{ accentColor: "var(--accent-primary)" }}
                />
                Auto-scroll
              </label>
            )}
            {selectedFile && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => setSelectedFile(null)}
              >
                Back to list
              </button>
            )}
          </div>

          {/* Log output */}
          <div
            ref={logsContainerRef}
            className="logs-container"
            style={{
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              padding: 16,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.6,
              flex: 1,
              minHeight: 0,
              overflow: "auto",
            }}
          >
            {loading && (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>
                Loading...
              </div>
            )}

            {!loading && filteredLogs.length === 0 && (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>
                {logs.length === 0 ? "No logs yet. Launch the game to see output." : "No logs match your filter."}
              </div>
            )}

            {!loading && filteredLogs.map((entry, i) => (
              <div
                key={`${entry.line_number}-${i}`}
                style={{
                  padding: "2px 0",
                  color: LEVEL_COLORS[entry.level],
                  wordBreak: "break-word",
                }}
              >
                {entry.timestamp && (
                  <span style={{ color: "var(--text-muted)", marginRight: 8 }}>
                    [{entry.timestamp}]
                  </span>
                )}
                {entry.level !== "unknown" && (
                  <span
                    style={{
                      fontWeight: 600,
                      marginRight: 8,
                      color: LEVEL_COLORS[entry.level],
                    }}
                  >
                    [{entry.level.toUpperCase()}]
                  </span>
                )}
                <span>{entry.message}</span>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
            Showing {filteredLogs.length} of {logs.length} entries
            {tab === "latest" && watching && (
              <span style={{ marginLeft: 8, color: "var(--accent-success)" }}>● Live</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
