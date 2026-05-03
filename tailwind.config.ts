import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fc: {
          bg:      "#0E0B08",
          surface: "#1A1410",
          card:    "#211C17",
          border:  "#2E2720",
          orange:  "#F06030",
          "orange-dim": "rgba(240,96,48,0.12)",
          gold:    "#E8A830",
          cream:   "#F5EDD8",
          muted:   "#7A6E65",
          green:   "#3DD68C",
        },
      },
      fontFamily: {
        syne:  ["Syne", "sans-serif"],
        serif: ["Instrument Serif", "serif"],
        sans:  ["DM Sans", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
