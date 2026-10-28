import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { getYearMonthKey, releaseStaleLlmBudgetReservations } from "./llmCost";

const localUrl = process.env.TEST_DATABASE_URL;
if (!localUrl) throw new Error("TEST_DATABASE_URL is required for test:chef:db");
process.env.DATABASE_URL = localUrl;
const sql = postgres(localUrl, { max: 1 });
const familyId = 910001;
const userId = "stale-budget-test";
const now = Date.now();
const currentMonth = getYearMonthKey();
const previousMonth = getYearMonthKey(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)));

async function clean() {
  await sql`delete from llm_budget_reservations where family_id=${familyId}`;
  await sql`delete from family_usage_monthly where family_id=${familyId}`;
  await sql`delete from llm_cost_monthly where family_id=${familyId}`;
}

async function ledger(month: string, familyReserved: number, memberReserved: number) {
  await sql`insert into family_usage_monthly (family_id,year_month,ai_credits,imports,custom_recipes,estimated_cost_micros,llm_reserved_micros)
    values (${familyId},${month},0,0,0,0,${familyReserved})
    on conflict (family_id,year_month) do update set llm_reserved_micros=${familyReserved}`;
  await sql`insert into llm_cost_monthly (family_id,user_id,year_month,actual_cost_micros,reserved_cost_micros)
    values (${familyId},${userId},${month},0,${memberReserved})
    on conflict (family_id,user_id,year_month) do update set reserved_cost_micros=${memberReserved}`;
}

async function reservation(month: string, estimate: number, reservedUntil: Date, status = "reserved") {
  const [r] = await sql`insert into llm_budget_reservations
    (family_id,user_id,year_month,estimate_micros,status,reserved_until)
    values (${familyId},${userId},${month},${estimate},${status},${reservedUntil})
    returning id`;
  return Number(r.id);
}

async function values(id: number) {
  const [r] = await sql`select status from llm_budget_reservations where id=${id}`;
  const [f] = await sql`select llm_reserved_micros from family_usage_monthly where family_id=${familyId} and year_month=${currentMonth}`;
  const [m] = await sql`select reserved_cost_micros from llm_cost_monthly where family_id=${familyId} and user_id=${userId} and year_month=${currentMonth}`;
  return { status: r.status, familyReserved: f?.llm_reserved_micros, memberReserved: m?.reserved_cost_micros };
}

test.before(clean);
test.after(async () => { await clean(); await sql.end(); setTimeout(() => process.exit(process.exitCode ?? 0), 100); });

test("expired current-month reservation is released and reduced", async () => {
  await clean();
  await ledger(currentMonth, 10000, 10000);
  const id = await reservation(currentMonth, 6000, new Date(now - 60_000));
  const out = await releaseStaleLlmBudgetReservations();
  assert.equal(out.released, 1);
  const v = await values(id);
  assert.equal(v.status, "released");
  assert.equal(v.familyReserved, 4000);
  assert.equal(v.memberReserved, 4000);
});

test("unexpired reservation is untouched", async () => {
  await clean();
  await ledger(currentMonth, 6000, 6000);
  const id = await reservation(currentMonth, 6000, new Date(now + 60_000));
  const out = await releaseStaleLlmBudgetReservations();
  assert.equal(out.released, 0);
  const v = await values(id);
  assert.equal(v.status, "reserved");
  assert.equal(v.familyReserved, 6000);
  assert.equal(v.memberReserved, 6000);
});

test("finalized and released reservations are not decremented again", async () => {
  await clean();
  await ledger(currentMonth, 10000, 10000);
  const finalized = await reservation(currentMonth, 6000, new Date(now - 60_000), "finalized");
  const released = await reservation(currentMonth, 6000, new Date(now - 60_000), "released");
  await releaseStaleLlmBudgetReservations();
  for (const id of [finalized, released]) {
    const [r] = await sql`select status from llm_budget_reservations where id=${id}`;
    assert.equal(r.status, id === finalized ? "finalized" : "released");
  }
  assert.equal((await values(finalized)).familyReserved, 10000);
});

test("cross-month reservation is marked stale without touching current month", async () => {
  await clean();
  await ledger(currentMonth, 500, 500);
  await ledger(previousMonth, 6000, 6000);
  const id = await reservation(previousMonth, 6000, new Date(now - 60_000));
  const out = await releaseStaleLlmBudgetReservations();
  assert.equal(out.stale, 1);
  const [r] = await sql`select status from llm_budget_reservations where id=${id}`;
  assert.equal(r.status, "stale");
  const [current] = await sql`select llm_reserved_micros from family_usage_monthly where family_id=${familyId} and year_month=${currentMonth}`;
  const [old] = await sql`select llm_reserved_micros from family_usage_monthly where family_id=${familyId} and year_month=${previousMonth}`;
  assert.equal(current.llm_reserved_micros, 500);
  assert.equal(old.llm_reserved_micros, 6000);
});

test("two consecutive sweeps are idempotent", async () => {
  await clean();
  await ledger(currentMonth, 6000, 6000);
  const id = await reservation(currentMonth, 6000, new Date(now - 60_000));
  const first = await releaseStaleLlmBudgetReservations();
  const second = await releaseStaleLlmBudgetReservations();
  assert.equal(first.released, 1);
  assert.equal(second.released, 0);
  const v = await values(id);
  assert.equal(v.familyReserved, 0);
  assert.equal(v.memberReserved, 0);
});
