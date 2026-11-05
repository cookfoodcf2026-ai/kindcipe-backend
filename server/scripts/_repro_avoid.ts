process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:5434/kc";
process.env.NODE_ENV = "test";

async function main() {
  const { processAIChefChat } = await import("../routers/aiRecipe");
  for (const avoid of [["蝦"], ["雞"], ["花生"]]) {
    const res: any = await processAIChefChat(
      [{ role: "user", content: `4 人食。3 餸 1 湯；避免：${avoid[0]}` }],
      13,
      1,
      "library",
      [],
      { count: 4, excludeCategories: ["甜品", "湯水"] },
      "zh-TW",
      avoid,
    );
    const names = (res.recipes ?? []).map((r: any) => r.name);
    console.log(
      `RESULT avoid=${avoid[0]} cards=${names.length} leaked=${names.filter((n: string) => n.includes(avoid[0])).length} :: ${names.join(" | ")}`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("REPRO_FAILED", e);
  process.exit(1);
});
