// ============================================================
// คิดครัว — the doodle layer (pilot on /login, 2026-09-27)
// ============================================================
// Sketch-note drawings that make the product feel like a kitchen notebook
// rather than accounting software.
//
// 🔴 THE LINE THIS FILE MUST NOT CROSS: doodles DECORATE, they never carry
// data. Nothing here goes near a table, a figure, an input or a button — a
// cost that looks hand-drawn is a cost nobody trusts. Login, empty states,
// loading and error pages are where they belong.
//
// How the hand-drawn look is made, in two moves:
//   · fills are OFFSET from their outlines (a few units down-right), the way
//     a marker wash never lands exactly inside the pen line
//   · a small turbulence displacement (`WOBBLE`) bends every stroke, so no
//     line is geometrically straight. Scale is kept low on purpose — past ~3
//     it stops looking hand-drawn and starts looking broken.
//
// Colours come from the theme tokens only (primary ink, sage, wheat), plus
// the logo's mustard for rice so a grain here is the same grain as the mark.
// `bad`/`good`/`warn` are verdicts and are never decoration (tailwind.config.ts).
// ============================================================

/** Same mustard as the grain in Logo.tsx. */
const SEED = "#A87C1C";

const ink = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The wobble filter. Every SVG declares its own copy so none depends on
 *  another being on the page; ids are per-drawing to avoid collisions. */
function Wobble({ id, scale = 2.4 }: { id: string; scale?: number }) {
  return (
    <defs>
      <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
        <feDisplacementMap in="SourceGraphic" scale={scale} />
      </filter>
    </defs>
  );
}

function Grain({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <path
        d="M0,-8 C3.6,-5 4.8,-2 4.8,0.6 C4.8,4.2 2.8,7.2 0,8 C-2.8,7.2 -4.8,4.2 -4.8,0.6 C-4.8,-2 -3.6,-5 0,-8 Z"
        fill={SEED}
        fillOpacity={0.85}
      />
      <path d="M0,-4 C0.8,-1.5 0.8,1.5 0,4" stroke="#FDFBF3" strokeWidth={1.1} fill="none" strokeLinecap="round" />
    </g>
  );
}

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} {...ink} strokeWidth={2 / s}>
      <path d="M0,-7 L0,7 M-7,0 L7,0" />
      <path d="M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5" strokeOpacity={0.45} />
    </g>
  );
}

/**
 * The login scene: a pot with steam, the stock notebook, a green chilli, a
 * leaf, a baht coin and loose grains of rice — what the product is about,
 * drawn the way a cook would scribble it on the back of an order pad.
 */
