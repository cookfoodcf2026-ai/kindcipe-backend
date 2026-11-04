# AI Chef Stage-1 交接（2026-10-30）

> 呢份係新 session 嘅唯一入口。舊 session `ses_f80edc6a7ffeAeA2mgGWkMzUXP` 已 20,928 條訊息 / 7.8GB，唔可以再用。

## 目標（車主定義）

任何用戶、任何講法（錯字、口語、中英夾雜、含糊、追問），AI Chef 都要自然、logic、make sense 對答；
有食譜就出卡、冇就問得具體；唔會亂出卡、唔會亂扣 credit。

## 現況（實測，唔係估）

```
repo      ~/Desktop/Kindcipe/manus/kindcipe-backend   branch pre-launch-stable
backend   HEAD 48e17c1   ahead origin/main 33   （未 push、未 deploy）
app-4     HEAD 758b1c59  ahead 39               （未 push）
production 仍行 e1e054c
test:chef 165 pass / 0 fail    backend tsc 0    app-4 tsc 0
```

## 已完成

1. **M1 隔離 pipeline**：`server/services/chefDomain/`（types/state/queryPlan/repository/turn + test），
   525 行，無 import aiRecipe、無 drizzle，`FakeRepository` 已改用真實 seed。
2. **record/replay**：`server/fixtures/aiChef/record-30.jsonl` + `catalog.json`（205 張 = 110 official + 95 custom）。
3. **入口 telemetry（第一步）**：client 加 `aiEntry`（ai_tab / quick_reply / toast_fallback / ai_fallback / swap_ai / meal_ai）；
   backend `aiRecipe.ts:5382` 加 optional `aiEntry`、`:5408` mode=ai 但冇 aiEntry → warn、`:5807` metric log 加 mode + aiEntry。
   **只加 telemetry，冇改 charge / prompt / partial。**

## 未完成（Track A，車主已批 3 項）

1. **metering / source invariant**：production 實測 `requested=4 served=4 lib=0 ai=4 但 llm_calls=0`
   → 4 張 AI 卡、0 個 LLM call 記錄。要查清係 metering 缺口定 source 誤標；
   加 invariant：`aiCards>0 && meter.calls===0` → log error + response 加 `llmCalls`。
2. **clientMessageId**：每次新 submit 用新 ID、retry 保留同一個 ID。
   現時重用會撞 `aiRecipe.ts:5460` CONFLICT「呢個訊息已經用過，內容唔一致」。
3. **scenario 0 命中 observability**：DB 實際 `ricecooker` 官方 113 + 自建 32、`guest` 43，
   但 UI 話「無食譜」。要 log `scenario / query / scenarioTags / rows / seen / filtered`。

## 未修（第二批）

- 「換」按 >1 分鐘冇結果（`ai-chef.tsx:3060-3140`）
- 蒜蓉粉絲蒸扇貝重複出（`ai_chef_seen_recipes` 可能冇寫 AI 卡）
- AI tab 會閃一下內部 prompt（`ai-chef.tsx:2128-2148 / 2425 / 2586`）
- 場景 tab 左右滑動彈返最前（純 UI）

## 產品決定

- 宴客（guest）**唔可以換走**。要高蛋白 → 新增 `high_protein` scenario。
- 庫存 miss → 問用戶（3 出口），用戶撳 AI 才生成、扣 1 credit；0 卡 0 credit。
- partial（served < requested）→ 出已有卡 + 問「仲欠 N 道，要唔要 AI 煮？」，確認前唔准自動 AI、唔准預扣。

## 邊界（鐵律）

唔准 push / deploy / 改 Railway variables / 改 250 常數 / 改 import 路徑；
唔准 replace 宴客；唔准改 charge 規則；每項一個 commit。

## 工程紀律

- `grep` 一定要帶檔案或目錄（bare grep 讀 stdin 會卡死）
- 唔好一次過改多過 3 個檔
- 交貨要附實際數字：git log、ahead、test:chef 總數、tsc、檔案+行號、重現 test 名
