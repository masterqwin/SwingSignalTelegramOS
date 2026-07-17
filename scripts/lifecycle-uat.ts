import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swing-lifecycle-uat-"));
  process.env.DATABASE_PATH = path.join(tempDir, "uat.sqlite");
  process.env.DEBUG_SIGNAL = "false";

  const { initSchema, getDb } = await import("../src/lib/db");
  const { updateSignalLifecycle, getActiveSignalCount } = await import("../src/lib/signal-engine");
  const { addDays } = await import("../src/lib/position-lifecycle");

  initSchema();
  const db = getDb();
  const now = new Date();
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  seedSignal("UAT-ENTRY-EXPIRED", "ENTRY_HIT", { entry_hit_at: fourDaysAgo });
  let row = getSignal("UAT-ENTRY-EXPIRED");
  let result = updateSignalLifecycle(row, 101);
  row = getSignal("UAT-ENTRY-EXPIRED");
  assert.equal(row.status, "PRE_TP1_REVIEW_REQUIRED", "TEST 1 legacy ENTRY_HIT expired should require review");
  assert.ok(result.events.includes("PRE_TP1_REVIEW_REQUIRED"), "TEST 1 should emit review event");

  seedSignal("UAT-TP2-TIMEOUT", "TARGET1_HIT", { entry_hit_at: fourDaysAgo, target1_hit_at: threeDaysAgo });
  row = getSignal("UAT-TP2-TIMEOUT");
  result = updateSignalLifecycle(row, 106);
  row = getSignal("UAT-TP2-TIMEOUT");
  assert.equal(row.status, "TP2_TIMEOUT_CLOSED", "TEST 2 legacy TARGET1_HIT expired grace should timeout close");
  assert.equal(row.close_reason, "TP2_TIMEOUT_CLOSED", "TEST 2 close reason");
  assert.ok(result.events.includes("SIGNAL_CLOSED"), "TEST 2 should emit SIGNAL_CLOSED");

  seedSignal("UAT-ENTRY-RETRACE", "TARGET1_HIT", { entry_hit_at: fourDaysAgo, target1_hit_at: oneDayAgo });
  row = getSignal("UAT-ENTRY-RETRACE");
  result = updateSignalLifecycle(row, 99);
  row = getSignal("UAT-ENTRY-RETRACE");
  assert.equal(row.status, "ENTRY_RETRACE_CLOSED", "TEST 3 retrace should close");
  assert.equal(row.close_reason, "ENTRY_RETRACE_CLOSED", "TEST 3 close reason");

  seedSignal("UAT-TARGET2-FIRST", "TARGET1_HIT", { entry_hit_at: fourDaysAgo, target1_hit_at: threeDaysAgo });
  row = getSignal("UAT-TARGET2-FIRST");
  result = updateSignalLifecycle(row, 112);
  row = getSignal("UAT-TARGET2-FIRST");
  assert.equal(row.close_reason, "FULL_TARGET_CLOSED", "TEST 4 target2 should win before timeout");

  for (let i = 0; i < 3; i += 1) seedSignal(`UAT-ACTIVE-${i}`, "SETUP", {});
  seedSignal("UAT-SLOT-CLOSE", "TARGET1_HIT", { entry_hit_at: fourDaysAgo, target1_hit_at: threeDaysAgo });
  const slotsBefore = getActiveSignalCount();
  updateSignalLifecycle(getSignal("UAT-SLOT-CLOSE"), 106);
  const slotsAfter = getActiveSignalCount();
  assert.equal(slotsBefore, 5, "TEST 5 starts with 5 active slots");
  assert.equal(slotsAfter, 4, "TEST 5 lifecycle close releases one active slot");

  seedSignal("UAT-IDEMPOTENT", "ENTRY_HIT", { entry_hit_at: fourDaysAgo });
  const first = updateSignalLifecycle(getSignal("UAT-IDEMPOTENT"), 101);
  const second = updateSignalLifecycle(getSignal("UAT-IDEMPOTENT"), 101);
  assert.ok(first.events.includes("PRE_TP1_REVIEW_REQUIRED"), "TEST 6 first run emits review");
  assert.equal(second.events.length, 0, "TEST 6 second run is idempotent");

  const utcStart = new Date("2026-07-13T17:45:59.551Z");
  const utcDeadline = addDays(utcStart, 3).toISOString();
  assert.equal(utcDeadline, "2026-07-16T17:45:59.551Z", "TEST 7 UTC deadline should be exact 72 hours");

  console.log("lifecycle:uat PASS");
  console.log(`temp_db=${process.env.DATABASE_PATH}`);

  function seedSignal(signalId: string, status: string, overrides: Record<string, unknown>) {
    const createdAt = (overrides.created_at as string) || fourDaysAgo;
    db.prepare(
      `INSERT INTO signals (
        signal_id, pair, symbol, status, lifecycle_status, created_at, expires_at,
        entry_low, entry_high, current_price_at_signal, target1, target2,
        stake_thb, usdthb_rate, score, confidence_pct, quality_label, risk_level,
        reason_th, is_debug, dca_level, target_version, entry_hit_at, target1_hit_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?)`
    ).run(
      signalId,
      `${signalId.split("-")[1] || "ZEC"}_USDT`,
      signalId.split("-")[1] || "ZEC",
      status,
      status,
      createdAt,
      addDays(new Date(createdAt), 3).toISOString(),
      99,
      101,
      102,
      105,
      110,
      20000,
      36.5,
      92,
      75,
      "A",
      "medium",
      "uat",
      overrides.entry_hit_at || null,
      overrides.target1_hit_at || null
    );
  }

  function getSignal(signalId: string) {
    return db.prepare("SELECT * FROM signals WHERE signal_id = ?").get(signalId) as any;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
