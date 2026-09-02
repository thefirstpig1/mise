// ============================================================
// Mise — the mark (Part 33)
// ============================================================
// A percent sign whose upper ring is a grain of rice and whose lower ring is
// a bowl. Two shapes carrying three meanings:
//
//   · the grain      — the seed AND the food, which is why two shapes suffice
//   · the diagonal   — food cost %, the one number an owner remembers
//   · the bowl       — the diagonal curves INTO it without the pen lifting,
//                      so "food" arrives without adding a third shape
//
// 🔴 THE GROOVE IS DROPPED BELOW 28px ON PURPOSE. The slot through the grain
// is ~1.9 units wide at render scale; under 28px that is thinner than one
// device pixel and renders as a smear rather than a line. Dropping it leaves
// a plain oval — which is exactly what a percent sign's upper ring is, so the
// mark does not degrade, it just becomes a different true reading of itself.
//
// Stroke weight GOES UP as the mark shrinks (`weightFor`). A line mark scaled
// down keeps its proportions and loses its presence; optical sizing is the
// standard fix and it is why this is a component and not a static file.
// ============================================================

/** The grain body. Pointed at both ends, fuller at the base. */
const RICE_BODY =
  "M0,-11 C4.8,-7.2 6.5,-3 6.5,0.8 C6.5,5.6 3.9,9.8 0,11 C-3.9,9.8 -6.5,5.6 -6.5,0.8 C-6.5,-3 -4.8,-7.2 0,-11 Z";

/** The groove. A hole punched with evenodd — never a line drawn on top, so it
 *  survives a recolour and never needs a third colour. */
const RICE_SLOT =
  "M0,-6.4 C1.35,-3.2 1.35,3.2 0,6.4 C-1.35,3.2 -1.35,-3.2 0,-6.4 Z";

/** One path, one M: the diagonal runs straight into the bowl, no pen lift. */
const STROKE_D = "M37.5,9.5 L19.5,30.5 A9.5,9.5 0 0 0 38.5,30.5";

const TONES = {
  /** on paper, white, or wheat */
  light: { line: "#41431B", seed: "#A87C1C" },
  /** on the olive brand ground — the mustard is lifted or it sinks into it */
  dark: { line: "#F8F3E1", seed: "#D9AC42" },
} as const;

const weightFor = (s: number) =>
  s >= 90 ? 5.2 : s >= 48 ? 5.4 : s >= 28 ? 5.8 : 6.4;

const grooveAt = (s: number) => s >= 28;

export type LogoProps = {
  /** Rendered size in px. Drives both the stroke weight and the groove. */
  size?: number;
  tone?: keyof typeof TONES;
  className?: string;
  /** Force the groove on or off. Only for previews — leave it alone in the app. */
  groove?: boolean;
};

export default function Logo({
  size = 28,
  tone = "light",
  className,
  groove,
}: LogoProps) {
  const { line, seed } = TONES[tone];
  const showGroove = groove ?? grooveAt(size);
  const d = showGroove ? `${RICE_BODY} ${RICE_SLOT}` : RICE_BODY;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Mise"
    >
      <path
        d={STROKE_D}
        fill="none"
        stroke={line}
        strokeWidth={weightFor(size)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={d}
        fill={seed}
        fillRule="evenodd"
        transform="translate(13,14) rotate(-16) scale(0.7)"
      />
    </svg>
  );
}
