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

const LIQUID_DENSITIES = [
  { name: "น้ำเปล่า", mlPerG: 1.000, description: "Water", displayOrder: 1 },
  { name: "นมสด", mlPerG: 1.030, description: "Milk", displayOrder: 2 },
  { name: "เบียร์", mlPerG: 1.010, description: "Beer (light)", displayOrder: 3 },
  { name: "น้ำมัน", mlPerG: 0.910, description: "Cooking oil (general)", displayOrder: 4 },
  { name: "น้ำเชื่อม", mlPerG: 1.300, description: "Simple syrup", displayOrder: 5 },
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

  // Liquid densities — check existing + insert (no unique constraint on name yet)
  for (const density of LIQUID_DENSITIES) {
    const existing = await prisma.liquidDensityTemplate.findFirst({
      where: { name: density.name },
    });
    if (!existing) {
      await prisma.liquidDensityTemplate.create({ data: density });
    }
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
