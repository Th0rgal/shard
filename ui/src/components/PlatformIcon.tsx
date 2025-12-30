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

// Modrinth logo (simplified)
function ModrinthIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="currentColor">
      <path d="M503.16 323.56C514.55 281.47 515.32 235.91 503.2 190.76C466.57 54.2299 326.04 -26.8001 189.33 9.77991C83.8101 38.0199 11.3899 128.07 0.689941 230.47H43.99C54.29 147.33 113.74 74.7298 199.75 51.7098C306.05 23.2598 415.13 80.6699 453.17 181.38L411.03 192.65C391.64 145.8 352.57 111.45 306.3 96.8198L298.56 140.66C335.09 154.13 364.72 184.5 375.56 224.91C391.36 283.8 361.94 344.14 308.56 369.17L320.09 412.16C390.25 383.21 432.4 310.3 422.43 235.14L464.41 223.91C468.91 252.62 467.35 281.16 460.55 308.07L503.16 323.56Z" />
      <path d="M321.99 415.63L310.45 372.64C276.24 384.23 237.13 380.22 206.01 359.25L185.43 398.92C227.58 426.76 281.27 429.93 321.99 415.63Z" />
      <path d="M150.47 374.98L171.24 335.17C147.93 315.9 133.46 288.23 130.32 257.54H87.0601C90.0901 299.09 112.05 339.09 150.47 374.98Z" />
      <path d="M206.01 359.25C175.04 338.39 156.03 304.61 154.21 268.14L111.0699 270.02C112.95 320.15 143.14 366.67 185.43 398.92L206.01 359.25Z" />
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
