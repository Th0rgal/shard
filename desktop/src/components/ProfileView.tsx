import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { useAppStore } from "../store";
import type { ContentRef, ContentTab, Profile } from "../types";
import { getContentTypeLabel, getContentTypeLabelPlural } from "../utils";
import { ContentItemRow } from "./ContentItemRow";
import type { Platform } from "./PlatformIcon";

interface ProfileViewProps {
  onLaunch: () => void;
  onOpenInstance: () => void;
  onCopyCommand: () => void;
  onShowJson: () => void;
  onAddContent: (kind: ContentTab) => void;
  onRemoveContent: (item: ContentRef) => void;
}

type ExpandedDropdown = "version" | "loader" | null;

export function ProfileView({
  onLaunch,
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
    // Precached version data from store
    mcVersions,
    mcVersionLoading: mcVersionsLoading,
    precacheMcVersions,
  } = useAppStore();

  const activeAccount = getActiveAccount();
  const [togglingPin, setTogglingPin] = useState<string | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState<string | null>(null);

  // Inline version/loader editing state
  const [expandedDropdown, setExpandedDropdown] = useState<ExpandedDropdown>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [selectedLoaderType, setSelectedLoaderType] = useState<string>("");
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Loader versions state (fetched dynamically based on loader type)
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false);
  const loaderVersionsCacheRef = useRef<Record<string, string[]>>({});
  // Track expected loader type to avoid race conditions when switching quickly
  const expectedLoaderTypeRef = useRef<string>("");

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

  // Fetch loader versions for a specific loader type
  const fetchLoaderVersions = useCallback(async (loaderType: string, mcVersion: string) => {
    if (!loaderType) {
      expectedLoaderTypeRef.current = "";
      setLoaderVersions([]);
      return;
    }

    // Normalize to lowercase for consistent cache keys and API calls
    const normalizedType = loaderType.toLowerCase();
    // Track expected loader type to avoid race conditions when switching quickly
    expectedLoaderTypeRef.current = normalizedType;
    // Create cache key including MC version for loaders that depend on it
    const cacheKey = ["forge", "neoforge"].includes(normalizedType) ? `${normalizedType}:${mcVersion}` : normalizedType;

    // Check cache first
    if (loaderVersionsCacheRef.current[cacheKey]) {
      // Only set if this is still the expected loader type
      if (expectedLoaderTypeRef.current === normalizedType) {
        setLoaderVersions(loaderVersionsCacheRef.current[cacheKey]);
      }
      return;
    }

    setLoaderVersionsLoading(true);
    try {
      const versions = await invoke<string[]>("fetch_loader_versions_cmd", {
        loaderType: normalizedType,
        mcVersion,
      });
      loaderVersionsCacheRef.current[cacheKey] = versions;
      // Only set if this is still the expected loader type (avoid race condition)
      if (expectedLoaderTypeRef.current === normalizedType) {
        setLoaderVersions(versions);
      }
    } catch (err) {
      console.error("Failed to fetch loader versions:", err);
      // Only clear if this is still the expected loader type
      if (expectedLoaderTypeRef.current === normalizedType) {
        setLoaderVersions([]);
      }
    } finally {
      // Only update loading state if this is still the expected loader type
      if (expectedLoaderTypeRef.current === normalizedType) {
        setLoaderVersionsLoading(false);
      }
    }
  }, []);

  // Ensure versions are loaded (fallback if precache hasn't completed yet)
  const handleExpandVersion = useCallback(() => {
    if (expandedDropdown === "version") {
      setExpandedDropdown(null);
    } else {
      setExpandedDropdown("version");
      // Trigger load if not cached yet (will be instant if already cached)
      if (mcVersions.length === 0) {
        void precacheMcVersions();
      }
    }
  }, [expandedDropdown, mcVersions.length, precacheMcVersions]);

  const handleExpandLoader = useCallback(() => {
    if (expandedDropdown === "loader") {
      setExpandedDropdown(null);
    } else {
      setExpandedDropdown("loader");
      // Normalize loader type to lowercase for dropdown value matching
      const loaderType = (profile?.loader?.type || "").toLowerCase();
      setSelectedLoaderType(loaderType);
      setSelectedLoaderVersion(profile?.loader?.version || "");
      // Fetch versions for current loader type
      if (loaderType) {
        void fetchLoaderVersions(loaderType, profile?.mcVersion || "");
      }
    }
  }, [expandedDropdown, profile?.loader?.type, profile?.loader?.version, profile?.mcVersion, fetchLoaderVersions]);

  // Fetch loader versions when loader type changes
  const handleLoaderTypeChange = useCallback((newLoaderType: string) => {
    setSelectedLoaderType(newLoaderType);
    setSelectedLoaderVersion("");
    if (newLoaderType) {
      void fetchLoaderVersions(newLoaderType, profile?.mcVersion || "");
    } else {
      setLoaderVersions([]);
    }
  }, [fetchLoaderVersions, profile?.mcVersion]);

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
        profileId: profile.id,
        contentName: item.name,
        contentType: contentType,
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
        profileId: profile.id,
        contentName: item.name,
        contentType: contentType,
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

  // Check if mods are supported (requires a mod loader)
  const hasModLoader = !!profile.loader;

  // If mods or shaders tab is selected but no loader, switch to resourcepacks
  useEffect(() => {
    if (!hasModLoader && (activeTab === "mods" || activeTab === "shaderpacks")) {
      setActiveTab("resourcepacks");
    }
  }, [hasModLoader, activeTab, setActiveTab]);

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
                      onChange={(e) => handleLoaderTypeChange(e.target.value)}
                    >
                      <option value="">Vanilla (no loader)</option>
                      <option value="fabric">Fabric</option>
                      <option value="quilt">Quilt</option>
                      <option value="forge">Forge</option>
                      <option value="neoforge">NeoForge</option>
                    </select>
                  </div>
                  {selectedLoaderType && (
                    <div className="chip-dropdown-section">
                      <label className="chip-dropdown-label">
                        {selectedLoaderType.charAt(0).toUpperCase() + selectedLoaderType.slice(1)} Version
                      </label>
                      <select
                        className="select select-sm"
                        value={selectedLoaderVersion}
                        onChange={(e) => setSelectedLoaderVersion(e.target.value)}
                        disabled={loaderVersionsLoading}
                      >
                        {loaderVersionsLoading ? (
                          <option>Loading...</option>
                        ) : loaderVersions.length === 0 ? (
                          <option value="">No versions available</option>
                        ) : (
                          <>
                            {!selectedLoaderVersion && <option value="">Select version...</option>}
                            {/* Include current version if it's not in the fetched list (unlisted/older version) */}
                            {selectedLoaderVersion && !loaderVersions.includes(selectedLoaderVersion) && (
                              <option key={selectedLoaderVersion} value={selectedLoaderVersion}>
                                {selectedLoaderVersion} (current)
                              </option>
                            )}
                            {loaderVersions.map((v) => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  )}
                  <div className="chip-dropdown-footer">
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpandedDropdown(null)}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleLoaderSave}
                      disabled={saving || (!!selectedLoaderType && !selectedLoaderVersion)}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <button
          className="btn-launch"
          onClick={onLaunch}
          disabled={!activeAccount || isWorking || !!launchStatus}
        >
          <svg className="btn-launch-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
          </svg>
          <span>{launchStatus ? launchStatus.stage.charAt(0).toUpperCase() + launchStatus.stage.slice(1) : "Launch"}</span>
        </button>
      </div>

      {/* Content section */}
      <div className="section-panel">
        <div className="content-tabs-row">
          <div className="content-tabs">
            <button className={clsx("content-tab", activeTab === "resourcepacks" && "active")} onClick={() => setActiveTab("resourcepacks")}>
              Packs<span className="count">{contentCounts.resourcepacks}</span>
            </button>
            <div
              className={clsx("content-tab-wrapper", !hasModLoader && "disabled")}
              data-tooltip={hasModLoader ? undefined : "Install a mod loader to enable shaders"}
            >
              <button
                className={clsx("content-tab", activeTab === "shaderpacks" && "active", !hasModLoader && "disabled")}
                onClick={() => hasModLoader && setActiveTab("shaderpacks")}
              >
                Shaders<span className="count">{contentCounts.shaderpacks}</span>
              </button>
            </div>
            <div
              className={clsx("content-tab-wrapper", !hasModLoader && "disabled")}
              data-tooltip={hasModLoader ? undefined : "Install a mod loader to enable mods"}
            >
              <button
                className={clsx("content-tab", activeTab === "mods" && "active", !hasModLoader && "disabled")}
                onClick={() => hasModLoader && setActiveTab("mods")}
              >
                Mods<span className="count">{contentCounts.mods}</span>
              </button>
            </div>
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

              return (
                <ContentItemRow
                  key={item.hash}
                  item={{
                    name: item.name,
                    hash: item.hash,
                    version: item.version,
                    platform: item.platform,
                    project_id: item.project_id,
                    enabled: item.enabled,
                    pinned: item.pinned,
                  }}
                  contentType={activeTab}
                  actions={
                    <>
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
                    </>
                  }
                />
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
          <button className="btn btn-ghost btn-sm" onClick={onShowJson}>View JSON</button>
        </div>
      </div>
    </div>
  );
}
