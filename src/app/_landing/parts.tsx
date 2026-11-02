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
  // หน้าแรก: วิธีใช้งาน (2026-11-02)
  sales: <><path d="M3 3v18h18" /><path d="M8 17v-5M13 17V8M18 17v-9" /></>,
  cart: <><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2 2h2l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 7H5.1" /></>,
  count: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>,
  trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  book: <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  file: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h2M14 13h2M8 17h2M14 17h2" /></>,
  layers: <><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></>,
  spark: <path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" />,
  store: <path d="M4 10h16v10H4zM3 10l2-6h14l2 6M9 20v-5h6v5" />,
  swap: <path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />,
  flask: <path d="M10 2v7.3M14 9.3V2M8.5 2h7M14 9.3a6.5 6.5 0 1 1-4 0M5.5 16h13" />,
  pot: <path d="M2 12h20M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8M8 8c0-2 1-3 1-5M12 8c0-2 1-3 1-5M16 8c0-2 1-3 1-5" />,
  meal: <path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7" />,
  net: <><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" /></>,
  bell: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a2 2 0 0 0 3.4 0" />,
  gauge: <><path d="m12 14 4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
};

export function Icon({ k, className }: { k: IconKey; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
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
