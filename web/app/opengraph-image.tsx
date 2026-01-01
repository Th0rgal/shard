import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Shard Launcher - A minimal, content-addressed Minecraft launcher";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0c0b0a 0%, #181716 50%, #0c0b0a 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Ambient glow effects */}
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "15%",
            width: "400px",
            height: "400px",
            background: "radial-gradient(circle, rgba(232, 168, 85, 0.15) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "10%",
            right: "15%",
            width: "350px",
            height: "350px",
            background: "radial-gradient(circle, rgba(244, 178, 127, 0.1) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* Logo placeholder - amber cube icon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "120px",
            height: "120px",
            marginBottom: "32px",
            background: "linear-gradient(135deg, #e8a855 0%, #f0bc6f 100%)",
            borderRadius: "24px",
            boxShadow: "0 8px 32px rgba(232, 168, 85, 0.3), 0 0 80px rgba(232, 168, 85, 0.15)",
          }}
        >
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: "72px",
            fontWeight: 700,
            color: "#f5f0eb",
            marginBottom: "16px",
            letterSpacing: "-0.02em",
          }}
        >
          Shard Launcher
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "28px",
            fontWeight: 400,
            color: "rgba(245, 240, 235, 0.6)",
            marginBottom: "48px",
            letterSpacing: "-0.01em",
          }}
        >
          One library. Infinite profiles.
        </div>

        {/* Features row */}
        <div
          style={{
            display: "flex",
            gap: "48px",
          }}
        >
          {["Deduplicated Storage", "Reproducible Profiles", "Open Source"].map(
            (feature) => (
              <div
                key={feature}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  color: "rgba(245, 240, 235, 0.5)",
                  fontSize: "20px",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    background: "#e8a855",
                    borderRadius: "50%",
                  }}
                />
                {feature}
              </div>
            )
          )}
        </div>

        {/* Bottom URL */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            fontSize: "18px",
            color: "rgba(245, 240, 235, 0.3)",
            letterSpacing: "0.05em",
          }}
        >
          shard.thomas.md
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
