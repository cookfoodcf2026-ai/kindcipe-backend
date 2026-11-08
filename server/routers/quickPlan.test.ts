import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("quickPlan DB tests (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;
  delete process.env.BETA_ALL_PAID;

  const postgres = (await import("postgres")).default;
  const { quickPlanRouter } = await import("./quickPlan");
  const { appRouter } = await import("../routers");

  const sql = postgres(TEST_DB, { max: 5 });
  const createdFamilies: number[] = [];
  const createdUsers: string[] = [];
  const createdRecipes: number[] = [];
  const STARTER = ["粟米蛋花湯", "豉汁蒸排骨", "蝦仁炒蛋", "蒜蓉炒菜心"];

  function hkToday(): string {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function ctx(userId: string, familyId: number) {
    return {
      user: { id: userId, openId: `qp-${userId.slice(0, 8)}`, name: "QuickPlan Tester", role: "user" },
      activeFamilyId: familyId,
      activeFamilyRole: "owner",
      readOnly: false,
      sharedLocked: false,
      clientPlatform: "mobile",
      req: { headers: {} },
      res: {},
    } as any;
  }

  async function makeFamily(label: string) {
    const userId = randomUUID();
    createdUsers.push(userId);
    await sql`insert into users (id, open_id, name) values (${userId}, ${`qp-${label}-${userId.slice(0, 8)}`}, ${label})`;
    const inviteCode = `QP${Math.random().toString(36).slice(2, 10).toUpperCase()}`.slice(0, 16);
    const [family] = await sql`
      insert into families (name, invite_code, owner_id, subscription_status, max_members)
      values (${label}, ${inviteCode}, ${userId}, 'free', 2)
      returning id, invite_code`;
    createdFamilies.push(family.id);
    await sql`
      insert into family_members (family_id, user_id, family_role, is_default)
      values (${family.id}, ${userId}, 'owner', true)`;
    return { userId, familyId: family.id as number, inviteCode: family.invite_code as string };
  }

  async function addRecipe(name: string, dishType: string) {
    const [row] = await sql`
      insert into official_recipes
        (imported_by_user_id, name, dish_type, recipe_category, cook_time, servings, difficulty, ingredients, steps, is_active)
      values
        ('quickPlan-test', ${name}, ${dishType}, '家常', 20, 4, 'easy',
         ${JSON.stringify([
           { name: "雞肉", quantity: "300", unit: "克" },
           { name: "鹽", quantity: "少許", unit: "" },
         ])},
         ${JSON.stringify(["1. 準備食材", "2. 煮熟"])},
         true)
      returning id`;
    createdRecipes.push(row.id);
    return row.id as number;
  }

  function acceptItems(recipes: Array<{ id: number; name: string }>, date = hkToday()) {
    return recipes.map((recipe) => ({
      date,
      buyDate: date,
      recipeId: `official_${recipe.id}`,
      recipeName: recipe.name,
      ingredients: [{ name: "雞肉", quantity: "300", unit: "克" }],
    }));
  }

  async function monthlyCredits(familyId: number) {
    const [row] = await sql`
      select coalesce(ai_credits, 0)::int as credits
      from family_usage_monthly
      where family_id = ${familyId}
      order by id desc limit 1`;
    return (row?.credits ?? 0) as number;
  }

  test.before(async () => {
    for (let i = 0; i < STARTER.length; i++) {
      await addRecipe(STARTER[i], i === 0 ? "soup" : "meat");
    }
  });

  test.after(async () => {
    if (createdFamilies.length > 0) {
      await sql`delete from ai_chef_seen_recipes where family_id in ${sql(createdFamilies)}`;
      await sql`delete from shopping_items where family_id in ${sql(createdFamilies)}`;
      await sql`delete from meal_plans where family_id in ${sql(createdFamilies)}`;
      await sql`delete from usage_events where family_id in ${sql(createdFamilies)}`;
      await sql`delete from family_usage_monthly where family_id in ${sql(createdFamilies)}`;
      await sql`delete from family_members where family_id in ${sql(createdFamilies)}`;
      await sql`delete from families where id in ${sql(createdFamilies)}`;
    }
    if (createdUsers.length > 0) {
      await sql`delete from users where id in ${sql(createdUsers)}`;
    }
    if (createdRecipes.length > 0) {
      await sql`delete from official_recipes where id in ${sql(createdRecipes)}`;
    }
    await sql.end();
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });

  test("starter suggest creates no reservation and no usage event (walk-away = 0)", async () => {
    const { userId, familyId } = await makeFamily("starter-suggest");
    const caller = quickPlanRouter.createCaller(ctx(userId, familyId));

    const result: any = await caller.suggest({
      startDate: hkToday(),
      days: 1,
      servings: 4,
      starter: true,
      starterVariant: 0,
    });

    assert.equal(result.days.length, 1);
    assert.equal(result.days[0].recipes.length, 4);
    const [usage] = await sql`select count(*)::int as n from usage_events where family_id = ${familyId}`;
    assert.equal(usage.n, 0, "suggest must not reserve or commit any credit");
    assert.equal(await monthlyCredits(familyId), 0);
  });

  test("starter accept charges 0 credits", async () => {
    const { userId, familyId } = await makeFamily("starter-accept");
    const caller = quickPlanRouter.createCaller(ctx(userId, familyId));
    const recipes = await Promise.all(STARTER.map(async (name, i) => {
      const [row] = await sql`select id, name from official_recipes where name = ${name} and is_active = true limit 1`;
      assert.ok(row, `starter recipe ${name} must be seeded`);
      return { id: row.id as number, name: row.name as string, dishType: i === 0 ? "soup" : "meat" };
    }));

    await caller.accept({
      clientRequestId: "starter-free-1",
      items: acceptItems(recipes),
    });

    assert.equal(await monthlyCredits(familyId), 0);
    const [event] = await sql`
      select credits, status from usage_events
      where family_id = ${familyId} and idempotency_key = 'accept:starter-free-1'`;
    assert.equal(event.credits, 0);
    assert.equal(event.status, "consumed");
  });

  test("non-starter accept charges exactly 1 credit", async () => {
    const { userId, familyId } = await makeFamily("nonstarter-accept");
    const caller = quickPlanRouter.createCaller(ctx(userId, familyId));
    const officialId = await addRecipe("測試非新手菜", "meat");

    await caller.accept({
      clientRequestId: "nonstarter-1",
      items: acceptItems([{ id: officialId, name: "測試非新手菜" }]),
    });

    assert.equal(await monthlyCredits(familyId), 1);
    const [event] = await sql`
      select credits, status from usage_events
      where family_id = ${familyId} and idempotency_key = 'accept:nonstarter-1'`;
    assert.equal(event.credits, 1);
    assert.equal(event.status, "consumed");
  });

  test("retried accept with the same clientRequestId charges only once", async () => {
    const { userId, familyId } = await makeFamily("retry-accept");
    const caller = quickPlanRouter.createCaller(ctx(userId, familyId));
    const officialId = await addRecipe("測試重試菜", "meat");
    const items = acceptItems([{ id: officialId, name: "測試重試菜" }]);

    await caller.accept({ clientRequestId: "retry-1", items });
    const second: any = await caller.accept({ clientRequestId: "retry-1", items });

    assert.equal(await monthlyCredits(familyId), 1);
    const [events] = await sql`
      select count(*)::int as n, max(credits)::int as credits from usage_events
      where family_id = ${familyId} and idempotency_key = 'accept:retry-1'`;
    assert.equal(events.n, 1);
    assert.equal(events.credits, 1);
    const [plans] = await sql`
      select count(*)::int as n from meal_plans
      where family_id = ${familyId} and note = 'quickPlan:retry-1'`;
    assert.equal(plans.n, 1, "retry must not insert duplicate meal plans");
    assert.equal(second.mealPlanCount, 1);
  });

  test("join invalid code rejects with NOT_FOUND (visible error path)", async () => {
    const { userId, familyId } = await makeFamily("join-invalid");
    const caller = appRouter.createCaller(ctx(userId, familyId));
    await assert.rejects(
      () => caller.family.join({ inviteCode: "NOSUCH1", familyRole: "member" }),
      (error: any) => error?.code === "NOT_FOUND",
    );
  });

  test("join valid code joins the kitchen and is idempotent", async () => {
    const owner = await makeFamily("join-owner");
    const joinerId = randomUUID();
    createdUsers.push(joinerId);
    await sql`insert into users (id, open_id, name) values (${joinerId}, ${`qp-joiner-${joinerId.slice(0, 8)}`}, 'Joiner')`;
    const caller = appRouter.createCaller({
      user: { id: joinerId, openId: `qp-joiner-${joinerId.slice(0, 8)}`, name: "Joiner", role: "user" },
      activeFamilyId: null,
      activeFamilyRole: null,
      readOnly: false,
      sharedLocked: false,
      clientPlatform: "mobile",
      req: { headers: {} },
      res: {},
    } as any);

    const first: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    assert.equal(first.success, true);
    assert.equal(first.family.id, owner.familyId);

    const second: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    assert.equal(second.success, true);
    assert.equal(second.alreadyMember, true);

    const [members] = await sql`
      select count(*)::int as n from family_members
      where family_id = ${owner.familyId} and user_id = ${joinerId}`;
    assert.equal(members.n, 1, "already-member retry must not duplicate membership");
  });
}
