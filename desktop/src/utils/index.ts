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

/**
 * Format a content name for display.
 * - Decodes URL-encoded characters
 * - Extracts the base name from file-like names
 * - Capitalizes appropriately
 */
export function formatContentName(name: string): string {
  // First decode URL-encoded characters
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // If decoding fails, use original
  }

  // Remove common file extensions
  decoded = decoded.replace(/\.(jar|zip)$/i, "");

  // Extract base name - remove version suffix patterns like:
  // -1.7.2+mc1.20.4, -0.5.8+mc1.20.4, _r5.6.1, etc.
  // Match: dash/underscore followed by version number pattern
  const versionPatterns = [
    /-\d+\.\d+.*$/, // -1.7.2+mc1.20.4
    /_r?\d+\.\d+.*$/, // _r5.6.1, _5.6.1
    /-mc\d+\.\d+.*$/, // -mc1.20.4
    /-fabric-?\d+\.\d+.*$/i, // -fabric-0.5.8
  ];

  for (const pattern of versionPatterns) {
    const match = decoded.match(pattern);
    if (match) {
      decoded = decoded.slice(0, match.index);
      break;
    }
  }

  // Replace dashes and underscores with spaces
  decoded = decoded.replace(/[-_]+/g, " ");

  // Capitalize each word
  decoded = decoded
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  // Fix common mod name capitalizations
  const capitalizations: Record<string, string> = {
    "Fabric Api": "Fabric API",
    "Sodium": "Sodium",
    "Iris": "Iris Shaders",
    "Lithium": "Lithium",
    "Phosphor": "Phosphor",
    "Starlight": "Starlight",
    "Optifine": "OptiFine",
    "Optifabric": "OptiFabric",
  };

  for (const [key, value] of Object.entries(capitalizations)) {
    if (decoded.toLowerCase() === key.toLowerCase()) {
      return value;
    }
  }

  return decoded;
}

/**
 * Format a version string for display.
 * - Decodes URL-encoded characters
 * - Removes redundant "v" prefix if already present
 */
export function formatVersion(version: string | null | undefined): string | null {
  if (!version) return null;

  let decoded = version;
  try {
    decoded = decodeURIComponent(version);
  } catch {
    // If decoding fails, use original
  }

  // Remove leading 'v' if present (we add it back in display)
  decoded = decoded.replace(/^v/, "");

  return decoded;
}

/**
 * Format a file name for display (URL decode)
 */
export function formatFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}
