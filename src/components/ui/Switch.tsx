// ============================================================
// Mise — an on/off switch in the theme's colours (review 2026-10-28)
// ============================================================
// A real checkbox underneath (role="switch"), visually hidden, so a form posts
// it as "on" exactly like the checkboxes it replaces, its change event bubbles
// to the form, and form.reset() puts it back. The two spans are drawn from the
// checkbox's state with `peer-*` — no JavaScript, so it works in a Server
// Component too.
// ============================================================

export default function Switch({
  name,
  defaultChecked,
  label,
  disabled = false,
}: {
  name: string;
  defaultChecked: boolean;
  /** Read by screen readers; the visible label sits beside the switch. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="relative inline-flex h-[30px] w-[52px] shrink-0 cursor-pointer has-[:disabled]:cursor-default">
      <input
        type="checkbox"
        role="switch"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        aria-label={label}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-border-strong transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
      />
      <span
        aria-hidden
        className="absolute left-[3px] top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[22px]"
      />
    </label>
  );
}
