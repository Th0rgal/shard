import type { ContentTab } from "../types";

/**
 * Get human-readable label for content type
 */
export function getContentTypeLabel(type: ContentTab): string {
  switch (type) {
    case "mods":
      return "mod";
    case "resourcepacks":
      return "resource pack";
    case "shaderpacks":
      return "shader pack";
  }
}

/**
 * Get plural label for content type
 */
export function getContentTypeLabelPlural(type: ContentTab): string {
  switch (type) {
    case "mods":
      return "mods";
    case "resourcepacks":
      return "resource packs";
    case "shaderpacks":
      return "shader packs";
  }
}

/**
 * Format download count with appropriate suffix (K, M)
 */
export function formatDownloads(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Format timestamp as relative time or date
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Format date string to locale date
 */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}
