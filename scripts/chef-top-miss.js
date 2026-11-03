#!/usr/bin/env node
/**
 * 每週 AI Chef「答唔到」報告（讀 chef_query_log）
 *
 * 用法（在 Railway container 內跑）：
 *   railway ssh --service kindcipe-backend "cd /app && node scripts/chef-top-miss.js 7"
 *
 * 參數：天數（預設 7）
 * 輸出：總 request 數、有卡／0 卡、真實 0 卡 query 排名
 */
const postgres = require("postgres");

(async () => {
  const days = Number(process.argv[2] || 7);
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const [totals] = await sql`
      select
        count(*)::int                                          as requests,
        count(*) filter (where served > 0)::int                 as served_ok,
        count(*) filter (where served = 0)::int                 as zero,
        round(avg(duration_ms))::int                            as avg_ms,
        sum(credits)::int                                       as credits
      from chef_query_log
      where created_at > now() - ${sql.unsafe(`interval '${days} days'`)}
    `;

    const misses = await sql`
      select raw_text, count(*)::int as times, max(reason) as last_reason
      from chef_query_log
      where served = 0
        and created_at > now() - ${sql.unsafe(`interval '${days} days'`)}
      group by raw_text
      order by times desc
      limit 20
    `;

    console.log(JSON.stringify({
      window_days: days,
      totals,
      rate: totals.requests ? `${totals.served_ok}/${totals.requests}` : "0/0",
      pct: totals.requests ? Math.round((totals.served_ok / totals.requests) * 100) : 0,
      top_misses: misses,
    }, null, 2));
  } catch (e) {
    console.log("ERR " + e.message);
  }
  await sql.end();
})();
