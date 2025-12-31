import clsx from "clsx";

export type Platform = "modrinth" | "curseforge" | "local" | null | undefined;

interface PlatformIconProps {
  platform: Platform;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

// Platform colors
const PLATFORM_COLORS = {
  modrinth: "#1bd96a",
  curseforge: "#f16436",
  local: "#94a3b8",
};

// Modrinth logo (official from modrinth.com)
function ModrinthIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 514" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M503.16 323.56c11.39-42.09 12.16-87.65.04-132.8C466.57 54.23 326.04-26.8 189.33 9.78 83.81 38.02 11.39 128.07.69 230.47h43.3c10.3-83.14 69.75-155.74 155.76-178.76 106.3-28.45 215.38 28.96 253.42 129.67l-42.14 11.27c-19.39-46.85-58.46-81.2-104.73-95.83l-7.74 43.84c36.53 13.47 66.16 43.84 77 84.25 15.8 58.89-13.62 119.23-67 144.26l11.53 42.99c70.16-28.95 112.31-101.86 102.34-177.02l41.98-11.23a210.2 210.2 0 0 1-3.86 84.16z"/>
      <path d="M321.99 504.22C185.27 540.8 44.75 459.77 8.11 323.24A257.6 257.6 0 0 1 0 275.46h43.27c1.09 11.91 3.2 23.89 6.41 35.83 3.36 12.51 7.77 24.46 13.11 35.78l38.59-23.15c-3.25-7.5-5.99-15.32-8.17-23.45-24.04-89.6 29.2-181.7 118.92-205.71 17-4.55 34.1-6.32 50.8-5.61L255.19 133c-10.46.05-21.08 1.42-31.66 4.25-66.22 17.73-105.52 85.7-87.78 151.84 1.1 4.07 2.38 8.04 3.84 11.9l49.35-29.61-14.87-39.43 46.6-47.87 58.9-12.69 17.05 20.99-27.15 27.5-23.68 7.45-16.92 17.39 8.29 23.07s16.79 17.84 16.82 17.85l23.72-6.31 16.88-18.54 36.86-11.67 10.98 24.7-38.03 46.63-63.73 20.18-28.58-31.82-49.82 29.89c25.54 29.08 63.94 45.23 103.75 41.86l11.53 42.99c-59.41 7.86-117.44-16.73-153.49-61.91l-38.41 23.04c50.61 66.49 138.2 99.43 223.97 76.48 61.74-16.52 109.79-58.6 135.81-111.78l42.64 15.5c-30.89 66.28-89.84 118.94-166.07 139.34"/>
    </svg>
  );
}

// CurseForge logo (simplified flame)
function CurseForgeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.326 9.214S20.996 11.586 21 13a5.738 5.738 0 0 1-1.74 4.09S17.15 19.55 13.5 20.5V22H6V11.5l2-1.5V8S5.158 8.516 4.5 10C3.842 11.484 3 13 3 15a9 9 0 0 0 9 9 9 9 0 0 0 9-9c0-2.5-2.5-5.786-2.674-5.786zM8.5 4.5S10 6 11 6a2.875 2.875 0 0 0 3-2.5C14 2 12.5 0 12.5 0S14 2 13 3.5C12 5 10.5 4.5 10.5 4.5 10.5 3.5 12 2 12 2S9 3 8.5 4.5z" />
    </svg>
  );
}

// Local/upload icon
function LocalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function PlatformIcon({ platform, size = "md", showLabel = false, className }: PlatformIconProps) {
  const iconSize = size === "sm" ? 12 : size === "lg" ? 20 : 16;
  const normalizedPlatform = platform?.toLowerCase() as Platform;

  const color = PLATFORM_COLORS[normalizedPlatform as keyof typeof PLATFORM_COLORS] || PLATFORM_COLORS.local;
  const label = normalizedPlatform === "modrinth" ? "Modrinth"
    : normalizedPlatform === "curseforge" ? "CurseForge"
    : "Local";

  const Icon = normalizedPlatform === "modrinth" ? ModrinthIcon
    : normalizedPlatform === "curseforge" ? CurseForgeIcon
    : LocalIcon;

  return (
    <span
      className={clsx("platform-icon", `platform-icon-${size}`, className)}
      style={{ color }}
      title={label}
    >
      <Icon size={iconSize} />
      {showLabel && <span className="platform-label">{label}</span>}
    </span>
  );
}

// Badge variant with background
export function PlatformBadge({ platform, className }: { platform: Platform; className?: string }) {
  const normalizedPlatform = platform?.toLowerCase() as Platform;
  const color = PLATFORM_COLORS[normalizedPlatform as keyof typeof PLATFORM_COLORS] || PLATFORM_COLORS.local;
  const label = normalizedPlatform === "modrinth" ? "Modrinth"
    : normalizedPlatform === "curseforge" ? "CurseForge"
    : "Local";

  return (
    <span
      className={clsx("platform-badge", className)}
      style={{
        backgroundColor: `${color}15`,
        color: color,
        borderColor: `${color}30`,
      }}
    >
      <PlatformIcon platform={platform} size="sm" />
      <span>{label}</span>
    </span>
  );
}

export { PLATFORM_COLORS };
