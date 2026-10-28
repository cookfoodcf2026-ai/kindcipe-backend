import postgres from "postgres";

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_PUBLIC_URL or DATABASE_URL is required");
  process.exit(1);
}
const isLocal = /^(localhost|127\.0\.0\.1)/.test(new URL(url).hostname);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

try {
  const rows = await sql`
    SELECT
      route,
      count(*)::int AS requests,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_micros))::int AS p50_cost_micros,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY cost_micros))::int AS p95_cost_micros,
      round(percentile_cont(0.99) WITHIN GROUP (ORDER BY cost_micros))::int AS p99_cost_micros,
      round(avg(input_tokens))::int AS avg_input_tokens,
      round(avg(output_tokens))::int AS avg_output_tokens,
      round(avg(cost_micros))::int AS avg_cost_micros
    FROM llm_cost_events
    GROUP BY route
    ORDER BY route
  `;
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await sql.end();
}
