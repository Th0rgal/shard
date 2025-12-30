import clsx from "clsx";
import { useAppStore } from "../store";
import type { ContentRef, ContentTab } from "../types";
import { getContentTypeLabel, getContentTypeLabelPlural, formatContentName, formatVersion, formatFileName } from "../utils";

interface ProfileViewProps {
  onLaunch: () => void;
  onPrepare: () => void;
  onOpenInstance: () => void;
  onCopyCommand: () => void;
  onShowJson: () => void;
  onAddContent: (kind: ContentTab) => void;
  onRemoveContent: (item: ContentRef) => void;
}

function formatSource(source?: string | null): string | null {
  if (!source) return null;
  try {
    return new URL(source).host.replace(/^www\./, "");
  } catch {
    return source;
  }
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
  } = useAppStore();

  const activeAccount = getActiveAccount();

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

  const contentCounts = {
    mods: profile.mods.length,
    resourcepacks: profile.resourcepacks.length,
    shaderpacks: profile.shaderpacks.length,
  };

  const loaderLabel = profile.loader
    ? `${profile.loader.type} ${profile.loader.version}`
    : "Vanilla";

  const settingsItems = [
    { key: "Minecraft version", value: profile.mcVersion },
    { key: "Mod loader", value: loaderLabel },
    { key: "Memory", value: profile.runtime.memory },
    { key: "Java path", value: profile.runtime.java, mono: true },
  ].filter((item) => item.value);

  return (
    <div className="view-transition">
      {/* Header with title, chips, and launch button */}
      <div className="profile-header">
        <div className="profile-header-info">
          <h1 className="page-title">{profile.id}</h1>
          <div className="profile-chips">
            <span className="chip">{profile.mcVersion}</span>
            <span className="chip">{loaderLabel}</span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={onLaunch} disabled={!activeAccount || isWorking}>
          Launch
        </button>
      </div>

      {/* Content section */}
      <div className="section-panel">
        <div className="section-header">
          <span>Content</span>
          <button className="link" onClick={() => onAddContent(activeTab)}>+ Add {getContentTypeLabel(activeTab)}</button>
        </div>

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

        {contentItems.length === 0 ? (
          <div className="empty-state-inline">
            <span>No {getContentTypeLabelPlural(activeTab)} installed</span>
            <button className="link" onClick={() => onAddContent(activeTab)}>+ Add</button>
          </div>
        ) : (
          <div className="content-list">
            {contentItems.map((item) => (
              <div key={item.hash} className="content-item">
                <div className="content-item-info">
                  <h5>{formatContentName(item.name)}</h5>
                  <p>
                    {[
                      formatVersion(item.version) && `v${formatVersion(item.version)}`,
                      formatSource(item.source),
                      formatFileName(item.file_name)
                    ].filter(Boolean).join(" · ") || item.hash.slice(0, 12)}
                  </p>
                </div>
                <div className="content-item-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => onRemoveContent(item)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings section */}
      <div className="section-panel">
        <div className="section-header">
          <span>Settings</span>
        </div>
        <div className="settings-grid">
          {settingsItems.map((item) => (
            <div key={item.key} className="setting-row-compact">
              <span className="setting-key">{item.key}</span>
              <span
                className={clsx("setting-value", item.mono && "mono")}
                title={item.value ?? undefined}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
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
