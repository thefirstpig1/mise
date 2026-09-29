// ============================================================
// Mise — purchase request *Logic (Part 38, ADR 0036) against real Neon
// ============================================================
// The kitchen asks, each department says ready, a purchaser cuts a round into
// draft POs per supplier. What is pinned here is what ADR 0036 exists for:
//   R1  status is READ from PO lines — a cancelled order puts a line back
//   R3  a round is all or nothing
//   R4  a line that left the kitchen cannot be changed by it
//   R5  a cook's board carries no money
//   R7  the promised date is the one write a sent order accepts
//   Q3  every department must say ready; adding takes "ready" back
//   Q4  moving supplier past a kitchen note needs an answer
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { costAccessFor } from "@/lib/permissions/cost-access";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { purchaseOrderInputSchema } from "@/lib/validations/purchase-order";
import {
  cancelPurchaseOrderLogic,
  deletePurchaseOrderDraftLogic,
  DeliveryPromiseNotAllowedError,
  getPurchaseOrderByIdLogic,
  sendPurchaseOrderLogic,
  setDeliveryPromiseLogic,
  updatePurchaseOrderLogic,
} from "@/server/purchase-order";
import {
  addRequestLineLogic,
  CutLineNotReadyError,
  cutRoundLogic,
  getRequestBoardLogic,
  getRequestMessagesLogic,
  KitchenNoteUnansweredError,
  rejectRequestLineLogic,
  reopenRequestLineLogic,
  RequestLineNotEditableError,
  setDepartmentReadyLogic,
  updateRequestLineLogic,
  type RequestViewer,
} from "@/server/purchase-request";
import { sweepOrphanUsers, sweepTestTenants } from "./support/sweep";

