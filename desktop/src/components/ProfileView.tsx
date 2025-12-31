import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { useAppStore } from "../store";
import type { ContentRef, ContentTab, Profile, ManifestVersion, MinecraftVersionsResponse } from "../types";
import { getContentTypeLabel, getContentTypeLabelPlural, formatContentName, formatVersion } from "../utils";
import { PlatformIcon, PLATFORM_COLORS, type Platform } from "./PlatformIcon";

interface ProfileViewProps {
  onLaunch: () => void;
  onPrepare: () => void;
  onOpenInstance: () => void;
  onCopyCommand: () => void;
  onShowJson: () => void;
  onAddContent: (kind: ContentTab) => void;
  onRemoveContent: (item: ContentRef) => void;
}

type ExpandedDropdown = "version" | "loader" | null;

function getPlatformLabel(platform: Platform): string {
  if (platform === "modrinth") return "Modrinth";
  if (platform === "curseforge") return "CurseForge";
  return "Local";
}

function getPlatformColor(platform: Platform): string {
  return PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] || PLATFORM_COLORS.local;
}

export function ProfileView({
  onLaunch,
  onPrepare,
  onOpenInstance,
  onCopyCommand,
  onShowJson,
  onAddContent,
  onRemoveContent,
}: ProfileViewProps) {
  const {
    profile,
    activeTab,
    setActiveTab,
    isWorking,
    getActiveAccount,
    loadProfile,
    notify,
    launchStatus,
  } = useAppStore();

  const activeAccount = getActiveAccount();
  const [togglingPin, setTogglingPin] = useState<string | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState<string | null>(null);

  // Inline version/loader editing state
  const [expandedDropdown, setExpandedDropdown] = useState<ExpandedDropdown>(null);
  const [mcVersions, setMcVersions] = useState<ManifestVersion[]>([]);
  const [mcVersionsLoading, setMcVersionsLoading] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [fabricVersions, setFabricVersions] = useState<string[]>([]);
  const [fabricLoading, setFabricLoading] = useState(false);
  const [selectedLoaderType, setSelectedLoaderType] = useState<string>("");
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExpandedDropdown(null);
      }
    };
    if (expandedDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [expandedDropdown]);

  // Load MC versions when version dropdown opens
  const loadMcVersions = useCallback(async () => {
    if (mcVersions.length > 0) return;
    setMcVersionsLoading(true);
    try {
      const response = await invoke<MinecraftVersionsResponse>("fetch_minecraft_versions_cmd");
      setMcVersions(response.versions);
    } catch (err) {
      notify("Failed to load versions", String(err));
    } finally {
      setMcVersionsLoading(false);
    }
  }, [mcVersions.length, notify]);

  // Load Fabric versions when loader dropdown opens
  const loadFabricVersions = useCallback(async () => {
    if (fabricVersions.length > 0) return;
    setFabricLoading(true);
    try {
      const versions = await invoke<string[]>("fetch_fabric_versions_cmd");
      setFabricVersions(versions);
    } catch (err) {
      notify("Failed to load Fabric versions", String(err));
    } finally {
      setFabricLoading(false);
    }
  }, [fabricVersions.length, notify]);

  const handleExpandVersion = () => {
    if (expandedDropdown === "version") {
      setExpandedDropdown(null);
    } else {
      setExpandedDropdown("version");
      void loadMcVersions();
    }
  };

  const handleExpandLoader = () => {
    if (expandedDropdown === "loader") {
      setExpandedDropdown(null);
    } else {
      setExpandedDropdown("loader");
      setSelectedLoaderType(profile?.loader?.type || "");
      setSelectedLoaderVersion(profile?.loader?.version || "");
      void loadFabricVersions();
    }
  };

  const handleVersionSelect = async (version: string) => {
    if (!profile || version === profile.mcVersion) {
      setExpandedDropdown(null);
      return;
    }
    setSaving(true);
    try {
      await invoke<Profile>("update_profile_version_cmd", {
        id: profile.id,
        mcVersion: version,
        loaderType: profile.loader?.type || null,
        loaderVersion: profile.loader?.version || null,
      });
      await loadProfile(profile.id);
      notify("Version updated", `Changed to ${version}`);
    } catch (err) {
      notify("Failed to update version", String(err));
    } finally {
      setSaving(false);
      setExpandedDropdown(null);
    }
  };

  const handleLoaderSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await invoke<Profile>("update_profile_version_cmd", {
        id: profile.id,
        mcVersion: profile.mcVersion,
        loaderType: selectedLoaderType || null,
        loaderVersion: selectedLoaderVersion || null,
      });
      await loadProfile(profile.id);
      notify("Loader updated", selectedLoaderType ? `Changed to ${selectedLoaderType}` : "Set to Vanilla");
    } catch (err) {
      notify("Failed to update loader", String(err));
    } finally {
      setSaving(false);
      setExpandedDropdown(null);
    }
  };

  if (!profile) {
    return (
      <div className="empty-state">
        <h3>No profile selected</h3>
        <p>Create your first profile to start launching Minecraft.</p>
      </div>
    );
  }

  const contentItems = (() => {
    if (activeTab === "mods") return profile.mods;
    if (activeTab === "resourcepacks") return profile.resourcepacks;
    return profile.shaderpacks;
  })();

  const handleTogglePin = async (item: ContentRef) => {
    if (!profile) return;
    const contentType = activeTab === "mods" ? "mod" : activeTab === "resourcepacks" ? "resourcepack" : "shaderpack";
    setTogglingPin(item.hash);
    try {
      await invoke<Profile>("set_content_pinned_cmd", {
        profile_id: profile.id,
        content_name: item.name,
        content_type: contentType,
        pinned: !item.pinned,
      });
      await loadProfile(profile.id);
    } catch (err) {
      notify("Failed to update pin", String(err));
    }
    setTogglingPin(null);
  };

  const handleToggleEnabled = async (item: ContentRef) => {
    if (!profile) return;
    const contentType = activeTab === "mods" ? "mod" : activeTab === "resourcepacks" ? "resourcepack" : "shaderpack";
    setTogglingEnabled(item.hash);
    try {
      await invoke<Profile>("set_content_enabled_cmd", {
        profile_id: profile.id,
        content_name: item.name,
        content_type: contentType,
        enabled: !(item.enabled ?? true),
      });
      await loadProfile(profile.id);
    } catch (err) {
      notify("Failed to update enabled state", String(err));
    }
    setTogglingEnabled(null);
  };

  const contentCounts = {
    mods: profile.mods.length,
    resourcepacks: profile.resourcepacks.length,
    shaderpacks: profile.shaderpacks.length,
  };

  const loaderLabel = profile.loader
    ? `${profile.loader.type} ${profile.loader.version}`
    : "Vanilla";

  const filteredVersions = showSnapshots
    ? mcVersions
    : mcVersions.filter((v) => v.type === "release");

  return (
    <div className="view-transition" >
      {/* Header with title, chips, and launch button */}
      <div className="profile-header">
        <div className="profile-header-info">
          <h1 className="page-title">{profile.id}</h1>
          <div className="profile-chips" ref={dropdownRef}>
            {/* Version chip with dropdown */}
            <div className="chip-dropdown-wrapper">
              <button
                className={clsx("chip chip-editable", expandedDropdown === "version" && "chip-active")}
                onClick={handleExpandVersion}
                title="Change Minecraft version"
              >
                {saving && expandedDropdown === "version" ? "Saving..." : profile.mcVersion}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={clsx(expandedDropdown === "version" && "rotated")}>
                  <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {expandedDropdown === "version" && (
                <div className="chip-dropdown">
                  <div className="chip-dropdown-header">
                    <span>Minecraft Version</span>
                    <label className="snapshots-toggle">
                      <input
                        type="checkbox"
                        checked={showSnapshots}
                        onChange={(e) => setShowSnapshots(e.target.checked)}
                      />
                      <span>Snapshots</span>
                    </label>
                  </div>
                  <div className="chip-dropdown-list">
                    {mcVersionsLoading ? (
                      <div className="chip-dropdown-loading">Loading versions...</div>
                    ) : (
                      filteredVersions.map((v) => (
                        <button
                          key={v.id}
                          className={clsx("chip-dropdown-item", v.id === profile.mcVersion && "selected")}
                          onClick={() => handleVersionSelect(v.id)}
                          disabled={saving}
                        >
                          {v.id}
                          {v.id === profile.mcVersion && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Loader chip with dropdown */}
            <div className="chip-dropdown-wrapper">
              <button
                className={clsx("chip chip-editable", expandedDropdown === "loader" && "chip-active")}
                onClick={handleExpandLoader}
                title="Change mod loader"
              >
                {saving && expandedDropdown === "loader" ? "Saving..." : loaderLabel}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={clsx(expandedDropdown === "loader" && "rotated")}>
                  <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {expandedDropdown === "loader" && (
                <div className="chip-dropdown">
                  <div className="chip-dropdown-header">
                    <span>Mod Loader</span>
                  </div>
                  <div className="chip-dropdown-section">
                    <select
                      className="select select-sm"
                      value={selectedLoaderType}
                      onChange={(e) => {
                        setSelectedLoaderType(e.target.value);
                        if (e.target.value === "fabric" && fabricVersions.length > 0) {
                          setSelectedLoaderVersion(fabricVersions[0]);
                        } else if (e.target.value === "") {
                          setSelectedLoaderVersion("");
                        }
                      }}
                    >
                      <option value="">Vanilla (no loader)</option>
                      <option value="fabric">Fabric</option>
                      <option value="quilt">Quilt</option>
                      <option value="forge">Forge</option>
                      <option value="neoforge">NeoForge</option>
                    </select>
                  </div>
                  {selectedLoaderType === "fabric" && (
                    <div className="chip-dropdown-section">
                      <label className="chip-dropdown-label">Fabric Version</label>
                      <select
                        className="select select-sm"
                        value={selectedLoaderVersion}
                        onChange={(e) => setSelectedLoaderVersion(e.target.value)}
                        disabled={fabricLoading}
                      >
                        {fabricLoading ? (
                          <option>Loading...</option>
                        ) : (
                          fabricVersions.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))
                        )}
                      </select>
                    </div>
                  )}
                  {(selectedLoaderType === "quilt" || selectedLoaderType === "forge" || selectedLoaderType === "neoforge") && (
                    <div className="chip-dropdown-section">
                      <label className="chip-dropdown-label">{selectedLoaderType.charAt(0).toUpperCase() + selectedLoaderType.slice(1)} Version</label>
                      <input
                        className="input input-sm"
                        value={selectedLoaderVersion}
                        onChange={(e) => setSelectedLoaderVersion(e.target.value)}
                        placeholder="e.g., 0.20.0"
                      />
                    </div>
                  )}
                  <div className="chip-dropdown-footer">
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpandedDropdown(null)}>
                      Cancel
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleLoaderSave} disabled={saving}>
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={onLaunch}
          disabled={!activeAccount || isWorking || !!launchStatus}
        >
          {launchStatus ? launchStatus.stage.charAt(0).toUpperCase() + launchStatus.stage.slice(1) : "Launch"}
        </button>
      </div>

      {/* Content section */}
      <div className="section-panel">
        <div className="content-tabs-row">
          <div className="content-tabs">
            <button className={clsx("content-tab", activeTab === "mods" && "active")} onClick={() => setActiveTab("mods")}>
              Mods<span className="count">{contentCounts.mods}</span>
            </button>
            <button className={clsx("content-tab", activeTab === "resourcepacks" && "active")} onClick={() => setActiveTab("resourcepacks")}>
              Resource Packs<span className="count">{contentCounts.resourcepacks}</span>
            </button>
            <button className={clsx("content-tab", activeTab === "shaderpacks" && "active")} onClick={() => setActiveTab("shaderpacks")}>
              Shaders<span className="count">{contentCounts.shaderpacks}</span>
            </button>
          </div>
          <button
            className="btn-icon btn-add-content"
            onClick={() => onAddContent(activeTab)}
            title={`Add ${getContentTypeLabel(activeTab)}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {contentItems.length === 0 ? (
          <div className="empty-state-inline">
            <span>No {getContentTypeLabelPlural(activeTab)} installed</span>
            <button className="link" onClick={() => onAddContent(activeTab)}>+ Add</button>
          </div>
        ) : (
          <div className="content-list">
            {contentItems.map((item) => {
              const platform = (item.platform?.toLowerCase() || "local") as Platform;
              const isPinned = item.pinned ?? false;
              const isEnabled = item.enabled ?? true;
              const platformColor = getPlatformColor(platform);
              const version = formatVersion(item.version);

              return (
                <div key={item.hash} className={clsx("content-item-v2", isPinned && "content-item-pinned", !isEnabled && "content-item-disabled")}>
                  {/* Platform indicator stripe */}
                  <div
                    className="content-item-platform-stripe"
                    style={{ backgroundColor: platformColor }}
                  />

                  {/* Platform icon */}
                  <div className="content-item-icon">
                    <PlatformIcon platform={platform} size="lg" />
                  </div>

                  {/* Content info */}
                  <div className="content-item-main">
                    <div className="content-item-header">
                      <h5 className="content-item-name">{formatContentName(item.name)}</h5>
                      <div className="content-item-badges">
                        {isPinned && (
                          <span className="content-badge content-badge-pinned" title="Pinned - won't auto-update">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M16 4h1v1h-1zm1 1h1v1h-1zm1 1h1v2h-1zm0 2h-1v1h1zm-1 1h-1v1h1zm-1 1h-1v1h1v1h-1v1h-1v1h-1v1h-1v1h1v3h-2v-3h1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1H9v-1H8V9h1V8h1V7h1V6h2v1h1v1h1V7h1V6h1V5h1v1z"/>
                            </svg>
                            Pinned
                          </span>
                        )}
                        {!isEnabled && (
                          <span className="content-badge content-badge-disabled" title="Disabled - won't be loaded">
                            Disabled
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="content-item-meta">
                      {version && (
                        <span className="content-meta-version">v{version}</span>
                      )}
                      <span
                        className="content-meta-platform"
                        style={{ color: platformColor }}
                      >
                        {getPlatformLabel(platform)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="content-item-actions">
                    <button
                      className={clsx("btn-icon", !isEnabled && "btn-icon-active")}
                      onClick={() => handleToggleEnabled(item)}
                      disabled={togglingEnabled === item.hash}
                      title={isEnabled ? "Disable (won't load)" : "Enable (load in instance)"}
                    >
                      {togglingEnabled === item.hash ? (
                        <span className="btn-icon-loading" />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v6" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M6.4 4.8a8 8 0 1 0 11.2 0" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    {platform !== "local" && (
                      <button
                        className={clsx("btn-icon", isPinned && "btn-icon-active")}
                        onClick={() => handleTogglePin(item)}
                        disabled={togglingPin === item.hash}
                        title={isPinned ? "Unpin (allow auto-updates)" : "Pin (prevent auto-updates)"}
                      >
                        {togglingPin === item.hash ? (
                          <span className="btn-icon-loading" />
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                            <path d="M12 2L12 12M12 12L8 8M12 12L16 8M5 15H19M7 19H17" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    )}
                    <button
                      className="btn-icon btn-icon-danger"
                      onClick={() => onRemoveContent(item)}
                      title="Remove from profile"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions section */}
      <div className="section-panel">
        <div className="section-header">
          <span>Actions</span>
        </div>
        <div className="actions-row">
          <button className="btn btn-ghost btn-sm" onClick={onOpenInstance}>Open folder</button>
          <button className="btn btn-ghost btn-sm" onClick={onCopyCommand}>Copy CLI command</button>
          <button className="btn btn-ghost btn-sm" onClick={onPrepare}>View launch plan</button>
          <button className="btn btn-ghost btn-sm" onClick={onShowJson}>View JSON</button>
        </div>
      </div>
    </div>
  );
}
