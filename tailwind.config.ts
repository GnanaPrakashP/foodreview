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
          bg:      "var(--bg)",
          surface: "var(--surface)",
          card:    "var(--card)",
          border:  "var(--border)",
          orange:  "var(--orange)",
          "orange-dim": "var(--orange-dim)",
          gold:    "var(--gold)",
          cream:   "var(--cream)",
          muted:   "var(--muted)",
          green:   "var(--green)",
          "on-green": "var(--on-green)",
        },
      },
      fontFamily: {
        sans: ["DM Sans", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
