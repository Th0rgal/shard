import type { CSSProperties } from "react";

// Import official pixel art loader icons (with transparent backgrounds)
import fabricIcon from "../assets/icons/fabric.png";

export type LoaderType = "fabric" | "forge" | "neoforge" | "quilt" | "vanilla" | null;

interface LoaderIconProps {
  loader: LoaderType;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Displays an icon representing the mod loader type.
 * Uses official logos where possible, with translucent styling to match the UI theme.
 */
export function LoaderIcon({ loader, size = 18, className, style }: LoaderIconProps) {
  // For Fabric pixel art PNG - make it lighter while preserving detail
  // grayscale converts to gray, brightness makes it whiter, contrast preserves texture
  const fabricStyle: CSSProperties = {
    width: size * 1.2,
    height: size * 1.2,
    objectFit: "contain",
    imageRendering: "pixelated",
    filter: "grayscale(1) brightness(1.8) contrast(0.9)",
    opacity: 0.7,
    ...style,
  };

  // Common props for inline SVGs
  const svgProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    className,
    style: { opacity: 0.85, ...style },
  };

  switch (loader) {
    case "fabric":
      // Fabric: Official pixel art logo (transparent background)
      return (
        <img
          src={fabricIcon}
          alt="Fabric"
          className={className}
          style={fabricStyle}
        />
      );

    case "neoforge":
      // NeoForge: Fox head icon (inline SVG for proper theming)
      return (
        <svg {...svgProps}>
          {/* Fox face outline */}
          <path d="M12 4L6 8v4l2 2v4l4 2 4-2v-4l2-2V8l-6-4z" />
          {/* Ears */}
          <path d="M6 8L4 4l4 2M18 8l2-4-4 2" opacity="0.8" />
          {/* Inner ear details */}
          <path d="M7 7l1.5 1.5M17 7l-1.5 1.5" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
        </svg>
      );

    case "forge":
      // Forge: Anvil icon (inline SVG for currentColor support)
      return (
        <svg {...svgProps}>
          {/* Anvil top surface */}
          <path d="M4 9h16v3H4z" />
          {/* Anvil body */}
          <path d="M7 12v5h10v-5" />
          {/* Anvil base */}
          <path d="M9 17v2h6v-2" />
          {/* Anvil horns */}
          <path d="M2 9h3v2H2zM19 9h3v2h-3z" />
          {/* Hammer handle */}
          <path d="M11 5h2v4h-2z" />
        </svg>
      );

    case "quilt":
      // Quilt: 3x3 patchwork grid (inline SVG for currentColor support)
      return (
        <svg {...svgProps}>
          {/* Row 1 */}
          <rect x="3" y="3" width="5" height="5" rx="0.5" />
          <rect x="9.5" y="3" width="5" height="5" rx="0.5" />
          <rect x="16" y="3" width="5" height="5" rx="0.5" />
          {/* Row 2 */}
          <rect x="3" y="9.5" width="5" height="5" rx="0.5" />
          <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
          <rect x="16" y="9.5" width="5" height="5" rx="0.5" />
          {/* Row 3 */}
          <rect x="3" y="16" width="5" height="5" rx="0.5" />
          <rect x="9.5" y="16" width="5" height="5" rx="0.5" />
          {/* Bottom-right rotated diamond */}
          <rect x="16" y="16" width="5" height="5" rx="0.5" transform="rotate(45 18.5 18.5)" />
        </svg>
      );

    case "vanilla":
    default:
      // Vanilla: Isometric cube (Minecraft block style)
      return (
        <svg {...svgProps}>
          {/* Top face */}
          <path d="M12 3L4 7.5l8 4.5 8-4.5L12 3z" opacity="1" />
          {/* Left face */}
          <path d="M4 7.5v9l8 4.5V12L4 7.5z" opacity="0.6" />
          {/* Right face */}
          <path d="M20 7.5v9l-8 4.5V12l8-4.5z" opacity="0.8" />
        </svg>
      );
  }
}
