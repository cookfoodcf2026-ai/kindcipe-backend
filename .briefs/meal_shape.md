# 修 bug：「三餸一湯」只出 3 張卡，而且唔係一湯三餸結構

## 證據（production 6d81f4b）
```
輸入「三餸一湯」
回應 recipes.length = 3
卡名：脆米雞胸高蛋白碗 / 炒三鮮 / 芝士焗西蘭花
→ 冇湯，而且全部唔係「三餸一湯」嘅角色組合
另一次：極品鮑汁花菇炆扣肉 / 炒三鮮 / 香煎粟米素菜餅  ← 同樣冇湯
```

## 要求
1. 「三餸一湯」（或 3 餸 1 湯 / 四餸）要回 **4 張卡**：
   - 1 張 soup（dishType=soup 或 name 含 湯/羹）
   - 3 張非湯（肉／海鮮／菜 角色多樣，用現有 role 邏輯）
2. 唔可以少過要求數量（現有 `never-fewer-cards` 邏輯要覆蓋 meal shape）
3. 任何一張卡都要過質量門檻（食材 ≥3、步驟 ≥2、cookTime > 0）
4. 湯唔可以重複（同一款湯兩次）

## 驗收
- tsc 0、test:chef ×3 全綠
- 新 test：`三餸一湯` / `3餸1湯` / `四餸一湯` 三個輸入，回傳數量同角色結構正確（用 fixture pool）

## 範圍
只准改 meal shape 相關（`server/services/chefPlanner.ts`、`server/services/recipeSetAssembler.ts`、`aiRecipe.ts` 內 meal 分支）+ test。
唔准改 chefRetrieval / chefDerivedTags / chefSlots / insurance。
唔准 push、唔准 deploy。
