# 修一個具體 bug：context modifier（清淡／快啲／辣啲）被當成「重新出 3 餸」，modifier 被丟棄

## 證據（production 6d81f4b 實測）
```
輸入「想食清淡啲」
回應 intent: { kind:"meal", wantsCards:true, requested:{total:3, roles:["meat","seafood","vegetable"]}, reason:"context_modifier" }
出卡: 蓮藕炆排骨 / 酸甜咕嚕魚塊 / 白灼蠔油菜心   ← 唔清淡
輸入「清淡」→ 香菜拌牛肉 / 香煎三文魚配檸檬牛油汁 / 芝士焗西蘭花   ← 唔清淡
```
chef_query_log 顯示：slots=null, relax_level=null, reason=context_modifier（即係冇經 slot pipeline）

## 根因（已確認位置）
`server/services/chefPlanner.ts:69 isContextModifier()` 只判斷「係唔係 modifier」，
然後 `command(previous, [], true, "context_modifier", 0.88)` **完全冇把 modifier 內容傳落去**。
下游照 previous 嘅 3 餸 shape 出卡 → 用戶講「清淡」等於冇講。

## 要求（只做呢一件事）
1. modifier 要有內容：把 modifier 轉成 constraint（例：清淡 → tags ["light","healthy"]；快啲 → tag "quick"；辣 → tag "spicy"）
2. 若同時有 previous meal：用 modifier 去 filter／rank 該餐嘅候選，唔可以原封不動重出
3. 若冇 previous meal（新對話第一句就講「清淡」）：唔可以當 3 餸 meal，應走 slot pipeline（單卡或 3 卡但要符合 tag）
4. 冇符合 tag 嘅卡 → clarify 要有文字（唔准出唔相關嘅肉／炸物）
5. 加 test：`清淡` / `想食清淡啲` / `快啲` / `辣啲` 四個輸入，回傳嘅卡都要帶對應 tag；唔可以回傳無關肉類

## 驗收
- `npx tsc --noEmit` 0
- `env -u DATABASE_URL npm run test:chef` ×3 全綠（現時 328）
- 報告修前／修後：呢四個輸入喺 production 回應嘅卡名（我會另外用 production probe 核對）

## 範圍
只准改 `server/services/chefPlanner.ts`（如需接線可改 aiRecipe.ts 一處）＋ test。
唔准改 foodTermMap / chefDerivedTags / chefSlots / insurance。
唔准 push、唔准 deploy、唔准改 Railway 變數。
