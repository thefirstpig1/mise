// Rule RC-LB (Kong 2026-10-22, docs/calculation-rules.md): a LOW-confidence
// recipe cost values an ingredient with no price at 0 (ADR 0021 Q6), so the
// true cost is never BELOW the figure — the cost, and anything that grows
// with it (food cost %), reads "อย่างน้อย"; a profit or margin, which shrinks
// as the cost grows, reads "ไม่เกิน". MEDIUM misses nothing and reads plain.
// A plain module: server pages and client components may both import it.

export const isUnderstated = (confidence: string | null | undefined): boolean => confidence === "LOW";
export const atLeastTh = (low: boolean, text: string): string => (low ? `อย่างน้อย ${text}` : text);
export const atMostTh = (low: boolean, text: string): string => (low ? `ไม่เกิน ${text}` : text);
