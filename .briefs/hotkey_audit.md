# 熱鍵審核（只分析＋提方案，唔准改檔／commit／git）

## 實測（production 6986d7b 之後、每個用 app 相同 payload：mode=chat、無 search）
```
素食     2 張 ✔ 無肉            沙律／素蠔油菜心
高蛋白   3 張 ✔                香草雞胸／西蘭花雞胸／茶碗蒸
快手     3 張 ⚠️               薑蔥滑雞／打拋豬肉碎／韓式牛肉雜菜（無時間證據）
清淡     3 張 ⚠️               同上，韓式牛肉雜菜唔清淡
電飯煲   3 張 ✔                茶碗蒸／卡邦尼／韓式壽喜燒
親子     3 張 ⚠️               親子丼✔／豆腐肉碎滑蛋／沙嗲王白咖喱豬扒飯（可能辣）
宴客     3 張 ✔                燉豉油雞／紅燒肉／糖醋排骨
食譜庫隨機抽 6 張 ⚠️            （已加 cap 3 規則，等驗證）
雪櫃食材 3 張 ❌                青菜／洋蔥／豆腐 → 味噌豬肉炒飯等（完全無視食材）
八寶素煲 0 張 + 三個出口 ✅
```

## 已做（未經你同意，審完請講邊個要 revert）
```
04d32b9 素食 red line 全路徑 postcondition（食材 regex，唔靠 derived_tags）
9e8d96d 具名菜式／雪櫃食材「無匹配」→ 問 AI，唔出亂卡
974d857 雪櫃食材 tab 嘅「用以下食材：…」句式都行 pantry-first
6986d7b 非 meal shape 一律最多 3 張卡
```

## 要你答
1. 「雪櫃食材」仍然無視食材（味噌豬肉炒飯）—— 根因喺邊？（`pantryRequest` 條件、`extractMealIngredients`、定係 pantry-first 之後又被 insurance 蓋？）
2. 快手／清淡：應該點量度？（現有 cook time 欄位／`method` tag／食材）邊個 deterministic 訊號最可靠？
3. 親子出「沙嗲王白咖喱豬扒飯」：辣度係點判？（有 `spicy` tag 嗎？）
4. 上面 4 個 commit 邊個有 regression 風險？要唔要 flag 而唔係直接改行為？
5. 如果要你實作，最細嘅改動集係咩（檔案 + 函式 + 預期 test）？
6. 你建議用 pro 做實作，定係我做實作、你 review？理由。

## 限制
只讀 repo；答完即停。
