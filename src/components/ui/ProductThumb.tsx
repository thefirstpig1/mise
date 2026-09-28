// ============================================================
// Mise — a product's picture, or a quiet stand-in (Kong, 2026-09-28)
// ============================================================
// Every place a product is shown as an item — the product page and the order
// catalog — reserves this one slot, so the day shops can add photos (Feature
// 5, Tigris) the layout does not move: `product.image_url` fills the slot and
// nothing else changes.
//
// No photo is the normal case today, so the stand-in must look finished, not
// broken: a tinted tile with a drawn crate. Deliberately NOT the name's first
// letter — Thai names often start with a leading vowel (เ, แ, โ), which makes
// a meaningless badge.
//
// A plain <img>, not next/image: the bucket host is not chosen in
// next.config yet, and a thumbnail this small gains nothing from resizing.
// ============================================================

export default function ProductThumb({
  imageUrl,
  name,
  className = "",
}: {
  imageUrl: string | null;
  name: string;
  /** Sizing comes from the caller: `aspect-square w-full` on a card, `h-10 w-10` in a row. */
  className?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        loading="lazy"
        className={`shrink-0 rounded-lg bg-muted object-cover ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground/60 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-1/3 max-h-10 w-1/3 max-w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5z" strokeLinejoin="round" />
        <path d="M3.5 8.5 12 13l8.5-4.5M12 13v7" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
