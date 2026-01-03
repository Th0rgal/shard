import type { CSSProperties } from "react";

// Import official pixel art loader icons
import fabricIcon from "../assets/icons/fabric.png";
import neoforgeIcon from "../assets/icons/neoforge.png";

export type LoaderType = "fabric" | "forge" | "neoforge" | "quilt" | "vanilla" | null;

interface LoaderIconProps {
  loader: LoaderType;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Displays an icon representing the mod loader type.
 * Uses official loader logos converted to translucent white to match the UI theme.
 */
export function LoaderIcon({ loader, size = 18, className, style }: LoaderIconProps) {
  // For pixel art PNGs - make them white/translucent
  // brightness(0) makes it black, then invert(1) makes it white, then reduce opacity
  const pixelArtStyle: CSSProperties = {
    width: size,
    height: size,
    objectFit: "contain",
    imageRendering: "pixelated",
    filter: "brightness(0) invert(1)",
    opacity: 0.85,
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
      // Fabric: Official pixel art logo - larger size for visibility
      return (
        <img
          src={fabricIcon}
          alt="Fabric"
          className={className}
          style={{ ...pixelArtStyle, width: size * 1.2, height: size * 1.2 }}
        />
      );

    case "neoforge":
      // NeoForge: Official fox icon (pixel art)
      return (
        <img
          src={neoforgeIcon}
          alt="NeoForge"
          className={className}
          style={pixelArtStyle}
        />
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
