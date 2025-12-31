module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"]
      },
      colors: {
        ink: "#0d0f12",
        smoke: "#15181d",
        slate: "#1d2228",
        mist: "#c9d1d9",
        haze: "#9aa6b2",
        accent: "#7cc7ff",
        accent2: "#f4b27f"
      },
      boxShadow: {
        soft: "0 20px 60px rgba(0,0,0,0.35)",
        glow: "0 0 0 1px rgba(124,199,255,0.2), 0 10px 30px rgba(0,0,0,0.35)"
      }
    }
  },
  plugins: []
};
