/**
 * DB-level tests for redeemFoundingCode — the P0 that let a founding code burn
 * without binding the family (user kept paying HK$40).
 *
 * These need a REAL Postgres because the whole point is transaction/lock
 * semantics (FOR UPDATE, advisory lock, unique constraints) that a mock cannot
 * reproduce.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/kindcipe_test?host=/tmp \
 *     npx tsx --test server/services/promoRedeem.db.test.ts
 *
 * Skipped (not failed) when TEST_DATABASE_URL is absent, so `npm run test:chef`
 * stays green on machines without a scratch database.
 */
import assert from "node:assert/strict";
import test from "node:test";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("promo redeem DB tests (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  // Must be set before importing the modules: ENV is read at import time.
  process.env.DATABASE_URL = TEST_DB;
  process.env.EARLYBIRD_PROMO_ACTIVE = "true";
  process.env.STRIPE_PRICE_MONTHLY_PROMO = process.env.STRIPE_PRICE_MONTHLY_PROMO || "price_test_monthly";
  process.env.STRIPE_PRICE_YEARLY_PROMO = process.env.STRIPE_PRICE_YEARLY_PROMO || "price_test_yearly";
  process.env.EARLYBIRD_CAP = "2";

  const { redeemFoundingCode } = await import("./promo");
  const { getDb } = await import("../db");
  const postgres = (await import("postgres")).default;

  const sql = postgres(TEST_DB, { max: 10 });

  async function reset() {
    await sql`truncate table promo_code_redemptions, earlybird_redemptions, promo_codes restart identity cascade`;
    await sql`truncate table users cascade`;
    await sql`truncate table families restart identity cascade`;
  }

  async function makeFamily(name: string): Promise<{ familyId: number; userId: string }> {
    const [user] = await sql`
      insert into users (open_id, email, name)
      values (${`o${Math.random().toString(36).slice(2, 10)}-${name}`.slice(0, 60)}, ${`${name}@test.local`.slice(0, 300)}, ${name})
      returning id`;
    const [family] = await sql`
      insert into families (name, invite_code, owner_id, subscription_status)
      values (${name}, ${`K${Math.random().toString(36).slice(2, 12)}`.slice(0, 16)}, ${user.id}, 'free')
      returning id`;
    return { familyId: family.id, userId: user.id };
  }

  async function makeCode(code: string, opts: { maxUses?: number; assignedFamilyId?: number | null; usedCount?: number } = {}) {
    const { maxUses = 1, assignedFamilyId = null, usedCount = 0 } = opts;
    await sql`
      insert into promo_codes (code, plan, max_uses, used_count, assigned_family_id, active)
      values (${code}, 'founding', ${maxUses}, ${usedCount}, ${assignedFamilyId}, true)`;
  }

  async function counts() {
    const [state] = await sql`
      select
        (select count(*)::int from earlybird_redemptions where status <> 'released') as held,
        (select count(*)::int from promo_code_redemptions) as redemptions`;
    return state as { held: number; redemptions: number };
  }

  test("first redeem binds the family, burns one use, writes reservation + audit", async () => {
    await reset();
    const { familyId, userId } = await makeFamily("first");
    await makeCode("C9F-FIRST0001");

    const result = await redeemFoundingCode({ familyId, userId, code: "C9F-FIRST0001" });
    assert.equal(result.priceTier, "founding");

    const [promo] = await sql`select used_count, assigned_family_id from promo_codes where code = 'C9F-FIRST0001'`;
    assert.equal(promo.used_count, 1);
    assert.equal(promo.assigned_family_id, familyId);

    const [hold] = await sql`select status from earlybird_redemptions where family_id = ${familyId}`;
    assert.equal(hold.status, "reserved");

    const { redemptions } = await counts();
    assert.equal(redemptions, 1);
  });

  test("double-tap returns success and does not burn a second use", async () => {
    await reset();
    const { familyId, userId } = await makeFamily("double");
    await makeCode("C9F-DOUBLE001");

    await redeemFoundingCode({ familyId, userId, code: "C9F-DOUBLE001" });
    const second = await redeemFoundingCode({ familyId, userId, code: "C9F-DOUBLE001" });
    assert.equal(second.priceTier, "founding");

    const [promo] = await sql`select used_count from promo_codes where code = 'C9F-DOUBLE001'`;
    assert.equal(promo.used_count, 1, "maxUses=1 code must not be consumed twice");

    const [row] = await sql`select count(*)::int as c from earlybird_redemptions where family_id = ${familyId}`;
    assert.equal(row.c, 1);
    const { redemptions } = await counts();
    assert.equal(redemptions, 1);
  });

  test("pre-bound reissue code records the use and the audit row", async () => {
    await reset();
    const { familyId, userId } = await makeFamily("prebound");
    await makeCode("C9F-PREBOUND1", { assignedFamilyId: familyId, usedCount: 0 });

    const result = await redeemFoundingCode({ familyId, userId, code: "C9F-PREBOUND1" });
    assert.equal(result.priceTier, "founding");

    const [promo] = await sql`select used_count from promo_codes where code = 'C9F-PREBOUND1'`;
    assert.equal(promo.used_count, 1, "used_count must reflect the redemption or getPromoState never sees it");

    const { redemptions, held } = await counts();
    assert.equal(held, 1);
    assert.equal(redemptions, 1);
  });

  test("released family can redeem again while capacity allows", async () => {
    await reset();
    const { familyId, userId } = await makeFamily("released");
    await makeCode("C9F-RELEASED1", { assignedFamilyId: familyId, usedCount: 1 });
    await sql`
      insert into earlybird_redemptions (family_id, user_id, status, released_at)
      values (${familyId}, ${userId}, 'released', now())`;

    await redeemFoundingCode({ familyId, userId, code: "C9F-RELEASED1" });

    const [hold] = await sql`select status from earlybird_redemptions where family_id = ${familyId}`;
    assert.equal(hold.status, "reserved");
  });

  test("released family is refused once the cap is full", async () => {
    await reset();
    const { familyId, userId } = await makeFamily("released-full");
    await makeCode("C9F-RELEASED2", { assignedFamilyId: familyId, usedCount: 1 });
    await sql`
      insert into earlybird_redemptions (family_id, user_id, status, released_at)
      values (${familyId}, ${userId}, 'released', now())`;

    // cap = 2, fill both slots with other families
    for (const name of ["cap-a", "cap-b"]) {
      const other = await makeFamily(name);
      await sql`
        insert into earlybird_redemptions (family_id, user_id, status)
        values (${other.familyId}, ${other.userId}, 'reserved')`;
    }

    await assert.rejects(
      () => redeemFoundingCode({ familyId, userId, code: "C9F-RELEASED2" }),
      /名額已滿/,
    );
    const [hold] = await sql`select status from earlybird_redemptions where family_id = ${familyId}`;
    assert.equal(hold.status, "released", "must not revive a released hold past the cap");
  });

  test("paid founding member is never downgraded", async () => {
    await reset();
    const { familyId, userId } = await makeFamily("paid");
    await makeCode("C9F-PAID00001", { assignedFamilyId: familyId, usedCount: 1 });
    await sql`
      insert into earlybird_redemptions (family_id, user_id, status, paid_at)
      values (${familyId}, ${userId}, 'paid', now())`;

    await assert.rejects(
      () => redeemFoundingCode({ familyId, userId, code: "C9F-PAID00001" }),
      /已有創始會員記錄/,
    );
    const [hold] = await sql`select status from earlybird_redemptions where family_id = ${familyId}`;
    assert.equal(hold.status, "paid");
  });

  test("pre-bound code cannot create the 101st hold when the cap is full", async () => {
    await reset();
    const { familyId, userId } = await makeFamily("prebound-full");
    await makeCode("C9F-PREBOUND2", { assignedFamilyId: familyId, usedCount: 0 });
    for (const name of ["cap-c", "cap-d"]) {
      const other = await makeFamily(name);
      await sql`
        insert into earlybird_redemptions (family_id, user_id, status)
        values (${other.familyId}, ${other.userId}, 'reserved')`;
    }

    await assert.rejects(
      () => redeemFoundingCode({ familyId, userId, code: "C9F-PREBOUND2" }),
      /名額已滿/,
    );
    const [row] = await sql`select count(*)::int as c from earlybird_redemptions where family_id = ${familyId}`;
    assert.equal(row.c, 0);
  });

  test("two pre-bound codes cannot both take the last slot (advisory lock)", async () => {
    await reset();
    const a = await makeFamily("race-a");
    const b = await makeFamily("race-b");
    await makeCode("C9F-RACE0000A", { assignedFamilyId: a.familyId, usedCount: 0 });
    await makeCode("C9F-RACE0000B", { assignedFamilyId: b.familyId, usedCount: 0 });

    // one slot already taken, cap = 2 → exactly one of the two may win
    const filler = await makeFamily("race-filler");
    await sql`
      insert into earlybird_redemptions (family_id, user_id, status)
      values (${filler.familyId}, ${filler.userId}, 'reserved')`;

    const settled = await Promise.allSettled([
      redeemFoundingCode({ familyId: a.familyId, userId: a.userId, code: "C9F-RACE0000A" }),
      redeemFoundingCode({ familyId: b.familyId, userId: b.userId, code: "C9F-RACE0000B" }),
    ]);

    const wins = settled.filter((s) => s.status === "fulfilled").length;
    const losses = settled.filter((s) => s.status === "rejected").length;
    assert.equal(wins, 1, "exactly one request may take the last slot");
    assert.equal(losses, 1);

    const [held] = await sql`select count(*)::int as c from earlybird_redemptions where status <> 'released'`;
    assert.equal(held.c, 2, "cap must never be exceeded");
  });

  test("expired pre-bound code cannot be redeemed, but an in-flight retry still succeeds", async () => {
    await reset();
    const fresh = await makeFamily("expired-new");
    await makeCode("C9F-EXPIRED01", { assignedFamilyId: fresh.familyId, usedCount: 0 });
    await sql`update promo_codes set expires_at = now() - interval '1 day' where code = 'C9F-EXPIRED01'`;

    await assert.rejects(
      () => redeemFoundingCode({ familyId: fresh.familyId, userId: fresh.userId, code: "C9F-EXPIRED01" }),
      /已過期/,
    );

    // a family that already holds a reservation is a retry, not a new claim
    const retry = await makeFamily("expired-retry");
    await makeCode("C9F-EXPIRED02", { assignedFamilyId: retry.familyId, usedCount: 1 });
    await sql`update promo_codes set expires_at = now() - interval '1 day' where code = 'C9F-EXPIRED02'`;
    await sql`
      insert into earlybird_redemptions (family_id, user_id, status)
      values (${retry.familyId}, ${retry.userId}, 'reserved')`;

    const result = await redeemFoundingCode({ familyId: retry.familyId, userId: retry.userId, code: "C9F-EXPIRED02" });
    assert.equal(result.priceTier, "founding");
  });

  test.after(async () => {
    await sql.end({ timeout: 5 });
    // A rejected transaction keeps a pooled client alive; make sure the runner exits
    // instead of hanging after the last assertion (it did before this guard).
    setTimeout(() => process.exit(0), 100).unref();
  });
}
