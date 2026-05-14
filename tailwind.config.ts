// Tailwind v4 uses CSS-first configuration via the @theme directive in
// app/globals.css (which imports app/theme.css for the M3 token roles
// generated from the Deep Teal #0F766E seed). This config file exists for
// HVA-12 acceptance-criteria visibility and to register the `class`-based
// dark-mode strategy + content paths for tooling that still scans this file.
//
// The actual color, radius, and font tokens live in CSS — do not duplicate
// them here. Regenerate the M3 layer with `pnpm m3:generate`.

import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
};

export default config;
