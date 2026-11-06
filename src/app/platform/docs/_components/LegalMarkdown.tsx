// ADR 0045 Q5 — the legal drafts, rendered from docs/legal/*.md as they are.
// Not a Markdown library (no new dependency): only what the two drafts use —
// headings, quote lines, numbered and bulleted lists, tables and **bold**.
// A line break inside a paragraph is kept, because the drafts break lines on
// purpose ("ติดต่อ: …" on its own line). 【 】 is a blank still to fill, so it
// is marked to be seen.

import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|【[^】]*】|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<b key={i++}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("【")) out.push(<mark key={i++} className="rounded bg-warn-bg px-1 text-warn">{t}</mark>);
    else out.push(<code key={i++} className="rounded bg-muted px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { k: "h"; level: number; text: string }
  | { k: "quote"; lines: string[] }
  | { k: "ol" | "ul"; items: string[] }
  | { k: "table"; rows: string[][] }
  | { k: "p"; lines: string[] };

export function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const push = (b: Block) => blocks.push(b);
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const prev = blocks[blocks.length - 1];
    if (!line.trim()) {
      push({ k: "p", lines: [] }); // a break; empty paragraphs are dropped below
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      push({ k: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (line.startsWith(">")) {
      const text = line.replace(/^>\s?/, "");
      if (prev?.k === "quote") prev.lines.push(text);
      else push({ k: "quote", lines: [text] });
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (prev?.k === "ol") prev.items.push(ol[1]);
      else push({ k: "ol", items: [ol[1]] });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (prev?.k === "ul") prev.items.push(ul[1]);
      else push({ k: "ul", items: [ul[1]] });
      continue;
    }
    if (line.startsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // the |---| separator row
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (prev?.k === "table") prev.rows.push(cells);
      else push({ k: "table", rows: [cells] });
      continue;
    }
    if (prev?.k === "p") prev.lines.push(line);
    else push({ k: "p", lines: [line] });
  }
  return blocks.filter((b) => b.k !== "p" || b.lines.length > 0);
}

export default function LegalMarkdown({ md }: { md: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      {parseBlocks(md).map((b, i) => {
        switch (b.k) {
          case "h":
            return b.level === 1 ? (
              <h2 key={i} className="text-xl font-semibold">
                {inline(b.text)}
              </h2>
            ) : (
              <h3 key={i} className="pt-2 text-base font-semibold">
                {inline(b.text)}
              </h3>
            );
          case "quote":
            return (
              <blockquote key={i} className="rounded-xl border border-warn-border bg-warn-bg/60 px-3.5 py-2.5 text-sm">
                {b.lines.map((l, j) => (
                  <p key={j}>{inline(l)}</p>
                ))}
              </blockquote>
            );
          case "ol":
          case "ul": {
            const List = b.k === "ol" ? "ol" : "ul";
            return (
              <List key={i} className={`space-y-1 pl-6 ${b.k === "ol" ? "list-decimal" : "list-disc"}`}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </List>
            );
          }
          case "table": {
            const [head, ...rows] = b.rows;
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-border/70">
                <table className="data-table w-full min-w-[520px] text-sm">
                  <thead>
                    <tr>
                      {head.map((c, j) => (
                        <th key={j}>{inline(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="align-top">
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case "p":
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <span key={j} className="block">
                    {inline(l)}
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
