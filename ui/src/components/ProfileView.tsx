import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { useAppStore } from "../store";
import type { ContentRef, ContentTab, Profile } from "../types";
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
  onEditVersion: () => void;
  onEditLoader: () => void;
}

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
  onEditVersion,
  onEditLoader,
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

  const contentCounts = {
    mods: profile.mods.length,
    resourcepacks: profile.resourcepacks.length,
    shaderpacks: profile.shaderpacks.length,
  };

  const loaderLabel = profile.loader
    ? `${profile.loader.type} ${profile.loader.version}`
    : "Vanilla";

  return (
    <div className="view-transition" >
      {/* Header with title, chips, and launch button */}
      <div className="profile-header">
        <div className="profile-header-info">
          <h1 className="page-title">{profile.id}</h1>
          <div className="profile-chips">
            <button className="chip chip-editable" onClick={onEditVersion} title="Change Minecraft version">
              {profile.mcVersion}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button className="chip chip-editable" onClick={onEditLoader} title="Change mod loader">
              {loaderLabel}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={onLaunch}
          disabled={!activeAccount || isWorking || !!launchStatus}
        >
          {launchStatus ? "Queued" : "Launch"}
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
              const platformColor = getPlatformColor(platform);
              const version = formatVersion(item.version);

              return (
                <div key={item.hash} className={clsx("content-item-v2", isPinned && "content-item-pinned")}>
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
