import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { StorageStats, UpdateCheckResult, ContentUpdate } from "../types";
import { formatFileSize } from "../utils";

type StorageCategory = {
  key: string;
  label: string;
  bytes: number;
  color: string;
};

export function SettingsView() {
  const { notify } = useAppStore();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [applyingUpdate, setApplyingUpdate] = useState<string | null>(null);

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

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadStats(), loadAutoUpdate()]);
      setLoading(false);
    };
    load();
  }, [loadStats, loadAutoUpdate]);

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

  if (loading) {
    return (
      <div className="view-transition" style={{ padding: 20 }}>
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="view-transition">
        {/* Storage Section */}
        {stats && (
          <section className="settings-card" style={{ marginBottom: 24 }}>
            <div className="settings-card-header">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
                <path d="M3 4h14v12H3V4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 8h14M7 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>Storage</span>
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
        )}

        {/* Updates Section */}
        <section className="settings-card" style={{ marginBottom: 24 }}>
          <div className="settings-card-header">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
              <path d="M10 3v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span>Updates</span>
          </div>

          {/* Auto-update row */}
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-title">Auto-check for updates</div>
              <div className="settings-row-description">Check when the launcher starts</div>
            </div>
            <button
              className="toggle-switch"
              data-active={autoUpdate}
              onClick={handleAutoUpdateToggle}
            >
              <span className="toggle-switch-thumb" />
            </button>
          </div>

          {/* Check button */}
          <button
            className="btn btn-secondary"
            onClick={handleCheckUpdates}
            disabled={checkingUpdates}
            style={{ width: "100%", marginTop: 16 }}
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
            <p className="settings-muted" style={{ marginTop: 16 }}>
              All content is up to date
            </p>
          )}

          {updateResult && updateResult.errors.length > 0 && (
            <p className="settings-error" style={{ marginTop: 12 }}>
              {updateResult.errors.length} error{updateResult.errors.length !== 1 ? "s" : ""} during check
            </p>
          )}
        </section>

        {/* About Section */}
        <section className="settings-card settings-card-muted">
          <div className="settings-card-header">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.6 }}>
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 9v4M10 7h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Tips</span>
          </div>
          <p className="settings-tip">
            Pin content in the profile view to prevent auto-updates. Pinned mods, shaders, and resource packs stay at their current version.
          </p>
        </section>
    </div>
  );
}
