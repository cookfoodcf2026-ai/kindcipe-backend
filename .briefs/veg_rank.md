# 修排序：素食／清淡 查詢要出主菜，唔係甜品／沙律

## 證據（production 6d81f4b 實測）
```
「有咩素食」  → 蜜糖 balsamic 烤南瓜雜菌沙律 / 抹茶優格杯 / Trader Joe's酥皮自製蘋果派
「想食清淡啲」→ 韓式麻藥雞 / 八寶豆腐 / 白灼蠔油西蘭花（前兩者唔清淡）
```

## 庫存事實（337 張 active）
```
帶「素食」tag：36 張，其中包括主菜
  紅燒豆腐 / 素麻婆豆腐 / 香菇滑豆腐煲 / 南乳粗齋煲 / 素豆腐漢堡扒
  羅漢齋炒麵 / 素菜蛋炒飯 / 豉汁蒸豆腐 / 韭菜炒蛋 / 芝士焗雜菜意粉
帶「清淡」tag：多張（蒜蓉炒菜心、豉汁蒸豆腐、意大利蔬菜湯、紫菜豆腐魚蛋湯…）
→ 所以唔係冇貨，係排序（popularity）把 dessert / appetizer 推上前
```

## 要求（只改排序，唔准改 tag 推導）
1. `server/services/chefRetrieval.ts` 嘅 `scoreRecipe`：
   - 當 slots.tags 含 vegetarian / light / high-protein：
     - dishType ∈ {vegetable, stirfry, braise, steam, soup} → 加分
     - dishType ∈ {dessert, snack, appetizer} → 減分（除非用戶明確講甜品／小食）
   - 用戶明確講「甜品／糖水／小食」時，dessert/snack 加分（唔可以一律壓低）
2. 唔准用新詞表；用現有 dishType + tags
3. 加 test（chefSlotPipeline.test.ts 或新檔）：
   - 素食 query 嘅 top-3 唔可以全部係 dessert/appetizer
   - 「有咩甜品」仍然要出甜品

## 驗收
- tsc 0；test:chef ×3 全綠（現時 328，modifier 修完會更多）
- 報告：素食／清淡 兩個 query 修前 vs 修後 top-3 卡名（用 fixture pool 即可，唔需要 production）

## 範圍
只改 `server/services/chefRetrieval.ts` + test。唔准碰 chefPlanner / chefSlots / insurance / aiRecipe.ts。
唔准 push、唔准 deploy。
