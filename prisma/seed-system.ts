import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const UNIT_TEMPLATES = [
  // WEIGHT
  { unitName: "g", unitDimension: "WEIGHT", toSiRatio: 1.0, displayOrderTh: 1, displayOrderEn: 1 },
  { unitName: "kg", unitDimension: "WEIGHT", toSiRatio: 1000.0, displayOrderTh: 2, displayOrderEn: 2 },
  { unitName: "ขีด", unitDimension: "WEIGHT", toSiRatio: 100.0, displayOrderTh: 3, displayOrderEn: null },
  // VOLUME
  { unitName: "ml", unitDimension: "VOLUME", toSiRatio: 1.0, displayOrderTh: 1, displayOrderEn: 1 },
  { unitName: "l", unitDimension: "VOLUME", toSiRatio: 1000.0, displayOrderTh: 2, displayOrderEn: 2 },
  // COUNT
  { unitName: "ชิ้น", unitDimension: "COUNT", toSiRatio: null, displayOrderTh: 1, displayOrderEn: null },
  { unitName: "ฟอง", unitDimension: "COUNT", toSiRatio: null, displayOrderTh: 2, displayOrderEn: null },
  { unitName: "ลูก", unitDimension: "COUNT", toSiRatio: null, displayOrderTh: 3, displayOrderEn: null },
  { unitName: "ใบ", unitDimension: "COUNT", toSiRatio: null, displayOrderTh: 4, displayOrderEn: null },
  { unitName: "แพ็ค", unitDimension: "COUNT", toSiRatio: null, displayOrderTh: 5, displayOrderEn: null },
  { unitName: "ถุง", unitDimension: "COUNT", toSiRatio: null, displayOrderTh: 6, displayOrderEn: null },
];

// Templates are global + non-deletable for MVP (ADR 0008, Q7).
// To update a value (e.g., calibrated against new supplier batch):
//   1. Edit the LIQUID_DENSITIES array below
//   2. Run `pnpm db:seed:system` — upsert propagates to all
//      products linked via FK.
// FK linkage means Products read the template's current value at
// query time — no snapshot, no re-link needed after admin update.
// Renaming a template entry is a breaking change (existing FKs
// would orphan); add a new entry and migrate FKs manually instead.
// Removing a template entry from this array does NOT delete the
// DB row — orphan rows persist until manual DELETE; FKs stay safe.
const LIQUID_DENSITIES = [
  { name: "น้ำเปล่า", gPerMl: 1.000, description: "Water", displayOrder: 1 },
  { name: "นมสด", gPerMl: 1.030, description: "Milk", displayOrder: 2 },
  { name: "เบียร์", gPerMl: 1.010, description: "Beer (light)", displayOrder: 3 },
  { name: "น้ำมัน", gPerMl: 0.910, description: "Cooking oil (general)", displayOrder: 4 },
  { name: "น้ำเชื่อม", gPerMl: 1.300, description: "Simple syrup", displayOrder: 5 },
];

async function seedSystem() {
  console.log("Seeding system-wide tables...");

  // Unit templates — upsert by unitName (unique)
  for (const unit of UNIT_TEMPLATES) {
    await prisma.unitTemplate.upsert({
      where: { unitName: unit.unitName },
      create: unit,
      update: unit,
    });
  }
  console.log(`✓ ${UNIT_TEMPLATES.length} unit templates seeded`);

  // Liquid densities — upsert by name (name is @unique as of Part 7d L1)
  for (const density of LIQUID_DENSITIES) {
    await prisma.liquidDensityTemplate.upsert({
      where: { name: density.name },
      create: density,
      update: density,
    });
  }
  console.log(`✓ ${LIQUID_DENSITIES.length} liquid density templates seeded`);
}

seedSystem()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
