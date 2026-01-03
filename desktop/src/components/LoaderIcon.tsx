import type { CSSProperties } from "react";

// Import official loader icons
import fabricIcon from "../assets/icons/fabric.png";
import forgeIcon from "../assets/icons/forge.png";
import neoforgeIcon from "../assets/icons/neoforge.png";
import quiltIcon from "../assets/icons/quilt.png";

export type LoaderType = "fabric" | "forge" | "neoforge" | "quilt" | "vanilla" | null;

interface LoaderIconProps {
  loader: LoaderType;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Displays an icon representing the mod loader type.
 * Uses official logos with grayscale filter to match the UI theme.
 */
export function LoaderIcon({ loader, size = 18, className, style }: LoaderIconProps) {
  // Base style for PNG icons - grayscale with brightness to make them lighter
  // This preserves detail while making them fit the UI theme
  const pngStyle: CSSProperties = {
    width: size,
    height: size,
    objectFit: "contain",
    filter: "grayscale(1) brightness(1.8) contrast(0.9)",
    opacity: 0.75,
    ...style,
  };

  // Pixel art icons need pixelated rendering
  const pixelArtStyle: CSSProperties = {
    ...pngStyle,
    imageRendering: "pixelated",
    width: size * 1.1,
    height: size * 1.1,
  };

  // Common props for inline SVGs (used for vanilla)
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
          style={pixelArtStyle}
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
      // Forge: Official anvil icon
      return (
        <img
          src={forgeIcon}
          alt="Forge"
          className={className}
          style={pngStyle}
        />
      );

    case "quilt":
      // Quilt: Official patchwork logo
      return (
        <img
          src={quiltIcon}
          alt="Quilt"
          className={className}
          style={pngStyle}
        />
      );

    case "vanilla":
    default:
      // Vanilla: Isometric cube (Minecraft block style) - no official icon
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
