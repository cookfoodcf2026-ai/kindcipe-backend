import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name: string, fallback = "") => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const url = arg("--url", "http://localhost:3001/api/trpc/aiRecipe.chat");
const tokenFile = arg("--token-file", ".tmp-e2e-token");
const logFile = arg("--log", ".tmp-swap-server.log");
const familyId = arg("--family", "7");
const runs = Math.max(1, Number(arg("--runs", "5")));
const token = readFileSync(tokenFile, "utf8").trim();
const body = {
  json: {
    messages: [
      { role: "user", content: "我要三餸一湯" },
      { role: "assistant", content: "以下係食譜" },
      { role: "user", content: "唔要呢個，換一張" },
    ],
    excludeNames: ["番茄炒蛋"],
    aiEntry: "swap_ai",
    mode: "ai",
    lang: "zh-TW",
  },
};

type Sample = { total: number; lib: number; ai: number; served: number; aiCards: number; credits: number; timeout: number; httpStatus: number };
const results: Sample[] = [];

function phaseFromLog(): Omit<Sample, "total" | "httpStatus"> {
  const lines = readFileSync(logFile, "utf8").split(/\r?\n/).filter((line) => line.includes("[AI Chef][swap]"));
  const tail = lines.slice(-3);
  const parsed = tail.map((line) => {
    const m = line.match(/phase=(lib|ai|total) ms=(\d+) served=(\d+) ai=(\d+) credits=(\d+)(?: timeout=(\d+))?/);
    return m ? { phase: m[1], ms: Number(m[2]), served: Number(m[3]), aiCards: Number(m[4]), credits: Number(m[5]), timeout: Number(m[6] ?? 0) } : null;
  }).filter(Boolean) as Array<{ phase: string; ms: number; served: number; aiCards: number; credits: number; timeout: number }>;
  const total = parsed.find((item) => item.phase === "total");
  return {
    lib: parsed.find((item) => item.phase === "lib")?.ms ?? 0,
    ai: parsed.find((item) => item.phase === "ai")?.ms ?? 0,
    served: total?.served ?? 0,
    aiCards: total?.aiCards ?? 0,
    credits: total?.credits ?? 0,
    timeout: total?.timeout ?? 0,
  };
}

for (let i = 0; i < runs; i++) {
  const started = performance.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      cookie: `app_session_id=${token}`,
      "X-Family-Id": familyId,
      "X-Client-Platform": "web",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  await resp.text();
  const total = Math.round(performance.now() - started);
  const phase = phaseFromLog();
  const sample = { total, httpStatus: resp.status, ...phase };
  results.push(sample);
  console.log(JSON.stringify(sample));
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const sorted = [...results].sort((a, b) => a.total - b.total);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].total;
console.log(JSON.stringify({
  runs: results.length,
  p50: pct(50),
  p95: pct(95),
  max: sorted[sorted.length - 1].total,
  samples: results,
}));
