import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { PlatformIcon, PLATFORM_COLORS, type Platform } from "./PlatformIcon";
import { formatContentName, formatVersion } from "../utils";

type ContentType = "mod" | "mods" | "resourcepack" | "resourcepacks" | "shaderpack" | "shaderpacks";

// Platform URL templates - centralized for maintainability
const PLATFORM_URLS = {
  modrinth: {
    base: "https://modrinth.com",
    paths: {
      mod: "mod",
      resourcepack: "resourcepack",
      shaderpack: "shader",
    },
  },
  curseforge: {
    base: "https://www.curseforge.com/minecraft",
    paths: {
      mod: "mc-mods",
      resourcepack: "texture-packs",
      shaderpack: "shaders",
    },
  },
} as const;

export interface ContentItemData {
  name: string;
  hash: string;
  version?: string | null;
  platform?: string | null;
  project_id?: string | null;
  source_platform?: string | null;
  source_project_id?: string | null;
  source_version?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  enabled?: boolean;
  pinned?: boolean;
}

interface ContentItemRowProps {
  item: ContentItemData;
  contentType: ContentType;
  selected?: boolean;
  onClick?: () => void;
  actions?: React.ReactNode;
  showBadges?: boolean;
}

function getPlatformLabel(platform: Platform): string {
  if (platform === "modrinth") return "Modrinth";
  if (platform === "curseforge") return "CurseForge";
  return "Local";
}

function getPlatformColor(platform: Platform): string {
  return PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] || PLATFORM_COLORS.local;
}

function getSourceUrl(item: ContentItemData, contentType: ContentType): string | null {
  const platformRaw = (item.platform || item.source_platform)?.toLowerCase();
  const projectId = item.project_id || item.source_project_id;

  if (!projectId || !platformRaw || platformRaw === "local" || platformRaw === "store") return null;

  // Check if platform is supported
  if (!(platformRaw in PLATFORM_URLS)) return null;
  const platform = platformRaw as keyof typeof PLATFORM_URLS;

  // Normalize content type to singular form
  const normalizedType = (contentType.endsWith("s") ? contentType.slice(0, -1) : contentType) as keyof typeof PLATFORM_URLS.modrinth.paths;

  const platformConfig = PLATFORM_URLS[platform];
  const path = platformConfig.paths[normalizedType];
  if (!path) return null;

  return `${platformConfig.base}/${path}/${projectId}`;
}

export function ContentItemRow({
  item,
  contentType,
  selected,
  onClick,
  actions,
  showBadges = true,
}: ContentItemRowProps) {
  const platform = ((item.platform || item.source_platform)?.toLowerCase() || "local") as Platform;
  const isPinned = item.pinned ?? false;
  const isEnabled = item.enabled ?? true;
  const platformColor = getPlatformColor(platform);
  const version = formatVersion(item.version || item.source_version);
  const sourceUrl = getSourceUrl(item, contentType);

  return (
    <div
      className={clsx(
        "content-item-v2",
        isPinned && showBadges && "content-item-pinned",
        !isEnabled && showBadges && "content-item-disabled",
        selected && "content-item-selected"
      )}
      onClick={onClick}
      style={{
        cursor: onClick ? "pointer" : undefined,
        background: selected ? "rgba(232, 168, 85, 0.08)" : undefined,
        borderColor: selected ? "rgba(232, 168, 85, 0.2)" : undefined,
      }}
    >
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
          {showBadges && (
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
          )}
        </div>
        <div className="content-item-meta">
          {version && (
            <span className="content-meta-version">v{version}</span>
          )}
          {sourceUrl ? (
            <button
              className="content-meta-platform content-meta-platform-link"
              style={{ color: platformColor }}
              onClick={(e) => {
                e.stopPropagation();
                openUrl(sourceUrl);
              }}
              title={`Open on ${getPlatformLabel(platform)}`}
            >
              {getPlatformLabel(platform)}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          ) : (
            <span
              className="content-meta-platform"
              style={{ color: platformColor }}
            >
              {getPlatformLabel(platform)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {actions && (
        <div className="content-item-actions">
          {actions}
        </div>
      )}
    </div>
  );
}