export function KitchenDoodle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 260"
      className={`text-primary ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <Wobble id="doodle-wobble-kitchen" />
      <g filter="url(#doodle-wobble-kitchen)">
        {/* ground scribble */}
        <path {...ink} strokeOpacity={0.5} d="M34 236 C 86 231, 140 239, 196 233 S 268 236, 290 231" />

        {/* ---- the notebook (stock count), tilted ---- */}
        <g transform="rotate(-9 70 80)">
          <path className="fill-wash" d="M34 36 L104 33 L107 124 L37 127 Z" transform="translate(5 5)" />
          <path {...ink} d="M34 36 L104 33 L107 124 L37 127 Z" />
          {/* spiral rings */}
          <path {...ink} strokeWidth={2} d="M48 28 v12 M64 27 v12 M80 27 v12 M96 26 v12" />
          {/* checked lines */}
          <path {...ink} strokeWidth={2} d="M46 58 l4 4 l7 -9" />
          <path {...ink} strokeWidth={2} strokeOpacity={0.6} d="M63 58 H96" />
          <path {...ink} strokeWidth={2} d="M47 80 l4 4 l7 -9" />
          <path {...ink} strokeWidth={2} strokeOpacity={0.6} d="M64 80 H92" />
          <path {...ink} strokeWidth={2} strokeOpacity={0.6} d="M47 101 h8" />
          <path {...ink} strokeWidth={2} strokeOpacity={0.6} d="M64 101 H98" />
        </g>

        {/* ---- baht coin ---- */}
        <circle cx="266" cy="58" r="21" className="fill-sage/45" transform="translate(4 4)" />
        <circle {...ink} cx="266" cy="58" r="21" />
        <circle {...ink} strokeWidth={1.6} strokeOpacity={0.5} cx="266" cy="58" r="15" />
        <text
          x="266"
          y="66"
          textAnchor="middle"
          className="fill-current font-display"
          fontSize="22"
          fontWeight={600}
        >
          ฿
        </text>

        {/* ---- steam ---- */}
        <path {...ink} strokeOpacity={0.7} d="M136 132 C 126 120, 146 110, 137 96 C 129 85, 142 76, 139 66" />
        <path {...ink} strokeOpacity={0.7} d="M166 128 C 157 114, 177 104, 168 88 C 161 77, 172 68, 170 58" />
        <path {...ink} strokeOpacity={0.7} d="M196 132 C 187 120, 205 111, 198 98" />

        {/* ---- the pot ---- */}
        <path
          className="fill-sage/55"
          transform="translate(6 6)"
          d="M78 150 C 80 200, 108 222, 166 223 C 226 224, 252 198, 254 152 Z"
        />
        <path {...ink} strokeWidth={2.8} d="M78 150 C 80 200, 108 222, 166 223 C 226 224, 252 198, 254 152" />
        {/* rim, drawn twice — the second pass is the pen going back over it */}
        <path {...ink} strokeWidth={2.8} d="M68 148 C 118 142, 212 141, 264 147" />
        <path {...ink} strokeWidth={1.6} strokeOpacity={0.45} d="M71 152 C 120 147, 210 146, 261 151" />
        {/* handles */}
        <path {...ink} d="M79 160 C 60 157, 55 172, 76 176" />
        <path {...ink} d="M253 160 C 272 157, 277 172, 256 176" />
        {/* a band of hatching across the belly */}
        <path {...ink} strokeWidth={1.6} strokeOpacity={0.4} d="M104 196 l10 -12 M122 204 l12 -14 M142 208 l12 -14 M162 209 l12 -14 M182 208 l12 -14 M202 204 l11 -13" />

        {/* ---- green chilli ---- */}
        <g transform="translate(8 -16) rotate(14 282 150)">
          <path className="fill-sage" transform="translate(3 3)" d="M270 130 C 290 132, 300 158, 292 188 C 288 170, 278 150, 266 140 Z" />
          <path {...ink} d="M270 130 C 290 132, 300 158, 292 188 C 288 170, 278 150, 266 140 Z" />
          <path {...ink} d="M268 134 C 266 126, 260 122, 262 114" />
        </g>

        {/* ---- leaf ---- */}
        <g transform="rotate(-30 36 190)">
          <path className="fill-sage/70" transform="translate(3 3)" d="M16 190 C 26 170, 50 170, 60 190 C 50 208, 26 208, 16 190 Z" />
          <path {...ink} d="M16 190 C 26 170, 50 170, 60 190 C 50 208, 26 208, 16 190 Z" />
          <path {...ink} strokeWidth={1.6} d="M12 190 H56 M30 190 l6 -7 M40 190 l6 -7 M30 190 l6 7 M40 190 l6 7" />
        </g>
      </g>

      {/* grains and sparkles stay crisp — they are the logo's own vocabulary */}
      <Grain x={122} y={40} r={-25} />
      <Grain x={208} y={30} r={30} />
      <Grain x={226} y={112} r={-10} />
      <Grain x={30} y={150} r={40} />
      <Sparkle x={196} y={70} s={0.9} />
      <Sparkle x={300} y={104} s={0.7} />
      <Sparkle x={136} y={20} s={0.6} />
    </svg>
  );
}

/** A marker stroke to sit under a heading. Stretches to the word's width. */
export function MarkerUnderline({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 140 12"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 8 C 35 4, 70 9, 100 5 S 132 6, 137 4"
        fill="none"
        className="stroke-sage"
        strokeOpacity={0.8}
        strokeWidth={6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A small curling arrow, for a margin note that points at something. */
export function CurlArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 36" className={`text-muted-foreground ${className ?? ""}`} aria-hidden="true" focusable="false">
      <path {...ink} strokeWidth={1.8} d="M40 6 C 28 2, 14 6, 16 16 C 18 24, 30 20, 24 14 C 18 8, 8 18, 6 30" />
      <path {...ink} strokeWidth={1.8} d="M1 24 L6 31 L12 25" />
    </svg>
  );
}

/** The letter on its way — replaces the 📧 on the "check your email" state. */
export function EnvelopeDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={`text-primary ${className ?? ""}`} aria-hidden="true" focusable="false">
      <Wobble id="doodle-wobble-envelope" scale={2} />
      <g filter="url(#doodle-wobble-envelope)">
        {/* speed lines */}
        <path {...ink} strokeWidth={2} strokeOpacity={0.5} d="M6 30 H22 M2 42 H20 M8 54 H24" />
        <path className="fill-wash" transform="translate(4 4)" d="M34 18 L110 16 L112 66 L36 68 Z" />
        <path {...ink} d="M34 18 L110 16 L112 66 L36 68 Z" />
        <path {...ink} d="M35 20 L72 46 L109 18" />
        <path {...ink} strokeWidth={1.6} strokeOpacity={0.5} d="M36 66 L62 44 M111 64 L84 43" />
      </g>
      <Grain x={72} y={8} r={20} />
    </svg>
  );
}
