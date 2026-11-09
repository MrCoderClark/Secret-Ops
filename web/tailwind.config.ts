import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Mapped 1:1 to the CSS variables in globals.css. Components refer to
        // Tailwind names (bg-raised, text-ink-dim); a light-theme toggle later
        // only has to redefine the --* tokens, not touch component files.
        abyss:   "var(--bg-abyss)",
        slab:    "var(--bg-slab)",
        raised:  "var(--bg-raised)",
        inset:   "var(--bg-inset)",

        line:          "var(--line)",
        "line-strong": "var(--line-strong)",

        ink: {
          DEFAULT: "var(--ink)",
          dim:     "var(--ink-dim)",
          faint:   "var(--ink-faint)",
        },

        signal:       "var(--signal)",
        "signal-dim": "var(--signal-dim)",
        alert:        "var(--alert)",
        "alert-dim":  "var(--alert-dim)",
        stop:         "var(--stop)",
        "stop-dim":   "var(--stop-dim)",
        trace:        "var(--trace)",

        accent: {
          DEFAULT: "var(--accent)",
          dim:     "var(--accent-dim)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderColor: { DEFAULT: "var(--line)" },
      boxShadow: {
        card:   "0 1px 2px 0 rgb(0 0 0 / 0.35), 0 0 0 1px var(--line)",
        signal: "0 0 8px rgb(79 196 140 / 0.6)",
        accent: "0 0 10px rgb(208 255 76 / 0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
