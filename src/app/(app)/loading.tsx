// The same "กำลังโหลด…" as the root, but INSIDE the app frame. The root
// loading.tsx sits above (app)/layout.tsx, so on a move between two signed-in
// pages — which re-renders only below that shared layout — it never showed:
// the old page just stayed up, unresponsive, until the new one arrived. This
// one shows at once, with the sidebar still there, and <Link> fetches it ahead
// of the press (Kong 2026-09-29: "อยากให้ลื่นไหลทุกหน้า").
export { default } from "../loading";
