import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../store";
import type { StorageStats, UpdateCheckResult, ContentUpdate, JavaInstallation, PurgeResult } from "../types";
import { formatFileSize } from "../utils";
import { PurgeStorageModal } from "./modals/PurgeStorageModal";

type StorageCategory = {
  key: string;
  label: string;
  bytes: number;
  color: string;
};

type SettingsSection = "general" | "storage" | "java" | "updates" | "about";

export function SettingsView() {
  const { notify } = useAppStore();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [applyingUpdate, setApplyingUpdate] = useState<string | null>(null);

  // Java settings state
  const [javaInstallations, setJavaInstallations] = useState<JavaInstallation[]>([]);
  const [detectingJava, setDetectingJava] = useState(false);

  // Purge modal state
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const data = await invoke<StorageStats>("get_storage_stats_cmd");
      setStats(data);
    } catch (err) {
      notify("Failed to load storage stats", String(err));
    }
  }, [notify]);

  const loadAutoUpdate = useCallback(async () => {
    try {
      const enabled = await invoke<boolean>("get_auto_update_enabled_cmd");
      setAutoUpdate(enabled);
    } catch {
      setAutoUpdate(true);
    }
  }, []);

  const loadJavaInstallations = useCallback(async () => {
    setDetectingJava(true);
    try {
      const installations = await invoke<JavaInstallation[]>("detect_java_installations_cmd");
      setJavaInstallations(installations);
    } catch (err) {
      notify("Failed to detect Java", String(err));
    }
    setDetectingJava(false);
  }, [notify]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadStats(), loadAutoUpdate()]);
      setLoading(false);
    };
    load();
  }, [loadStats, loadAutoUpdate]);

  // Load Java installations when Java section is active
  useEffect(() => {
    if (activeSection === "java" && javaInstallations.length === 0) {
      loadJavaInstallations();
    }
  }, [activeSection, javaInstallations.length, loadJavaInstallations]);

  const handleAutoUpdateToggle = async () => {
    const newValue = !autoUpdate;
    try {
      await invoke("set_auto_update_enabled_cmd", { enabled: newValue });
      setAutoUpdate(newValue);
      notify("Settings saved", `Auto-update ${newValue ? "enabled" : "disabled"}`);
    } catch (err) {
      notify("Failed to save settings", String(err));
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateResult(null);
    try {
      const result = await invoke<UpdateCheckResult>("check_all_updates_cmd");
      setUpdateResult(result);
      if (result.updates.length === 0) {
        notify("All up to date", `Checked ${result.checked} items, no updates available`);
      } else {
        notify("Updates available", `Found ${result.updates.length} updates`);
      }
    } catch (err) {
      notify("Update check failed", String(err));
    }
    setCheckingUpdates(false);
  };

  const handleApplyUpdate = async (update: ContentUpdate) => {
    const key = `${update.profile_id}:${update.content.name}`;
    setApplyingUpdate(key);
    try {
      await invoke("apply_content_update_cmd", {
        profile_id: update.profile_id,
        content_name: update.content.name,
        content_type: update.content_type,
        new_version_id: update.latest_version_id,
      });
      notify("Update applied", `${update.content.name} updated to ${update.latest_version}`);
      await handleCheckUpdates();
    } catch (err) {
      notify("Update failed", String(err));
    }
    setApplyingUpdate(null);
  };

  const handleApplyAllUpdates = async () => {
    if (!updateResult) return;
    for (const update of updateResult.updates) {
      if (!update.content.pinned) {
        await handleApplyUpdate(update);
      }
    }
  };

  const getStorageCategories = (): StorageCategory[] => {
    if (!stats) return [];
    return [
      { key: "mods", label: "Mods", bytes: stats.mods_bytes, color: "#7cc7ff" },
      { key: "resourcepacks", label: "Resources", bytes: stats.resourcepacks_bytes, color: "#a78bfa" },
      { key: "shaderpacks", label: "Shaders", bytes: stats.shaderpacks_bytes, color: "#f472b6" },
      { key: "skins", label: "Skins", bytes: stats.skins_bytes, color: "#34d399" },
      { key: "minecraft", label: "Minecraft", bytes: stats.minecraft_bytes, color: "#fbbf24" },
      { key: "database", label: "Database", bytes: stats.database_bytes, color: "#94a3b8" },
    ].filter((c) => c.bytes > 0);
  };

  const categories = getStorageCategories();
  const totalStorageBytes = stats?.total_bytes ?? 0;

  const handleOpenDataFolder = async () => {
    try {
      // Get the data folder path and reveal it in file manager
      const path = await invoke<string>("get_data_path_cmd");
      await revealItemInDir(path);
    } catch (err) {
      notify("Failed to open folder", String(err));
    }
  };

  const handlePurgeCompleted = (result: PurgeResult) => {
    if (result.deleted_count > 0) {
      notify(
        "Storage cleaned",
        `Deleted ${result.deleted_count} item${result.deleted_count !== 1 ? "s" : ""}, freed ${formatFileSize(result.freed_bytes)}`
      );
      // Refresh storage stats
      loadStats();
    }
  };

  if (loading) {
    return (
      <div className="view-transition" style={{ padding: 20 }}>
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  const sections: { id: SettingsSection; label: string; icon: JSX.Element }[] = [
    {
      id: "general",
      label: "General",
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 1v2M10 17v2M17 10h2M1 10h2M15.07 4.93l1.41-1.41M3.52 16.48l1.41-1.41M15.07 15.07l1.41 1.41M3.52 3.52l1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: "storage",
      label: "Storage",
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M3 4h14v12H3V4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 8h14M7 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: "java",
      label: "Java",
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M6 14s1-1 4-1 4 1 4 1M7 10s2 1 3 1 3-1 3-1M5 6s2 2 5 2 5-2 5-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: "updates",
      label: "Updates",
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M10 3v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
    {
      id: "about",
      label: "About",
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 9v4M10 7h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  const activeItem = sections.find((s) => s.id === activeSection);

  return (
    <div className="view-transition settings-layout">
      {/* Settings Dropdown Selector */}
      <div className="settings-selector">
        <select
          className="settings-select"
          value={activeSection}
          onChange={(e) => setActiveSection(e.target.value as SettingsSection)}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
        <div className="settings-select-display">
          {activeItem?.icon}
          <span>{activeItem?.label}</span>
          <svg className="settings-select-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Settings Content */}
      <div className="settings-content">
        {/* General Section */}
        {activeSection === "general" && (
          <>
            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 1v2M10 17v2M17 10h2M1 10h2M15.07 4.93l1.41-1.41M3.52 16.48l1.41-1.41M15.07 15.07l1.41 1.41M3.52 3.52l1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>General</span>
              </div>

              <div className="settings-row">
                <div className="settings-row-content">
                  <div className="settings-row-title">Auto-check for updates</div>
                  <div className="settings-row-description">Check for mod updates when the launcher starts</div>
                </div>
                <button
                  className="toggle-switch"
                  data-active={autoUpdate}
                  onClick={handleAutoUpdateToggle}
                >
                  <span className="toggle-switch-thumb" />
                </button>
              </div>
            </section>

            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M3 7l7-4 7 4v6l-7 4-7-4V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M10 11V3M10 11l7-4M10 11l-7-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <span>Data</span>
              </div>

              <div className="settings-row">
                <div className="settings-row-content">
                  <div className="settings-row-title">Open data folder</div>
                  <div className="settings-row-description">View profiles, store, and configuration files</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleOpenDataFolder}>
                  Open
                </button>
              </div>
            </section>

            <section className="settings-card settings-card-muted">
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M10 10l5-5M11 5h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Tip</span>
              </div>
              <p className="settings-tip">
                Pin content in the profile view to prevent auto-updates. Pinned mods, shaders, and resource packs stay at their current version.
              </p>
            </section>
          </>
        )}

        {/* Storage Section */}
        {activeSection === "storage" && stats && (
          <>
            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M3 4h14v12H3V4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 8h14M7 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>Storage Usage</span>
                <span className="settings-card-badge">{formatFileSize(totalStorageBytes)}</span>
              </div>

              {/* Storage bar */}
              <div className="storage-bar">
                {categories.map((cat) => {
                  const pct = (cat.bytes / totalStorageBytes) * 100;
                  if (pct < 0.5) return null;
                  return (
                    <div
                      key={cat.key}
                      className="storage-bar-segment"
                      style={{ width: `${pct}%`, background: cat.color }}
                      title={`${cat.label}: ${formatFileSize(cat.bytes)}`}
                    />
                  );
                })}
              </div>

              {/* Legend */}
              <div className="storage-legend">
                {categories.map((cat) => (
                  <div key={cat.key} className="storage-legend-item">
                    <span className="storage-legend-dot" style={{ background: cat.color }} />
                    <span className="storage-legend-label">{cat.label}</span>
                    <span className="storage-legend-value">{formatFileSize(cat.bytes)}</span>
                  </div>
                ))}
              </div>

              {/* Stats row */}
              <div className="storage-stats">
                <div className="storage-stat">
                  <span className="storage-stat-value">{stats.unique_items}</span>
                  <span className="storage-stat-label">files</span>
                </div>
                <div className="storage-stat">
                  <span className="storage-stat-value">{stats.total_references}</span>
                  <span className="storage-stat-label">references</span>
                </div>
                {stats.deduplication_savings > 0 && (
                  <div className="storage-stat storage-stat-highlight">
                    <span className="storage-stat-value">{formatFileSize(stats.deduplication_savings)}</span>
                    <span className="storage-stat-label">saved</span>
                  </div>
                )}
              </div>
            </section>

            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M4 6h12M6 6V5a1 1 0 011-1h6a1 1 0 011 1v1M15 6v10a1 1 0 01-1 1H6a1 1 0 01-1-1V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Cleanup</span>
              </div>

              <div className="settings-row">
                <div className="settings-row-content">
                  <div className="settings-row-title">Clean unused content</div>
                  <div className="settings-row-description">Remove items from the library that are not used by any profile</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setPurgeModalOpen(true)}>
                  Clean
                </button>
              </div>
            </section>

            <section className="settings-card settings-card-muted">
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M10 10l5-5M11 5h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Deduplication</span>
                {stats.deduplication_savings > 0 && (
                  <span className="settings-card-badge" style={{ marginLeft: "auto", background: "rgba(52, 211, 153, 0.15)", color: "#34d399" }}>
                    {formatFileSize(stats.deduplication_savings)} saved
                  </span>
                )}
              </div>
              <p className="settings-tip">
                Shard uses content-addressed storage with SHA-256 hashing. When the same mod is used across multiple profiles, it's stored only once.
                {stats.deduplication_savings > 0 && stats.total_references > stats.unique_items && (
                  <> You have {stats.total_references} references to {stats.unique_items} unique files, saving <strong style={{ color: "#34d399" }}>{formatFileSize(stats.deduplication_savings)}</strong> of disk space.</>
                )}
              </p>
            </section>
          </>
        )}

        {/* Java Section */}
        {activeSection === "java" && (
          <>
            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M6 14s1-1 4-1 4 1 4 1M7 10s2 1 3 1 3-1 3-1M5 6s2 2 5 2 5-2 5-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Detected Installations</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={loadJavaInstallations}
                  disabled={detectingJava}
                  style={{ marginLeft: "auto" }}
                >
                  {detectingJava ? (
                    <svg className="spin" width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                    </svg>
                  ) : (
                    "Refresh"
                  )}
                </button>
              </div>

              {detectingJava && javaInstallations.length === 0 ? (
                <p className="settings-muted">Detecting Java installations...</p>
              ) : javaInstallations.length === 0 ? (
                <p className="settings-muted">No Java installations found</p>
              ) : (
                <div className="java-list">
                  {javaInstallations.map((java, i) => (
                    <div key={i} className="java-item">
                      <div className="java-item-info">
                        <div className="java-item-version">
                          Java {java.major ?? "?"}
                          {java.vendor && <span className="java-item-vendor">({java.vendor})</span>}
                        </div>
                        <div className="java-item-path">{java.path}</div>
                      </div>
                      <div className="java-item-badges">
                        {java.arch && (
                          <span className="badge badge-muted">{java.arch}</span>
                        )}
                        {java.is_valid ? (
                          <span className="badge badge-success">Valid</span>
                        ) : (
                          <span className="badge badge-warning">Invalid</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="settings-card settings-card-muted">
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 9v4M10 7h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>Java Requirements</span>
              </div>
              <p className="settings-tip">
                Minecraft 1.17+ requires Java 17 or newer. Minecraft 1.20.5+ requires Java 21. Older versions work with Java 8. You can set a specific Java path per profile in the profile settings.
              </p>
            </section>
          </>
        )}

        {/* Updates Section */}
        {activeSection === "updates" && (
          <>
            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M10 3v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <span>Content Updates</span>
              </div>

              {/* Check button */}
              <button
                className="btn btn-secondary"
                onClick={handleCheckUpdates}
                disabled={checkingUpdates}
                style={{ width: "100%", marginBottom: 16 }}
              >
                {checkingUpdates ? (
                  <>
                    <svg className="spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                    </svg>
                    Checking...
                  </>
                ) : (
                  "Check for updates"
                )}
              </button>

              {/* Update results */}
              {updateResult && updateResult.updates.length > 0 && (
                <div className="settings-updates-list">
                  <div className="settings-updates-header">
                    <span>{updateResult.updates.length} update{updateResult.updates.length !== 1 ? "s" : ""} available</span>
                    <button className="btn btn-sm btn-primary" onClick={handleApplyAllUpdates}>
                      Update all
                    </button>
                  </div>
                  {updateResult.updates.map((update) => {
                    const key = `${update.profile_id}:${update.content.name}`;
                    const isPinned = update.content.pinned;
                    const isManual = !update.content.platform;
                    return (
                      <div key={key} className="settings-update-item">
                        <div className="settings-update-info">
                          <span className="settings-update-name">{update.content.name}</span>
                          {isPinned && <span className="badge badge-warning">Pinned</span>}
                          {isManual && <span className="badge badge-muted">Manual</span>}
                          <span className="settings-update-version">
                            {update.current_version ?? "?"} → {update.latest_version}
                          </span>
                        </div>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleApplyUpdate(update)}
                          disabled={applyingUpdate === key || isPinned || isManual}
                        >
                          {applyingUpdate === key ? "..." : "Update"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {updateResult && updateResult.updates.length === 0 && (
                <p className="settings-muted">
                  All content is up to date
                </p>
              )}

              {updateResult && updateResult.errors.length > 0 && (
                <p className="settings-error" style={{ marginTop: 12 }}>
                  {updateResult.errors.length} error{updateResult.errors.length !== 1 ? "s" : ""} during check
                </p>
              )}
            </section>
          </>
        )}

        {/* About Section */}
        {activeSection === "about" && (
          <>
            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M3 7l7-4 7 4v6l-7 4-7-4V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M10 11V3M10 11l7-4M10 11l-7-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <span>Shard Launcher</span>
              </div>

              <div className="about-info">
                <div className="about-logo">
                  <img src="/icon.png" alt="Shard" width="64" height="64" style={{ borderRadius: 12 }} />
                </div>
                <div className="about-details">
                  <div className="about-name">Shard</div>
                  <div className="about-version">Version 0.1.0</div>
                  <div className="about-description">
                    A minimal, clean, CLI-first Minecraft launcher focused on stability, reproducibility, and low duplication.
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-card" style={{ marginBottom: 24 }}>
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M10 10l5-5M11 5h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Links</span>
              </div>

              <div className="about-links">
                <button className="btn btn-ghost" style={{ justifyContent: "flex-start", width: "100%" }} onClick={() => openUrl("https://github.com")}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  GitHub Repository
                </button>
              </div>
            </section>

            <section className="settings-card settings-card-muted">
              <div className="settings-card-header">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                  <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 9v4M10 7h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>Credits</span>
              </div>
              <p className="settings-tip">
                Built with Rust, Tauri, and React. Minecraft is a trademark of Mojang Studios. This launcher is not affiliated with or endorsed by Mojang Studios or Microsoft.
              </p>
            </section>
          </>
        )}
      </div>

      {/* Purge Storage Modal */}
      <PurgeStorageModal
        open={purgeModalOpen}
        onClose={() => setPurgeModalOpen(false)}
        onPurged={handlePurgeCompleted}
      />
    </div>
  );
}
