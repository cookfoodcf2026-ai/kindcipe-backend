import { resolveChefIntent } from "../services/chefIntent";
for (const t of ["我要 3 道菜", "我要三道菜", "多幾款", "3餸1湯", "2 人食。2 餸 1 湯"]) {
  const i = resolveChefIntent(t, { hasImage: false } as any);
  console.log(t, "→", JSON.stringify({ kind: i.kind, wantsCards: i.wantsCards, total: i.requested.total, reason: i.reason }));
}
