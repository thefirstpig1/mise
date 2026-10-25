// Where each role lands after signing in (Kong 2026-10-25: "ให้หน้านั้นเป็นหน้า
// หลักหลังจากที่เขาเข้ามาแอพ"). The page a person works in most, not the
// dashboard everyone used to land on. Only the landing changes — every page a
// role may open stays open from the menu.

export function homeFor(role: string, opts: { dailyCloseEnabled: boolean }): string {
  switch (role) {
    case "cashier":
      return opts.dailyCloseEnabled ? "/closing/day" : "/sales/import";
    case "kitchen_staff":
    case "dept_head":
      return "/stock";
    case "purchaser":
      return "/purchase-requests/cut";
    case "accountant":
      return "/expenses";
    default:
      return "/dashboard";
  }
}
