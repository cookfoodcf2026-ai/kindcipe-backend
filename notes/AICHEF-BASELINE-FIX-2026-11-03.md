# AI Chef — baseline 2026-11-03 修復單

> 來源：Hermes baseline（local `kindcipe_restore_test`，314 official / 180 custom）
> 288 turns × 三組家庭，pass 185/288 = 64.2%

## 現況（唔准靠感覺，重跑就有數）

| 組 | family | 出卡率 | dead-end | 0卡扣費 | 期望 pass | p95 |
|---|---|---|---|---|---|---|
| new-user | 5 | 62.5% | 12.5% | 0 | 66.7% | 2.5s |
| custom-33 | 42 | 64.6% | 11.5% | 0 | 61.5% | 14.9s |
| ig-imports-13 | 32 | 65.6% | 9.4% | 0 | 64.6% | 2.2s |

失敗 103 個：**54 個 = 具體食物名／條件 → 0 卡**、37 個 = 卡數／內容不符、12 個 = 「要 AI 煮」fixture 期望過時。

## P0 — library miss：具體食物名直接 clarify，冇做 fallback

證據（每組都重現）：
- `我想食魚面` → `library_miss`，served=0
- `蝦子麵` → `library_miss`
- `我想食魚湯粉同菜` → `library_miss`
- `魚湯粉` → `ambiguous_food`
- `今晚得半個鐘，想食快啲` → `ambiguous_food`
- `我要七成熟` → `ambiguous_food`

要求：
1. 具體食物詞（含未收錄菜名）→ **先做 raw-term / 詞族 / 近似分類檢索**（例：蝦子麵 → 麵類；魚湯粉 → 湯粉／湯麵），命中就出卡
2. 真係冇候選才 clarify，並 log `library_miss_after_fallback need= got=`
3. **唔准**用「放寬 scenario/cookTime」當萬能藥；唔准為咗出卡而出不相關卡（`forbiddenCards` 由 fixture 定義，出了就 fail）

## P1 — sticky context：follow-up 斷線

證據：
- `有邊幾款？`（c05，前置已出 3 卡）→ served=0
- `再一套`（c03）→ `ambiguous_food`，served=0

要求：上一輪有卡／有 meal state 時，`有邊幾款／再一套／有冇最接近` 要沿住上一輪條件再出，唔准當新問題。

## P2 — fixture 期望 vs 現行為（要車主決定，唔准自己改）

`我要 AI 煮` / `要 AI`（c02/c03/c04/c08，共 12 turn）：fixture 期望 `ask, served=0, credits=0`，實際出 1 張 AI 卡 + 1 credit。
判斷：現行為合理（用戶明講要 AI 就生成並收費），應該改 fixture 而唔係改 code。**等車主確認。**

## 驗收（修完必須跑同一套）

```bash
bash ~/.hermes/scripts/ai_chef_baseline.sh
cat ~/kindcipe-baselines/latest.md
```

開賣 gate（5 條全過）：
1. 0 卡扣 credit = 0
2. 出卡率 ≥ 70%
3. dead-end ≤ 10%
4. 期望值 pass ≥ 80%
5. p95 延遲 ≤ 25s

## 紅線

- 收費 invariant 不變：`served === 0` 一定 0 credit；只有 AI 卡才 1 credit
- 唔准放寬 `forbiddenCards` 去換出卡率
- 唔准改 `simulateChef.ts` 嘅計分去令數字好睇
- 每次改完只報「gate 幾多條過」，唔可以講「大致得咗」
