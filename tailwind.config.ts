import type { Config } from "tailwindcss";

// ============================================================
// Mise — the theme (Part 33)
// ============================================================
// ครีม · ข้าวสาลี · เสจ · โอลีฟเข้ม — #F8F3E1 #E3DBBB #AEB784 #41431B
//
// All four values Kong chose have a job, and none of them is decoration:
// cream is the sunk surface, wheat is the divider and emphasis band, sage is
// the translucent highlight, and deep olive is the brand. The ink had to be
// added — none of the four is dark enough to set a table of money in.
//
// WHY WARM AND NOT BLUE. Checked against the competition on 2026-09-02:
// MarketMan is teal + blue on white, which is the default look of every SaaS
// on earth, and Wongnai's brand is #0070A8. The ink-blue theme this file used
// to hold stood exactly there. FoodStory owns saturated orange. A desaturated
// warm palette used TONALLY — the whole surface, not one accent — is the one
// register none of them occupy.
//
// 🔴 TWO RULES THIS FILE EXISTS TO ENFORCE
//
// 1. `good` and `bad` mean GOOD OR BAD FOR THE SHOP, never up or down. Mise
//    shows cost and revenue on one screen: revenue rising is good and cost
//    rising is bad, so a colour tied to direction would mean opposite things
//    in two adjacent tables.
//
// 2. THERE IS NO `info` AND NO BLUE. There are three verdicts and nothing
//    else; anything that is not a verdict is warm grey. This is not taste —
//    every `sky`/`blue` left in the codebase turned out to be a neutral state
//    ("ราคาเฉพาะสาขานี้", "สร้างอัตโนมัติจากใบรับของ"), and in two of them the
//    sibling chip beside it was already `muted`. They were blue because there
//    was nowhere else to go, not because blue meant anything.
//
// Reaching for a raw Tailwind palette colour in a component — `text-red-700`,
// `bg-amber-50` — takes that screen out of the system.
// ============================================================

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        /** Cream, one step lighter than the sunk surface. The page ground. */
        background: "#FDFBF3",
        /** The ink Kong's four colours did not contain. Warm near-black. */
        foreground: "#262811",

        surface: {
          DEFAULT: "#FFFFFF",
          /** #F8F3E1 exactly — table heads, quiet strips, recessed rows. */
          sunk: "#F8F3E1",
        },

        /** #E3DBBB exactly — dividers and emphasis bands. */
        wash: "#E3DBBB",

        /** Chrome and primary actions. */
        primary: {
          DEFAULT: "#41431B",
          foreground: "#F8F3E1",
          /** For text and hover states that need to go darker than the brand. */
          deep: "#2C2E10",
          soft: "#EFEDD7",
          line: "#C7CC9B",
        },

        muted: {
          DEFAULT: "#F3EFDF",
          foreground: "#5A5C31",
          /** The quietest legible ink — captions, units, disabled. */
          subtle: "#8B8D63",
        },

        border: {
          DEFAULT: "#E9E3C8",
          strong: "#D2CBA4",
        },

        /** #AEB784 exactly. Only ever used through `highlight` below. */
        sage: "#AEB784",

        /**
         * THE HIGHLIGHT. Translucent on purpose — the grid lines and the
         * surface underneath show THROUGH it. It is not a gradient and it is
         * not a card: it hugs the one row that matters. If everything is
         * highlighted, nothing is.
         */
        highlight: "rgb(174 183 132 / 0.26)",
        "highlight-soft": "rgb(174 183 132 / 0.14)",

        /** GOOD FOR THE SHOP — profit, in stock, coverage complete, counted. */
        good: {
          DEFAULT: "#5A7333",
          foreground: "#FFFFFF",
          bg: "#EEF2DD",
          border: "#C0CD95",
        },

        /** BAD FOR THE SHOP — money gone, short, negative stock, refusal. */
        bad: {
          DEFAULT: "#A83A22",
          foreground: "#FFFFFF",
          bg: "#F9E5DF",
          border: "#E9B7A7",
        },

        /** NEEDS ATTENTION but nothing is lost yet — partial coverage, stale. */
        warn: {
          DEFAULT: "#A87C1C",
          foreground: "#FFFFFF",
          bg: "#F8EFD6",
          border: "#E2CE97",
        },
      },

      fontFamily: {
        /** Body and tables. Narrower than Prompt, so dense rows still fit. */
        sans: ["var(--font-sans)", "Noto Sans Thai", "system-ui", "sans-serif"],
        /** Headings and figures. Geometric, rounded, modern without playing. */
        display: ["var(--font-display)", "Prompt", "system-ui", "sans-serif"],
        /** Ids and codes only. */
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },

      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
      },

      boxShadow: {
        /** One elevation only. A back office does not need a z-axis. */
        card: "0 1px 2px rgb(38 40 17 / .05), 0 12px 28px -22px rgb(38 40 17 / .3)",
      },
    },
  },
  plugins: [],
};

export default config;
