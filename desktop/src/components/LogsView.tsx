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
  error: "#f87171",
  fatal: "#ff4444",
  unknown: "var(--text-muted)",
};

const MAX_LOG_ENTRIES = 2000;

export function LogsView() {
  const { selectedProfileId, notify, launchStatus } = useAppStore();
  const [tab, setTab] = useState<LogTab>("latest");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [crashReports, setCrashReports] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null);
  const [filter, setFilter] = useState("");
  const [minLevel, setMinLevel] = useState<LogLevel>("info");
  const [autoScroll, setAutoScroll] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventAtRef = useRef<number>(0);

  // Game is live when it's actively running
  const isGameRunning = launchStatus?.stage === "running";

  const sanitizeEventSegment = useCallback((value: string) => (
    value.replace(/[^a-zA-Z0-9\-/:_]/g, "_")
  ), []);

  const loadLogFiles = useCallback(async () => {
    if (!selectedProfileId) return;
    try {
      const files = await invoke<LogFile[]>("list_log_files_cmd", { profileId: selectedProfileId });
      setLogFiles(files);
    } catch {
      setLogFiles([]);
    }
  }, [selectedProfileId]);

  const loadCrashReports = useCallback(async () => {
    if (!selectedProfileId) return;
    try {
      const files = await invoke<LogFile[]>("list_crash_reports_cmd", { profileId: selectedProfileId });
      setCrashReports(files);
    } catch {
      setCrashReports([]);
    }
  }, [selectedProfileId]);

  const loadFile = useCallback(async (file: LogFile) => {
    setSelectedFile(file);
    setLoading(true);
    try {
      if (tab === "crashes") {
        const content = await invoke<string>("read_crash_report_cmd", {
          profileId: selectedProfileId,
          file: file.name,
        });
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
          profileId: selectedProfileId,
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

  useEffect(() => {
    if (!selectedProfileId || tab !== "latest") return;

    let cancelled = false;

    const startWatching = async () => {
      setLoading(true);
      setLogs([]);

      try {
        const eventName = `log-entries-${sanitizeEventSegment(selectedProfileId)}`;
        unlistenRef.current = await listen<LogEntry[]>(eventName, (event) => {
          if (cancelled) return;
          lastEventAtRef.current = Date.now();
          setLogs(prev => {
            const newLogs = [...prev, ...event.payload];
            if (newLogs.length > MAX_LOG_ENTRIES) {
              return newLogs.slice(-MAX_LOG_ENTRIES);
            }
            return newLogs;
          });
        });

        await invoke("start_log_watch", { profileId: selectedProfileId });

        // Only load existing logs if the game is currently running
        // Otherwise, show empty state to indicate no active session
        if (isGameRunning) {
          try {
            const entries = await invoke<LogEntry[]>("read_logs_cmd", {
              profileId: selectedProfileId,
              file: null,
              lines: MAX_LOG_ENTRIES,
            });
            if (!cancelled) {
              setLogs(entries);
            }
          } catch (err) {
            console.warn("[logs] Failed to read initial logs:", err);
          }
        }

        pollTimerRef.current = setInterval(async () => {
          if (cancelled) return;
          const now = Date.now();
          if (now - lastEventAtRef.current < 1500) return;
          // Only poll if game is running
          if (!isGameRunning) return;
          try {
            const entries = await invoke<LogEntry[]>("read_logs_cmd", {
              profileId: selectedProfileId,
              file: null,
              lines: MAX_LOG_ENTRIES,
            });
            setLogs(entries);
          } catch (err) {
            console.warn("[logs] Polling read failed:", err);
          }
        }, 1500);
      } catch (err) {
        console.warn("[logs] Failed to start log watch:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void startWatching();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [selectedProfileId, tab, isGameRunning, sanitizeEventSegment]);

  useEffect(() => {
    if (!selectedProfileId) return;

    if (tab === "history") {
      void loadLogFiles();
    } else if (tab === "crashes") {
      void loadCrashReports();
    }
  }, [selectedProfileId, tab, loadLogFiles, loadCrashReports]);

  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      const container = logsContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((entry) => {
    const levelPriority: Record<LogLevel, number> = {
      debug: 0, info: 1, warn: 2, error: 3, fatal: 4, unknown: 1,
    };
    if (levelPriority[entry.level] < levelPriority[minLevel]) return false;
    if (filter && !entry.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  if (!selectedProfileId) {
    return (
      <div className="view-transition" >
        <div className="logs-empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.3 }}>
            <rect x="8" y="10" width="32" height="28" rx="4" stroke="currentColor" strokeWidth="2" />
            <path d="M14 18h20M14 24h16M14 30h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p>Select a profile to view logs</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-transition logs-view">
      {/* Header with tabs and controls */}
      <div className="logs-header">
        <div className="logs-tabs">
          <button
            className={clsx("logs-tab", tab === "latest" && "active")}
            onClick={() => { setTab("latest"); setSelectedFile(null); }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 4v3l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Live
            {isGameRunning && <span className="logs-live-dot" />}
          </button>
          <button
            className={clsx("logs-tab", tab === "history" && "active")}
            onClick={() => { setTab("history"); setSelectedFile(null); }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3h8v8H3V3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 6h4M5 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            History
            {logFiles.length > 0 && <span className="logs-tab-count">{logFiles.length}</span>}
          </button>
          <button
            className={clsx("logs-tab", tab === "crashes" && "active")}
            onClick={() => { setTab("crashes"); setSelectedFile(null); }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2L12 12H2L7 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 6v2M7 10h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Crashes
            {crashReports.length > 0 && (
              <span className="logs-tab-count logs-tab-count-danger">{crashReports.length}</span>
            )}
          </button>
        </div>

        {/* Controls - only show when viewing logs */}
        {(tab === "latest" || selectedFile) && (
          <div className="logs-controls">
            <div className="logs-filter">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.4 }}>
                <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Filter..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <select
              className="logs-select"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value as LogLevel)}
            >
              <option value="debug">All</option>
              <option value="info">Info+</option>
              <option value="warn">Warn+</option>
              <option value="error">Errors</option>
            </select>
            {tab === "latest" && (
              <label className="logs-checkbox">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                <span>Auto-scroll</span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* File list for history/crashes */}
      {(tab === "history" || tab === "crashes") && !selectedFile && (
        <div className="logs-file-list">
          {((tab === "history" ? logFiles : crashReports).length === 0) ? (
            <div className="empty-state-container">
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.4, marginBottom: 16 }}>
                  {tab === "crashes" ? (
                    <>
                      <path d="M24 10L40 38H8L24 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M24 20v8M24 32h.02" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </>
                  ) : (
                    <>
                      <rect x="10" y="8" width="28" height="32" rx="3" stroke="currentColor" strokeWidth="2" />
                      <path d="M16 16h16M16 24h12M16 32h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </>
                  )}
                </svg>
                <h3>
                  {tab === "crashes"
                    ? "No crash reports"
                    : "No log files yet"}
                </h3>
                <p style={{ marginBottom: 0 }}>
                  {tab === "crashes"
                    ? "Crash reports appear when the game encounters errors"
                    : "Launch the game to generate logs"}
                </p>
              </div>
            </div>
          ) : (
            (tab === "history" ? logFiles : crashReports).map((file) => (
              <button
                key={file.name}
                className="logs-file-item"
                onClick={() => loadFile(file)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.4 }}>
                  <rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 5h6M5 8h4M5 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <div className="logs-file-info">
                  <span className="logs-file-name">{file.name}</span>
                  <span className="logs-file-meta">
                    {formatFileSize(file.size)} · {formatTimeAgo(file.modified)}
                    {file.is_current && <span className="logs-file-current">Current</span>}
                  </span>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.3 }}>
                  <path d="M5 3l5 4-5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))
          )}
        </div>
      )}

      {/* Log viewer */}
      {(tab === "latest" || selectedFile) && (
        <div className="logs-viewer">
          {selectedFile && (
            <div className="logs-breadcrumb">
              <button onClick={() => setSelectedFile(null)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 3L4 7l5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
              <span>{selectedFile.name}</span>
            </div>
          )}

          {loading && (
            <div className="logs-loading">
              <svg className="spin" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="40" strokeDashoffset="10" />
              </svg>
            </div>
          )}

          {!loading && filteredLogs.length === 0 && (
            <div className="empty-state-container" style={{ flex: 1 }}>
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.4, marginBottom: 16 }}>
                  <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="2" />
                  <path d="M24 16v8l5 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <h3>{logs.length === 0 ? "No logs yet" : "No matching logs"}</h3>
                <p style={{ marginBottom: 0 }}>
                  {logs.length === 0
                    ? "Launch the game to see live output"
                    : "Try adjusting your filter settings"}
                </p>
              </div>
            </div>
          )}

          {!loading && filteredLogs.length > 0 && (
            <>
              <div ref={logsContainerRef} className="logs-output">
                {filteredLogs.map((entry, i) => (
                  <div key={`${entry.line_number}-${i}`} className="logs-line" data-level={entry.level}>
                    {entry.timestamp && (
                      <span className="logs-time">{entry.timestamp}</span>
                    )}
                    {entry.level !== "unknown" && (
                      <span className="logs-level" style={{ color: LEVEL_COLORS[entry.level] }}>
                        {entry.level.toUpperCase()}
                      </span>
                    )}
                    <span className="logs-message" style={{ color: LEVEL_COLORS[entry.level] }}>
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>

              <div className="logs-status">
                <span>{filteredLogs.length} of {logs.length} entries</span>
                {tab === "latest" && isGameRunning && (
                  <span className="logs-status-live">
                    <span className="logs-live-dot" />
                    Live
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
