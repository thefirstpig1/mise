"use client";

// ADR 0040 step 7 — the product sheet's say on making and cutting this product
// (mockup 5rcGTWvS3qBw5dNUhoLxa6, "สินค้า › น้ำซุปกระดูก (แผงข้าง)").
//   * A prepped product: how it is made, when it was last made here, and the
//     same "บันทึกการผลิต" the /production page has, with this product chosen.
//   * Any product: "ตัดแต่งเป็น" — its trim recipes, edited here because the
//     question is "what does this whole thing give" (Kong 2026-10-29).

import { useEffect, useState } from "react";
import type { PickerProduct } from "@/components/ui/ProductPicker";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { readApi } from "@/lib/read-api";
import type { ProductProductionInfo } from "@/server/production-read";
import RecordProductionSheet from "./RecordProductionSheet";
import TrimRecipeEditor from "./TrimRecipeEditor";

const show = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const when = (iso: string) => new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

export default function ProductionSection({
  product,
  branch,
  branches,
  today,
  costHidden,
  canProduce,
  canEditTrim,
  partOptions,
  onToast,
  onChanged,
}: {
  product: { id: string; name: string; type: string; sku: string; baseUnitName: string | null; section: string | null; group: string | null };
  branch: { id: string; name: string };
  branches: { id: string; name: string }[];
  today: string;
  costHidden: boolean;
  canProduce: boolean;
  canEditTrim: boolean;
  partOptions: PickerProduct[];
  onToast: (m: string) => void;
  onChanged: () => void;
}) {
  const [info, setInfo] = useState<ProductProductionInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [recording, setRecording] = useState<null | { mode: "make" | "trim"; id: string; name: string }>(null);
  const [tick, setTick] = useState(0);
  // A raw product with no trim recipe gets one quiet line, not a whole section:
  // most raw things (fish sauce, sugar) are never cut into parts.
  const [trimOpen, setTrimOpen] = useState(false);

  useEffect(() => {
    let on = true;
    // The sheet is keyed by product, so a refresh after a save keeps the old
    // answer on screen until the new one lands — nothing unmounts mid-edit.
    setFailed(false);
    void readApi<{ ok: true; info: ProductProductionInfo }>("/api/production", "info", { productId: product.id, branchId: branch.id }).then((r) => {
      if (on) (r.ok ? setInfo(r.info) : setFailed(true));
    });
    return () => {
      on = false;
    };
  }, [product.id, branch.id, tick]);

  const isPrepped = product.type === "PREPPED";
  const base = product.baseUnitName ?? "";
  const pick = (id: string, name: string) => ({ id, name, sku: product.sku, section: product.section, group: product.group, baseUnitName: base });

  if (failed) return null;

  return (
    <>
      {isPrepped && (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-semibold">การผลิต · {branch.name}</h4>
            {info?.lastProduced && (
              <span className="text-xs text-muted-foreground">
                ทำล่าสุด {when(info.lastProduced.at)} · {show(info.lastProduced.qty)} {unitTh(info.lastProduced.unitName)}
              </span>
            )}
          </div>
          {!info ? (
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {info.method === "RECIPE"
                  ? "ทำตามสูตรผลิต — บันทึกแล้วของขึ้นชั้นพร้อมต้นทุนของวัตถุดิบที่ใช้ทำ"
                  : info.method === "PARENT"
                    ? "ทำจากของตัวเดียวตาม % ที่ได้"
                    : info.method === "TRIM_PART" && info.partOf
                      ? `ได้จากการแล่${info.partOf.parentName} (สูตร “${info.partOf.trimRecipeName}” · ${show(info.partOf.weightPct)}% น้ำหนัก · ${show(info.partOf.valuePct)}% มูลค่า)`
                      : "ยังไม่มีวิธีทำ — ตั้งวิธีทำด้านบนก่อนจึงบันทึกการผลิตได้ · ถ้าซื้อมาสำเร็จรูป รับของตามปกติได้เลย"}
              </p>
              {!info.lastProduced && (info.method === "RECIPE" || info.method === "PARENT") && (
                <p className="text-xs text-muted-subtle">ยังไม่เคยบันทึกที่สาขานี้ — ร้านที่ไม่บันทึก ระบบตัดวัตถุดิบตามสูตรแทนให้เหมือนเดิม</p>
              )}
              {canProduce && (info.method === "RECIPE" || info.method === "PARENT") && (
                <button type="button" onClick={() => setRecording({ mode: "make", id: product.id, name: product.name })} className="btn btn-sm">
                  ＋ บันทึกการผลิต
                </button>
              )}
              {canProduce && info.method === "TRIM_PART" && info.partOf && (
                <button
                  type="button"
                  onClick={() => setRecording({ mode: "trim", id: info.partOf!.parentId, name: info.partOf!.parentName })}
                  className="btn-secondary btn-sm"
                >
                  ＋ บันทึกการแล่{info.partOf.parentName}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {info && info.trimRecipeCount === 0 && canEditTrim && !isPrepped && !trimOpen && (
        <button
          type="button"
          onClick={() => setTrimOpen(true)}
          className="w-full rounded-2xl border border-dashed border-border-strong px-4 py-2.5 text-left text-sm text-muted-foreground hover:border-primary hover:text-primary"
        >
          + ตั้งสูตรตัดแต่ง — ถ้าซื้อ{product.name}มาทั้งชิ้นแล้วแล่เป็นหลายส่วน
        </button>
      )}

      {info && (info.trimRecipeCount > 0 || (trimOpen && canEditTrim && !isPrepped)) && (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-semibold">ตัดแต่งเป็น</h4>
            {canProduce && info.trimRecipeCount > 0 && (
              <button type="button" onClick={() => setRecording({ mode: "trim", id: product.id, name: product.name })} className="btn-secondary btn-sm">
                ＋ บันทึกการแล่
              </button>
            )}
          </div>
          <TrimRecipeEditor
            parent={{ id: product.id, name: product.name }}
            baseUnitName={base}
            branchId={branch.id}
            canEdit={canEditTrim}
            costHidden={costHidden}
            partOptions={partOptions.filter((o) => o.id !== product.id)}
            startNew={trimOpen}
            onToast={onToast}
            onSaved={() => setTick((t) => t + 1)}
          />
        </section>
      )}

      {recording && (
        <RecordProductionSheet
          branches={branches}
          defaultBranchId={branch.id}
          make={recording.mode === "make" ? [pick(recording.id, recording.name)] : []}
          trim={recording.mode === "trim" ? [pick(recording.id, recording.name)] : []}
          today={today}
          costHidden={costHidden}
          initial={{ mode: recording.mode, productId: recording.id }}
          onClose={() => setRecording(null)}
          onDone={(m) => {
            setRecording(null);
            onToast(m);
            setTick((t) => t + 1);
            onChanged();
          }}
        />
      )}
    </>
  );
}
