// คิดครัว — หน้าแรก: small server-safe pieces shared by the page and its
// client parts. No "use client" here (mise-ui-review §7: a value imported from
// a client file into a server page arrives as a reference, not a value).

import type { CSSProperties, ReactNode } from "react";
import type { IconKey } from "./content";

const PATHS: Record<IconKey, ReactNode> = {
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  star: <path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8z" />,
  coin: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 8h3.5a2 2 0 0 1 0 4H9.5h4a2 2 0 0 1 0 4H9.5zM11 6.5v11" /></>,
  menu: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  pie: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
  truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12.2l2.2 2.2 4.3-4.6" /></>,
  plug: <path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0zM12 17v4" />,
  sprout: <><path d="M12 21v-8" /><path d="M12 13c0-4 3-6.5 7.5-6.5 0 4.5-3 6.5-7.5 6.5zM12 15c0-3.3-2.5-5.5-6.5-5.5 0 3.8 2.5 5.5 6.5 5.5z" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  upload: <><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4.5 14.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-4.5" /></>,
  export: <><rect x="4" y="3.5" width="12" height="17" rx="2" /><path d="M8 8h4M8 12h4M14 15.5h6.5M18 13l2.5 2.5L18 18" /></>,
};

export function Icon({ k }: { k: IconKey }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      {PATHS[k]}
    </svg>
  );
}

/** Thai has no spaces inside words: break a heading only where the writer put one. */
export function Phrases({ t }: { t: string }) {
  return (
    <>
      {t.split(/( +)/).map((part, i) =>
        part === "" ? null : /^ +$/.test(part) ? (
          part
        ) : (
          <span className="lp-w" key={i}>
            {part}
          </span>
        )
      )}
    </>
  );
}

/** A reveal delay, as the CSS custom property the stylesheet reads. */
export const d = (seconds: number): CSSProperties => ({ ["--d" as string]: `${seconds}s` }) as CSSProperties;

export function Mark({ size = 34, ink }: { size?: number; ink?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 48 48">
      <path
        className={ink ? undefined : "lp-stroke"}
        d="M37.5,9.5 L19.5,30.5 A9.5,9.5 0 0 0 38.5,30.5"
        fill="none"
        stroke={ink ?? "currentColor"}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M0,-11 C4.8,-7.2 6.5,-3 6.5,0.8 C6.5,5.6 3.9,9.8 0,11 C-3.9,9.8 -6.5,5.6 -6.5,0.8 C-6.5,-3 -4.8,-7.2 0,-11 Z" fill="#D9AC42" transform="translate(13,14) rotate(-16) scale(0.7)" />
    </svg>
  );
}
