import clsx from "clsx";
import { useAppStore } from "../store";
import type { ContentRef, ContentTab } from "../types";
import { getContentTypeLabel, getContentTypeLabelPlural } from "../utils";

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
    accounts,
    selectedAccountId,
    setSelectedAccountId,
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

  return (
    <div className="view-transition">
      <h1 className="page-title">{profile.id}</h1>

      <div className="setting-row">
        <div className="setting-label">
          <h4>Minecraft version</h4>
          <p>Game version for this profile</p>
        </div>
        <div className="setting-control">
          <span style={{ fontSize: 14 }}>{profile.mcVersion}</span>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <h4>Mod loader</h4>
          <p>Framework for loading mods</p>
        </div>
        <div className="setting-control">
          <span style={{ fontSize: 14 }}>{profile.loader ? `${profile.loader.type} ${profile.loader.version}` : "Vanilla"}</span>
        </div>
      </div>

      {profile.runtime.memory && (
        <div className="setting-row">
          <div className="setting-label">
            <h4>Memory</h4>
            <p>Allocated RAM for the game</p>
          </div>
          <div className="setting-control">
            <span style={{ fontSize: 14 }}>{profile.runtime.memory}</span>
          </div>
        </div>
      )}

      {profile.runtime.java && (
        <div className="setting-row">
          <div className="setting-label">
            <h4>Java</h4>
            <p>Custom Java runtime path</p>
          </div>
          <div className="setting-control">
            <span style={{ fontSize: 14, fontFamily: "var(--font-mono)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{profile.runtime.java}</span>
          </div>
        </div>
      )}

      <div className="setting-row" style={{ paddingTop: 24, paddingBottom: 24, borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 8 }}>
        <div className="setting-label">
          <h4>Launch game</h4>
          <p>Select an account and start playing</p>
        </div>
        <div className="setting-control">
          <select
            className="select"
            value={activeAccount?.uuid ?? ""}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            style={{ minWidth: 140 }}
          >
            {accounts?.accounts.length ? (
              accounts.accounts.map((a) => <option key={a.uuid} value={a.uuid}>{a.username}</option>)
            ) : (
              <option value="">No accounts</option>
            )}
          </select>
          <button className="btn-primary" onClick={onLaunch} disabled={!activeAccount || isWorking}>
            Launch
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-ghost btn-sm" onClick={onOpenInstance}>Open folder</button>
        <button className="btn-ghost btn-sm" onClick={onCopyCommand}>Copy CLI command</button>
        <button className="btn-ghost btn-sm" onClick={onPrepare}>View launch plan</button>
        <button className="btn-ghost btn-sm" onClick={onShowJson}>View JSON</button>
      </div>

      <div className="section-header" style={{ marginTop: 40 }}>
        <span>Content</span>
        <button className="link" style={{ fontSize: 12 }} onClick={() => onAddContent(activeTab)}>+ Add {getContentTypeLabel(activeTab)}</button>
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
        <div className="empty-state">
          <h3>No {getContentTypeLabelPlural(activeTab)} yet</h3>
          <p>Add your first one to get started.</p>
          <button className="btn-secondary btn-sm" onClick={() => onAddContent(activeTab)}>Add {getContentTypeLabel(activeTab)}</button>
        </div>
      ) : (
        <div>
          {contentItems.map((item) => (
            <div key={item.hash} className="content-item">
              <div className="content-item-info">
                <h5>{item.name}</h5>
                <p>
                  {[
                    item.version && `v${item.version}`,
                    formatSource(item.source),
                    item.file_name
                  ].filter(Boolean).join(" · ") || item.hash.slice(0, 12)}
                </p>
              </div>
              <div className="content-item-actions">
                <button className="btn-ghost btn-sm" onClick={() => onRemoveContent(item)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
