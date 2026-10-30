import { config } from "dotenv";
config({ path: ".env" });

// Kong 2026-10-30: more time for the TESTS only — never set outside the suite
// (src/lib/db.ts, TX_TIMEOUT_FLOOR_MS). From the Mac a round trip to Neon is
// ~70 ms, twice what the suite's 5 s transactions were sized against.
process.env.MISE_TX_TIMEOUT_FLOOR_MS ??= "15000";
