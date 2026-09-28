// ============================================================
// Mise — one look for every chart (Kong, 2026-09-28)
// ============================================================
// Kong: "สีกราฟไม่ผ่านเลย ดูน่าเบื่อมาก … อนิเมชั่นกราฟตอนรีเซ็ตไม่มีเลย ทุกกราฟ".
// Every bar was one flat olive, lines were bare strokes, and nothing moved.
//
// What changed, in one place so no chart drifts again:
//  - **Depth, not more hues.** Each series colour is a vertical gradient (full
//    at the top, lighter at the base), so bars read as objects instead of
//    blocks. Lines get a soft gradient area beneath them.
//  - **One accent.** Terracotta marks the thing a chart exists to point at —
//    the best day, the chosen day, the hovered bar. Everything else stays in
//    the brand's olive family, so the accent is never lost in noise.
//  - **Motion on every chart.** Recharts' default is `"auto"`, and in practice
//    the bars simply appeared. Bars grow up from the axis, lines draw from the
//    left, and a new filter re-plays it (callers key the chart by its data).
//  - **Categories** get a fixed earthy palette in a fixed order, so a category
//    keeps its colour from the share list into the popup.
//
// Status colours (good/bad) still mean good/bad for the shop and nothing else.
// ============================================================

export const INK = "#262811";
export const INK_MUTED = "#5A5C31";
export const GRID = "#ECE6CC";
export const GOOD = "#5A7333";
export const BAD = "#A83A22";
export const NEUTRAL = "#8B8D63";

/** The brand family and the one accent. [top of gradient, base of gradient]. */
export const TONES = {
  olive: ["#5E6B14", "#9DAA55"],
  sage: ["#AEB784", "#D6DBB8"],
  clay: ["#C0692B", "#E8A76F"],
  teal: ["#00857B", "#5CC2B6"],
  plum: ["#8A4F9E", "#C39AD1"],
  mustard: ["#B8900F", "#E7C860"],
  good: ["#5A7333", "#A3BA73"],
  bad: ["#A83A22", "#DD8A74"],
  /** "Everything" — the brand ink, never a category's colour. */
  ink: ["#41431B", "#8B8D63"],
} as const;
export type Tone = keyof typeof TONES;

/**
 * One colour per BRANCH, fixed order. It lives here and not in Charts.tsx
 * because that file is "use client": a Server Component importing a constant
 * from it receives a client reference, not the array — every branch colour
 * came out `undefined` and Recharts drew its default blue.
 */
export const SERIES = ["#5E6B14", "#8A4F9E", "#C0692B", "#00857B", "#B8900F"] as const;

/** Categorical — fixed order, never cycled within a chart. */
export const CATEGORY_TONES: Tone[] = ["olive", "clay", "teal", "plum", "mustard", "sage", "good", "bad"];
export const toneOf = (i: number): Tone => CATEGORY_TONES[i % CATEGORY_TONES.length];
export const solid = (t: Tone) => TONES[t][0];

/** Spread onto any Bar / Line / Area. */
export const ANIM = {
  isAnimationActive: true,
  animationBegin: 0,
  animationDuration: 850,
  animationEasing: "ease-out",
} as const;

export const axis = { stroke: GRID, tick: { fill: INK_MUTED, fontSize: 12 }, tickLine: false } as const;

export const cursorFill = { fill: "rgb(174 183 132 / 0.16)", radius: 6 } as const;

/** `url(#id)` for a gradient declared by <ChartGradients>. */
export const grad = (t: Tone, dir: "v" | "h" = "v") => `url(#mise-${dir}-${t})`;

/**
 * Put inside a chart (Recharts renders unknown children into the SVG). Every
 * tone in both directions — the ids are global, so declaring them twice on a
 * page is harmless.
 */
export function ChartGradients() {
  return (
    <defs>
      {(Object.keys(TONES) as Tone[]).flatMap((t) => [
        <linearGradient key={`v-${t}`} id={`mise-v-${t}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONES[t][0]} stopOpacity={1} />
          <stop offset="100%" stopColor={TONES[t][1]} stopOpacity={0.9} />
        </linearGradient>,
        <linearGradient key={`h-${t}`} id={`mise-h-${t}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={TONES[t][1]} stopOpacity={0.9} />
          <stop offset="100%" stopColor={TONES[t][0]} stopOpacity={1} />
        </linearGradient>,
        <linearGradient key={`a-${t}`} id={`mise-a-${t}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONES[t][0]} stopOpacity={0.32} />
          <stop offset="100%" stopColor={TONES[t][0]} stopOpacity={0.02} />
        </linearGradient>,
      ])}
    </defs>
  );
}

/** The soft area under a line. */
export const areaFill = (t: Tone) => `url(#mise-a-${t})`;

export function ChartTooltip({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  return (
    <div className="min-w-[10rem] rounded-xl border border-border bg-surface/95 px-3.5 py-2.5 text-sm shadow-lg backdrop-blur">
      <p className="mb-1.5 font-display font-medium text-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 py-0.5 text-foreground">
          {r.color ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} /> : null}
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-4 font-medium tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
