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
        // Mapped one-to-one to the CSS variables in globals.css. Components
        // refer to Tailwind names (bg-surface-raised, text-fg-muted) so the
        // dark/light swap is a token-file concern, not a component concern.
        surface: {
          DEFAULT: "var(--surface-base)",
          base:    "var(--surface-base)",
          raised:  "var(--surface-raised)",
          hover:   "var(--surface-hover)",
          sunken:  "var(--surface-sunken)",
        },
        border: {
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
        fg: {
          primary:   "var(--fg-primary)",
          secondary: "var(--fg-secondary)",
          muted:     "var(--fg-muted)",
          "on-accent": "var(--fg-on-accent)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover:   "var(--accent-hover)",
          soft:    "var(--accent-soft)",
        },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        warn:    { DEFAULT: "var(--warn)",    soft: "var(--warn-soft)" },
        danger:  { DEFAULT: "var(--danger)",  soft: "var(--danger-soft)" },
        info:    { DEFAULT: "var(--info)",    soft: "var(--info-soft)" },
      },
      borderColor: {
        DEFAULT: "var(--border-subtle)",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.25), 0 0 0 1px var(--border-subtle)",
      },
    },
  },
  plugins: [],
};
export default config;
