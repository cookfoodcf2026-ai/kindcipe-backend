import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("family join notification DB tests (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key";
  delete process.env.BETA_ALL_PAID;

  const postgres = (await import("postgres")).default;
  const { appRouter } = await import("../routers");

  const sql = postgres(TEST_DB, { max: 5 });
  const createdFamilies: number[] = [];
  const createdUsers: string[] = [];

  type PushCall = Array<{ to: string; title: string; body: string; data?: Record<string, unknown> }>;
  type EmailCall = { from?: string; to?: string; subject?: string; text?: string; html?: string };
  const pushCalls: PushCall[] = [];
  const emailCalls: EmailCall[] = [];
  let failEmail = false;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(url).includes("api.resend.com")) {
      if (failEmail) {
        return { ok: false, status: 500, text: async () => "resend down" } as Response;
      }
      emailCalls.push(body as EmailCall);
    } else {
      pushCalls.push(body as PushCall);
    }
    return { ok: true, status: 200, text: async () => "" } as Response;
  }) as typeof fetch;

  function ctx(userId: string, name: string) {
    return {
      user: { id: userId, openId: `join-${userId.slice(0, 8)}`, name, role: "user" },
      activeFamilyId: null,
      activeFamilyRole: null,
      readOnly: false,
      sharedLocked: false,
      clientPlatform: "mobile",
      req: { headers: {} },
      res: {},
    } as any;
  }

  async function makeUser(name: string, email: string | null = null, language: string | null = null) {
    const userId = randomUUID();
    createdUsers.push(userId);
    await sql`
      insert into users (id, open_id, name, email, language)
      values (${userId}, ${`join-${userId.slice(0, 8)}`}, ${name}, ${email}, ${language})`;
    return userId;
  }

  async function makeFamily(label: string, language: string | null = null, ownerEmail: string | null = null, ownerUserLanguage: string | null = null) {
    const userId = await makeUser(label, ownerEmail, ownerUserLanguage);
    const inviteCode = `JN${Math.random().toString(36).slice(2, 10).toUpperCase()}`.slice(0, 16);
    const [family] = await sql`
      insert into families (name, invite_code, owner_id, subscription_status, max_members, language)
      values (${`${label} Kitchen`}, ${inviteCode}, ${userId}, 'free', 2, ${language})
      returning id, invite_code`;
    createdFamilies.push(family.id);
    await sql`
      insert into family_members (family_id, user_id, family_role, is_default)
      values (${family.id}, ${userId}, 'owner', true)`;
    return { userId, familyId: family.id as number, inviteCode: family.invite_code as string };
  }

  async function addPushToken(userId: string, familyId: number | null, token: string) {
    await sql`
      insert into push_tokens (user_id, family_id, token)
      values (${userId}, ${familyId}, ${token})`;
  }

  test.beforeEach(() => {
    pushCalls.length = 0;
    emailCalls.length = 0;
    failEmail = false;
  });

  test.after(async () => {
    globalThis.fetch = originalFetch;
    if (createdFamilies.length > 0) {
      await sql`delete from push_tokens where family_id in ${sql(createdFamilies)}`;
      await sql`delete from family_members where family_id in ${sql(createdFamilies)}`;
      await sql`delete from families where id in ${sql(createdFamilies)}`;
    }
    if (createdUsers.length > 0) {
      await sql`delete from push_tokens where user_id in ${sql(createdUsers)}`;
      await sql`delete from users where id in ${sql(createdUsers)}`;
    }
    await sql.end();
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });

  test("fresh join pushes exactly one notification to the owner", async () => {
    const ownerToken = "ExponentPushToken[join-owner-token]";
    const owner = await makeFamily("Owner");
    await addPushToken(owner.userId, owner.familyId, ownerToken);
    const joinerId = await makeUser("Joiner");
    await addPushToken(joinerId, null, "ExponentPushToken[join-joiner-token]");

    const caller = appRouter.createCaller(ctx(joinerId, "Joiner"));
    const result: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });

    assert.equal(result.success, true);
    assert.equal(pushCalls.length, 1, "fresh join must send exactly one push request");
    assert.equal(pushCalls[0].length, 1, "only the owner is notified, not the joiner");
    assert.equal(pushCalls[0][0].to, ownerToken);
    assert.equal(pushCalls[0][0].title, "🎉 新成員加入 Owner Kitchen");
    assert.equal(pushCalls[0][0].body, "Joiner 加入咗你廚房");
    assert.equal(pushCalls[0][0].data?.type, "family_member_joined");
  });

  test("owner language drives the push copy", async () => {
    const owner = await makeFamily("English", "en");
    await addPushToken(owner.userId, owner.familyId, "ExponentPushToken[join-en-token]");
    const joinerId = await makeUser("Joiner");

    const caller = appRouter.createCaller(ctx(joinerId, "Joiner"));
    await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });

    assert.equal(pushCalls.length, 1);
    assert.equal(pushCalls[0][0].title, "New member joined English Kitchen");
    assert.equal(pushCalls[0][0].body, "Joiner joined your kitchen");
  });

  test("re-join does not notify", async () => {
    const owner = await makeFamily("Rejoin");
    await addPushToken(owner.userId, owner.familyId, "ExponentPushToken[join-rejoin-token]");
    const joinerId = await makeUser("Rejoiner");
    const caller = appRouter.createCaller(ctx(joinerId, "Rejoiner"));

    await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    assert.equal(pushCalls.length, 1);

    pushCalls.length = 0;
    const second: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });

    assert.equal(second.alreadyMember, true);
    assert.equal(pushCalls.length, 0, "re-join must not notify");
  });

  test("invalid invite code notifies nobody", async () => {
    const owner = await makeFamily("Invalid");
    await addPushToken(owner.userId, owner.familyId, "ExponentPushToken[join-invalid-token]");
    const joinerId = await makeUser("Lost");

    const caller = appRouter.createCaller(ctx(joinerId, "Lost"));
    await assert.rejects(
      () => caller.family.join({ inviteCode: "NOSUCH1", familyRole: "member" }),
      (error: any) => error?.code === "NOT_FOUND",
    );
    assert.equal(pushCalls.length, 0, "invalid code must not notify anyone");
  });

  test("owner joining own kitchen does not notify", async () => {
    const owner = await makeFamily("SelfJoin");
    await addPushToken(owner.userId, owner.familyId, "ExponentPushToken[join-self-token]");

    const caller = appRouter.createCaller(ctx(owner.userId, "SelfJoin"));
    const result: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });

    assert.equal(result.alreadyMember, true);
    assert.equal(pushCalls.length, 0, "self join must not notify");
  });

  function flush() {
    return new Promise<void>((resolve) => setImmediate(resolve));
  }

  test("fresh join emails the owner exactly once (zh-TW default)", async () => {
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const owner = await makeFamily("EmailOwner", null, ownerEmail);
    const joinerId = await makeUser("Joiner");

    const caller = appRouter.createCaller(ctx(joinerId, "Joiner"));
    const result: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    await flush();

    assert.equal(result.success, true);
    assert.equal(emailCalls.length, 1, "fresh join must send exactly one email");
    assert.equal(emailCalls[0].to, ownerEmail);
    assert.equal(emailCalls[0].subject, "Joiner 加入咗你嘅廚房「EmailOwner Kitchen」");
    assert.match(String(emailCalls[0].text), /Joiner 用邀請碼加入咗你嘅廚房。/);
    assert.match(String(emailCalls[0].text), /打開 Kindcipe 睇下: https:\/\/app\.kindcipe\.com/);
    assert.match(String(emailCalls[0].text), /你收到呢封係因為有人加入你嘅廚房。/);
  });

  test("re-join does not email the owner", async () => {
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const owner = await makeFamily("RejoinEmail", null, ownerEmail);
    const joinerId = await makeUser("Rejoiner");
    const caller = appRouter.createCaller(ctx(joinerId, "Rejoiner"));

    await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    await flush();
    assert.equal(emailCalls.length, 1);

    emailCalls.length = 0;
    const second: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    await flush();

    assert.equal(second.alreadyMember, true);
    assert.equal(emailCalls.length, 0, "re-join must not email");
  });

  test("owner without email is skipped", async () => {
    const owner = await makeFamily("NoEmailOwner");
    const joinerId = await makeUser("Joiner");

    const caller = appRouter.createCaller(ctx(joinerId, "Joiner"));
    const result: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    await flush();

    assert.equal(result.success, true);
    assert.equal(emailCalls.length, 0, "owner without email must not receive an email");
  });

  test("English owner receives the English email", async () => {
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const owner = await makeFamily("EnglishEmail", null, ownerEmail, "en");
    const joinerId = await makeUser("Joiner");

    const caller = appRouter.createCaller(ctx(joinerId, "Joiner"));
    await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    await flush();

    assert.equal(emailCalls.length, 1);
    assert.equal(emailCalls[0].to, ownerEmail);
    assert.equal(emailCalls[0].subject, 'Joiner joined your kitchen "EnglishEmail Kitchen"');
    assert.match(String(emailCalls[0].text), /Joiner joined your kitchen with your invite code\./);
    assert.match(String(emailCalls[0].text), /Open Kindcipe to take a look: https:\/\/app\.kindcipe\.com/);
  });

  test("email failure does not fail the join", async () => {
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const owner = await makeFamily("EmailDown", null, ownerEmail);
    await addPushToken(owner.userId, owner.familyId, "ExponentPushToken[join-email-down-token]");
    const joinerId = await makeUser("Joiner");

    failEmail = true;
    const caller = appRouter.createCaller(ctx(joinerId, "Joiner"));
    const result: any = await caller.family.join({ inviteCode: owner.inviteCode, familyRole: "member" });
    await flush();

    assert.equal(result.success, true, "email failure must not block a successful join");
    assert.equal(emailCalls.length, 0);
    assert.equal(pushCalls.length, 1, "push is still attempted when email fails");
  });
}
