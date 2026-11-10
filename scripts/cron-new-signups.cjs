const postgres = require("postgres");

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
  const rows = await sql`
    select u.id, coalesce(u.email,'-') email, coalesce(u.name,'-') name,
           coalesce(u.login_method,'-') via, u.created_at
    from public.users u
    where u.created_at > now() - interval '16 minutes'
    order by u.created_at asc`;

  if (!rows.length) { await sql.end(); return; }

  const lines = [];
  for (const r of rows) {
    const mem = await sql`select family_id from family_members where user_id = ${r.id}`;
    const famIds = mem.map((m) => m.family_id);

    // Onboarding = the starter plan created on their behalf
    let starterMeals = 0;
    if (famIds.length) {
      starterMeals = (await sql`select count(*)::int n from meal_plans where family_id in ${sql(famIds)} and coalesce(proposed_by_user_id,'') = ${r.id}`)[0].n;
    }
    const onboarded = starterMeals > 0 ? "✅" : "❌";

    // Voluntary behaviour (after onboarding)
    const ownRecipes = (await sql`select count(*)::int n from custom_recipes where created_by_user_id = ${r.id}`)[0].n;
    const aiSessions = (await sql`select count(*)::int n from ai_chat_sessions where user_id = ${r.id}`)[0].n;
    const bought = (await sql`select count(*)::int n from shopping_items where bought_by_user_id = ${r.id}`)[0].n;
    const selfMeals = (await sql`
      select count(*)::int n from meal_plans
      where proposed_by_user_id = ${r.id}
        and created_at > (select created_at from public.users where id = ${r.id}) + interval '10 minutes'`)[0].n;
    const credits = (await sql`select coalesce(sum(credits),0)::int n from usage_events where user_id = ${r.id}`)[0].n;

    const voluntary = selfMeals + ownRecipes + aiSessions + bought;
    lines.push(
      `${r.created_at.toISOString().slice(11, 16)}Z ${r.email} (${r.name}, ${r.via}) ` +
      `onboarding ${onboarded} ｜ 自發 ${voluntary === 0 ? "0 ← 未互動" : voluntary} ` +
      `[自排 ${selfMeals}、食譜 ${ownRecipes}、AI ${aiSessions}、買嘢 ${bought}] credits ${credits}`
    );
  }
  console.log("🆕 新登記 " + rows.length + " 個\n" + lines.join("\n"));
  await sql.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