describe("purchase request (ADR 0036)", () => {
  let tenant: string;
  let branch: string;
  let deptMain: string;
  let deptBar: string;
  let supA: string;
  let supB: string;
  let users: string[] = [];
  let pork: ProductWithUnits;
  let lime: ProductWithUnits;
  let cook: RequestViewer;
  let cook2: RequestViewer;
  let barCook: RequestViewer;
  let buyer: RequestViewer;
  const today = computeBangkokToday();

  const kg = (p: ProductWithUnits) => p.productUnits.find((u) => u.unitName === "kg")!.id;
  const pack = (p: ProductWithUnits) => p.productUnits.find((u) => u.unitName === "แพ็ก")!.id;
  const add = (who: RequestViewer, over: Record<string, unknown> = {}, ack = true) =>
    addRequestLineLogic(
      tenant,
      who,
      { branchId: branch, productId: pork.id, qty: 3, unitId: kg(pork), ...over } as Parameters<typeof addRequestLineLogic>[2],
      { acknowledgeDuplicate: ack }
    );
  const lineId = async (who: RequestViewer, over: Record<string, unknown> = {}) => {
    const r = await add(who, over);
    if (!r.ok) throw new Error("expected a line");
    return r.lineId;
  };
  const board = (who: RequestViewer) => getRequestBoardLogic(tenant, branch, who);
  const statusOf = async (id: string) => (await board(buyer)).lines.find((l) => l.id === id)?.status.kind;
  const clearLines = () =>
    withRlsBypass(async (tx) => {
      await tx.purchaseRequestMessage.deleteMany({ where: { tenantId: tenant } });
      await tx.purchaseRequestReady.deleteMany({ where: { tenantId: tenant } });
      await tx.purchaseRequestLine.updateMany({ where: { tenantId: tenant }, data: { deletedAt: new Date() } });
    });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "PR Test Tenant", enableDepartments: true } });
      tenant = t.id;
      branch = (await tx.branch.create({ data: { tenantId: t.id, name: "ลาดพร้าว", code: "PRT" } })).id;
      deptMain = (await tx.department.create({ data: { tenantId: t.id, name: "ครัวร้อน", code: "MAIN" } })).id;
      deptBar = (await tx.department.create({ data: { tenantId: t.id, name: "บาร์", code: "BAR" } })).id;
      supA = (await tx.supplier.create({ data: { tenantId: t.id, nameFull: "ร้าน A" } })).id;
      supB = (await tx.supplier.create({ data: { tenantId: t.id, nameFull: "ร้าน B", isVatRegistered: true } })).id;
      const mk = (name: string) => tx.user.create({ data: { email: `pr-${randomUUID()}@example.com`, name } });
      const [u1, u2, u3, u4] = [await mk("น้องเอ"), await mk("น้องบี"), await mk("พี่บาร์"), await mk("จัดซื้อ")];
      users = [u1.id, u2.id, u3.id, u4.id];
      for (const [u, role] of [
        [u1, "kitchen_staff"],
        [u2, "kitchen_staff"],
        [u3, "kitchen_staff"],
        [u4, "purchaser"],
      ] as const) {
        const m = await tx.tenantMembership.create({ data: { tenantId: t.id, userId: u.id, role, allBranches: true } });
        if (u === u3) await tx.userDepartmentAssignment.create({ data: { tenantMembershipId: m.id, departmentId: deptBar, isPrimary: true } });
      }
      cook = { userId: u1.id, role: "kitchen_staff", canApprove: false, costAccess: costAccessFor("kitchen_staff") };
      cook2 = { userId: u2.id, role: "kitchen_staff", canApprove: false, costAccess: costAccessFor("kitchen_staff") };
      barCook = { userId: u3.id, role: "kitchen_staff", canApprove: false, costAccess: costAccessFor("kitchen_staff") };
      buyer = { userId: u4.id, role: "purchaser", canApprove: true, costAccess: costAccessFor("purchaser") };
    });

    const product = (name: string) =>
      createProductLogic(
        tenant,
        productInputSchema.parse({
          name: `${name}-${randomUUID().slice(0, 6)}`,
          primaryDimension: "WEIGHT",
          baseUnitName: "kg",
          additionalUnits: [{ unitName: "แพ็ก", toBaseRatio: 2 }],
        })
      );
    pork = await product("หมูสามชั้น");
    lime = await product("มะนาว");

    // Prices (rule PR2): A 168/kg (preferred), B 145/kg — per base unit, excl VAT.
    await withRlsBypass(async (tx) => {
      const from = addDays(today, -10);
      await tx.supplierProductMapping.create({
        data: { tenantId: tenant, supplierId: supA, productId: pork.id, currentUnitPrice: new Prisma.Decimal(168), isPreferred: true, effectiveFrom: from },
      });
      await tx.supplierProductMapping.create({
        data: { tenantId: tenant, supplierId: supB, productId: pork.id, orderUnitId: pack(pork), currentUnitPrice: new Prisma.Decimal(290), effectiveFrom: from },
      });
      await tx.parLevel.create({ data: { tenantId: tenant, branchId: branch, productId: lime.id, parQty: new Prisma.Decimal(10), inputQty: new Prisma.Decimal(10), inputUnitId: kg(lime) } });
    });
  }, 300_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await sweepTestTenants(tx as never, { ids: [tenant] });
      await sweepOrphanUsers(tx as never, { ids: users });
    });
  }, 300_000);

  it("Q3/Q11 — a line goes to the person's department and the preferred supplier by itself", async () => {
    await clearLines();
    const hot = await lineId(cook);
    const bar = await lineId(barCook, { productId: lime.id, unitId: kg(lime) });
    const b = await board(buyer);
    expect(b.lines.find((l) => l.id === hot)).toMatchObject({ department: { id: deptMain }, supplier: { id: supA } });
    // The bar cook's primary department; lime has no preferred supplier and was never bought.
    expect(b.lines.find((l) => l.id === bar)).toMatchObject({ department: { id: deptBar }, supplier: null });
  });

  it("Q3 — the same product already asked for is reported, not silently added twice", async () => {
    await clearLines();
    await lineId(cook);
    const again = await add(cook2, {}, false);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.duplicates[0]).toMatchObject({ qty: 3, status: "waiting", departmentName: "ครัวร้อน" });
    expect((await add(cook2, {}, true)).ok).toBe(true); // a second press means it
  });

  it("Q3 — EVERY department must say ready, and adding afterwards takes it back", async () => {
    await clearLines();
    await lineId(cook);
    let r = await setDepartmentReadyLogic(tenant, cook, { branchId: branch, departmentId: deptMain, ready: true });
    expect(r.allReady).toBe(false); // the bar has not said anything yet — Kong's case
    r = await setDepartmentReadyLogic(tenant, barCook, { branchId: branch, departmentId: deptBar, ready: true });
    expect(r).toEqual({ allReady: true, becameAllReady: true });
    await lineId(barCook, { productId: lime.id, unitId: kg(lime) });
    expect((await board(buyer)).readiness.allReady).toBe(false);
    expect((await board(buyer)).readiness.departments.find((d) => d.id === deptBar)?.ready).toBeNull();
  });

  it("R5 — the cook is told B is cheaper, never by how much; the purchaser sees the figures", async () => {
    await clearLines();
    const id = await lineId(cook);
    const cooks = (await board(cook)).lines.find((l) => l.id === id)!;
    expect(cooks.cheaper).toMatchObject({ supplierName: "ร้าน B", money: null });
    expect(JSON.stringify(cooks)).not.toMatch(/145|168|290/);
    const buyers = (await board(buyer)).lines.find((l) => l.id === id)!;
    expect(buyers.cheaper?.money).toEqual({ theirs: 145, ours: 168 });
  });

  it("R4/Q6 — a cook cannot change a colleague's line; nobody in the kitchen can change a line once cut", async () => {
    await clearLines();
    const id = await lineId(cook);
    const edit = (who: RequestViewer) =>
      updateRequestLineLogic(tenant, who, id, { qty: 5, unitId: kg(pork), supplierId: supA, onHandQty: null, note: null });
    await expect(edit(cook2)).rejects.toBeInstanceOf(RequestLineNotEditableError);
    await edit(cook);
    await cutRoundLogic(tenant, buyer, {
      branchId: branch,
      picks: [{ lineId: id, supplierId: supA, qty: 5, unitId: kg(pork), unitPrice: 168, mappingId: null, reply: null }],
    });
    await expect(edit(cook)).rejects.toMatchObject({ reason: "not_waiting" });
  });

  it("R3 — cutting a round makes one draft per supplier, links every line, and resets readiness", async () => {
    await clearLines();
    const a = await lineId(cook);
    const b = await lineId(barCook, { productId: lime.id, unitId: kg(lime), supplierId: supB });
    await setDepartmentReadyLogic(tenant, cook, { branchId: branch, departmentId: deptMain, ready: true });
    const res = await cutRoundLogic(tenant, buyer, {
      branchId: branch,
      picks: [
        { lineId: a, supplierId: supA, qty: 3, unitId: kg(pork), unitPrice: 168, mappingId: null, reply: null },
        { lineId: b, supplierId: supB, qty: 2, unitId: pack(lime), unitPrice: 40, mappingId: null, reply: null },
      ],
    });
    expect(res.orders.map((o) => o.supplierName).sort()).toEqual(["ร้าน A", "ร้าน B"]);
    expect(await statusOf(a)).toBe("preparing");
    expect((await board(buyer)).readiness.departments.every((d) => d.ready === null)).toBe(true);

    const poB = await getPurchaseOrderByIdLogic(tenant, res.orders.find((o) => o.supplierName === "ร้าน B")!.id);
    expect(poB?.vatRatePercent?.toNumber()).toBe(7); // B is VAT-registered — default from the tenant
    expect(poB?.items[0].allocations[0].departmentId).toBe(deptBar); // it goes to the department that asked
    const msgs = await getRequestMessagesLogic(tenant, b);
    expect(msgs.at(-1)?.body).toMatch(/^อยู่ในใบสั่งซื้อร่าง PRT-PO-\d+ · จัดซื้อเปลี่ยนจำนวน 3 kg → 2 แพ็ก$/);
  });

  it("R3 — one bad line and NOTHING is created", async () => {
    await clearLines();
    const good = await lineId(cook);
    const rejected = await lineId(cook, { productId: lime.id, unitId: kg(lime) });
    await rejectRequestLineLogic(tenant, buyer, rejected, "ของยังพอ");
    const before = await withRlsBypass((tx) => tx.purchaseOrder.count({ where: { tenantId: tenant } }));
    await expect(
      cutRoundLogic(tenant, buyer, {
        branchId: branch,
        picks: [
          { lineId: good, supplierId: supA, qty: 3, unitId: kg(pork), unitPrice: 168, mappingId: null, reply: null },
          { lineId: rejected, supplierId: supA, qty: 1, unitId: kg(lime), unitPrice: 30, mappingId: null, reply: null },
        ],
      })
    ).rejects.toBeInstanceOf(CutLineNotReadyError);
    expect(await withRlsBypass((tx) => tx.purchaseOrder.count({ where: { tenantId: tenant } }))).toBe(before);
    expect(await statusOf(good)).toBe("waiting");
  });

  it("Q4 — moving past the kitchen's note needs an answer, and the answer is kept", async () => {
    await clearLines();
    const id = await lineId(cook, { supplierId: supA, note: "ร้าน B เนื้อไม่สวย" });
    const pick = { lineId: id, supplierId: supB, qty: 2, unitId: pack(pork), unitPrice: 290, mappingId: null };
    await expect(cutRoundLogic(tenant, buyer, { branchId: branch, picks: [{ ...pick, reply: " " }] })).rejects.toBeInstanceOf(
      KitchenNoteUnansweredError
    );
    await cutRoundLogic(tenant, buyer, { branchId: branch, picks: [{ ...pick, reply: "เช็กแล้ว ล็อตนี้สวย" }] });
    const bodies = (await getRequestMessagesLogic(tenant, id)).map((m) => m.body);
    expect(bodies).toContain("เช็กแล้ว ล็อตนี้สวย");
    expect(bodies.at(-1)).toMatch(/ผู้ขาย ร้าน A → ร้าน B/);
  });

  it("R1/Q10 — a cancelled order or a deleted draft puts the line back to waiting, and says why", async () => {
    await clearLines();
    const id = await lineId(cook);
    const cut = () =>
      cutRoundLogic(tenant, buyer, {
        branchId: branch,
        picks: [{ lineId: id, supplierId: supA, qty: 3, unitId: kg(pork), unitPrice: 168, mappingId: null, reply: null }],
      });
    const first = (await cut()).orders[0];
    await deletePurchaseOrderDraftLogic(tenant, first.id);
    expect(await statusOf(id)).toBe("waiting");

    const second = (await cut()).orders[0];
    await sendPurchaseOrderLogic(tenant, second.id, buyer.userId);
    expect(await statusOf(id)).toBe("ordered");
    await cancelPurchaseOrderLogic(tenant, { id: second.id, cancelReason: "ผู้ขายของหมด" }, buyer.userId);
    expect(await statusOf(id)).toBe("waiting");
    expect((await getRequestMessagesLogic(tenant, id)).at(-1)?.body).toMatch(/ถูกยกเลิก: ผู้ขายของหมด/);
  });

  it("R1 — editing the draft keeps the line linked (the form carries the pointer through)", async () => {
    await clearLines();
    const id = await lineId(cook);
    const po = (
      await cutRoundLogic(tenant, buyer, {
        branchId: branch,
        picks: [{ lineId: id, supplierId: supA, qty: 3, unitId: kg(pork), unitPrice: 168, mappingId: null, reply: null }],
      })
    ).orders[0];
    await updatePurchaseOrderLogic(
      tenant,
      po.id,
      purchaseOrderInputSchema.parse({
        branchId: branch,
        supplierId: supA,
        expectedDeliveryDate: "",
        vatRatePercent: "",
        notes: null,
        lines: [
          { productId: pork.id, orderUnitId: kg(pork), qtyOrdered: 4, unitPrice: 160, supplierProductMappingId: null, notes: null, purchaseRequestLineId: id },
        ],
      })
    );
    expect(await statusOf(id)).toBe("preparing");
  });

  it("Q4 — 'ไม่สั่ง' keeps the line with its reason; asking again reopens the SAME line", async () => {
    await clearLines();
    const id = await lineId(cook);
    await rejectRequestLineLogic(tenant, buyer, id, "ของยังพอ");
    expect((await board(cook)).lines.find((l) => l.id === id)?.status).toEqual({ kind: "rejected", reason: "ของยังพอ" });
    await reopenRequestLineLogic(tenant, cook, id, "เช็กแล้ว เหลือ 1 กก.");
    expect(await statusOf(id)).toBe("waiting");
    const bodies = (await getRequestMessagesLogic(tenant, id)).map((m) => m.body);
    expect(bodies).toEqual(["จัดซื้อไม่สั่งรายการนี้: ของยังพอ", "ขอใหม่: เช็กแล้ว เหลือ 1 กก."]);
  });

  it("R7 — the promised date: only on a sent order, every promise kept, the kitchen sees the newest", async () => {
    await clearLines();
    const id = await lineId(cook);
    const po = (
      await cutRoundLogic(tenant, buyer, {
        branchId: branch,
        picks: [{ lineId: id, supplierId: supA, qty: 3, unitId: kg(pork), unitPrice: 168, mappingId: null, reply: null }],
      })
    ).orders[0];
    await expect(
      setDeliveryPromiseLogic(tenant, { purchaseOrderId: po.id, promisedDate: today, note: null }, buyer.userId)
    ).rejects.toBeInstanceOf(DeliveryPromiseNotAllowedError);
    await sendPurchaseOrderLogic(tenant, po.id, buyer.userId);
    await setDeliveryPromiseLogic(tenant, { purchaseOrderId: po.id, promisedDate: addDays(today, 1), note: null }, buyer.userId);
    await setDeliveryPromiseLogic(tenant, { purchaseOrderId: po.id, promisedDate: addDays(today, 2), note: "รถเสีย" }, buyer.userId);
    const promises = await withRlsBypass((tx) => tx.purchaseOrderDeliveryPromise.findMany({ where: { purchaseOrderId: po.id } }));
    expect(promises).toHaveLength(2);
    const s = (await board(cook)).lines.find((l) => l.id === id)!.status;
    expect(s).toMatchObject({ kind: "promised", date: addDays(today, 2).toISOString().slice(0, 10) });
  });

  it("R3 — two purchasers cutting the same line at once: exactly one order", async () => {
    await clearLines();
    const id = await lineId(cook);
    const cut = () =>
      cutRoundLogic(tenant, buyer, {
        branchId: branch,
        picks: [{ lineId: id, supplierId: supA, qty: 3, unitId: kg(pork), unitPrice: 168, mappingId: null, reply: null }],
      });
    const results = await Promise.allSettled([cut(), cut()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const links = await withRlsBypass((tx) => tx.purchaseOrderItem.count({ where: { purchaseRequestLineId: id } }));
    expect(links).toBe(1);
  });

  it("Q5 — below par shows what to order (par − on hand − on order) and leaves once asked for", async () => {
    await clearLines();
    const before = await board(cook);
    const row = before.belowPar.find((p) => p.product.id === lime.id);
    expect(row).toMatchObject({ parBase: 10, onHandBase: 0, suggestedQty: 10, unit: { name: "kg" } });
    await lineId(cook, { productId: lime.id, unitId: kg(lime), qty: 10 });
    expect((await board(cook)).belowPar.some((p) => p.product.id === lime.id)).toBe(false);
  });
});
