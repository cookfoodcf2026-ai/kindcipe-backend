# 任務：AI Chef 100% 結構化收尾 + 一鍋 tag 精度（只改 code，唔准 push/deploy）

## 背景（今日已修，production 0ae1b21）
```
· 20 條 query × 5 次 = 100/100 有卡、5 次一致
· 素食無肉、海鮮無雞、蛋類無牛（postcondition 保證）
· 湯水只出湯、蒸餸只出蒸、三餸一湯 4 張含湯
· cache 已版本化（CHEF_SLOT_PARSER_VERSION）
```

## 工作 1：一鍋到底 tag 精度（優先）
現時 `deriveScenarios`（server/utils/scenario.ts）用 `RICECOOKER_RE` 掃 **body（名稱＋描述＋步驟＋食材）**，所以：
- 「慢燉牛肉蘿蔔寬粉」因步驟提到燜／煲 → 被標 one-pot
- 「高蛋白白灼西蘭花」不應該係 one-pot 但都中
要求：
1. one-pot / ricecooker 只由 **菜名或器皿字** 判斷，**唔准**由步驟文字推
2. 若步驟真係全程單一器皿，可以作為較弱的 tag（例如 `tag:one-pot-soft`），但唔可以令 HARD tag 命中
3. 加 test：慢燉牛肉寬粉 唔可以有 hard one-pot；電飯煲料理 要有

## 工作 2：拆走剩餘詞表（結構化收尾）
現時仍然有：
1. `server/services/chefSlots.ts` — `CATEGORY_KEYWORD_PROTEIN` / `CATEGORY_KEYWORD_DISHTYPE`（蛋類／海鮮類／粉麵／湯 → protein/dishType）
2. `server/services/chefRetrieval.ts` — `TAG_RULES`（清淡／辣／小朋友／一鍋／高蛋白… → tag keys）
3. `server/routers/aiRecipe.ts` — `inferInsuranceSlots` 用 `deriveTagsFromText` 作 tag fallback
4. `server/services/chefRetrieval.ts` — 早餐排除辣／重口味嘅 regex
要求：
- 語意理解一律交 LLM：喺 `CHEF_SLOT_PROMPT` 明確要求模型輸出 `protein` / `dishType` / `method` / `tags`（含 one-pot、breakfast、kids、light、spicy、high-protein），並處理「類別詞」（蛋類→protein egg；粉麵→dishType noodle；湯水→dishType soup）
- code 只保留 **schema 驗證**（enum、範圍）同 **安全約束**（素食、過敏、辣排除呢類硬規則可以保留，但要寫明理由）
- 刪走 (1)(2)(3) 嘅詞表邏輯；如果刪走後有 regression，要保留最小 fallback 並標明 `// fallback: remove when parser is stable`
- 更新/新增 test：以上四類輸入（蛋類／粉麵／清淡／一鍋到底）只靠 LLM 輸出都要正確

## 交付
```
1. 一個 branch `chef-structural`，commit（唔 push）
2. npx tsc --noEmit → 0
3. env -u DATABASE_URL npm run test:chef 跑 3 次，報數字（現時 330 個）
4. 影響分析（Rule 13 四條）
5. 明確列出：刪走邊個詞表、換成咩機制、有冇保留 fallback
6. 若你認為某個詞表唔應該刪（例如過敏原），要講明理由
```

## 限制
```
· 只讀 repo 內檔案
· 唔准 push、唔准 deploy、唔准改 Railway 變數
· 唔准改 DB
```
