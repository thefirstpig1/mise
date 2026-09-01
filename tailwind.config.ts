import type { Config } from "tailwindcss";

// ============================================================
// Mise — the theme (Part 33)
// ============================================================
// The direction is A LEDGER YOU CAN TRUST: cool paper, ink-blue chrome,
// figures as the loudest thing on the page. Chosen over a warm kitchen look
// because the pages people actually stare at are dense tables of money, and
// the product's whole claim is that its numbers can be believed.
//
// 🔴 THE RULE THAT MATTERS MOST — `good` and `bad` mean GOOD OR BAD FOR THE
// SHOP, never up or down. Mise shows cost and revenue on the same screen:
// revenue rising is good and cost rising is bad, so a colour tied to
// direction would mean opposite things in two adjacent tables. This is the
// mistake in the Apps Script dashboard Kong built (its `.up` is red and
// `.down` is green, applied to SALES growth — classes designed for cost and
// reused), and naming the tokens after the verdict rather than the arrow is
// what stops it happening here.
//
// Every screen already speaks in these names (`bg-primary`,
// `text-muted-foreground`, `border-border`), so this file is where the theme
// lives. Reaching for a raw Tailwind palette colour in a component —
// `text-red-700`, `bg-amber-50` — takes that screen out of the system and is
// what Part 32 accidentally did before this existed.
// ============================================================

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        /** Cool paper — the page behind everything. */
        background: "hsl(216 25% 97%)",
        /** Ink. Blue-black rather than grey-black, so it belongs to the blue. */
        foreground: "hsl(216 31% 13%)",

        /** Raised sheets: cards, tables, panels. */
        surface: {
          DEFAULT: "hsl(0 0% 100%)",
          /** Recessed rows — table heads, totals, quiet strips. */
          sunk: "hsl(216 25% 95%)",
        },

        /** Chrome and primary actions. */
        primary: {
          DEFAULT: "hsl(212 52% 25%)",
          foreground: "hsl(0 0% 100%)",
        },

        muted: {
          DEFAULT: "hsl(215 27% 95%)",
          foreground: "hsl(215 14% 41%)",
        },

        border: {
          DEFAULT: "hsl(215 25% 89%)",
          strong: "hsl(214 20% 79%)",
        },

        /** GOOD FOR THE SHOP — profit, in stock, coverage complete, counted. */
        good: {
          DEFAULT: "hsl(165 68% 28%)",
          foreground: "hsl(0 0% 100%)",
          bg: "hsl(165 40% 93%)",
          /** A tint strong enough to read as an edge, not as a fill. */
          border: "hsl(165 35% 76%)",
        },

        /** BAD FOR THE SHOP — money gone, short, negative stock, refusal. */
        bad: {
          DEFAULT: "hsl(9 63% 43%)",
          foreground: "hsl(0 0% 100%)",
          bg: "hsl(9 60% 95%)",
          border: "hsl(9 55% 82%)",
        },

        /** NEEDS ATTENTION but nothing is lost yet — partial coverage, stale. */
        warn: {
          DEFAULT: "hsl(38 76% 34%)",
          foreground: "hsl(0 0% 100%)",
          bg: "hsl(40 72% 93%)",
          border: "hsl(40 62% 76%)",
        },
      },

      fontFamily: {
        sans: ["var(--font-sans)", "IBM Plex Sans Thai", "system-ui", "sans-serif"],
        /** Figures, ids, and anything meant to be read as data. */
        mono: ["var(--font-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
      },

      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
      },

      boxShadow: {
        /** One elevation only. A back office does not need a z-axis. */
        card: "0 1px 2px hsl(216 31% 13% / .04), 0 12px 28px -22px hsl(216 31% 13% / .35)",
      },
    },
  },
  plugins: [],
};

export default config;
