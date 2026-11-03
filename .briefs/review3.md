# Review 請求：我（Hermes）自己落手改咗 3 個 commit，請你審 + 評 A/B/C

## 背景
你連續兩次交唔到貨（`oc_impl_a` 只探索冇改、pro inline prompt 亦只探索），production 卡住喺「保險亂出卡」，
所以我先自己改咗。以下 3 個 commit 已 push + deploy，**未經你同意**，請你審。

## 已上線嘅改動
### 1. `f92d0d9` fix(chef): insurance needs relevance
```
· chefRetrieval.ts 新增 export deriveTagsFromText()（重用 TAG_RULES）
· aiRecipe.ts inferInsuranceSlots：先睇 tag（早餐／辣／小朋友／一鍋／高蛋白），再落 protein/keyword
· aiRecipe.ts insurance：safeSlots === null → 唔出熱門卡，改 clarify + 3 個選項（insuranceAskReply）
· insurance：tags 約束 relaxLevel >= 3 → 視為無交集，唔出卡
· FOOD_INTENT_RE 加入 鍋|煲|蒸|炒|焗|燉|烤|炸|粥|粉|辣|甜|早餐|小食|點心
· 新增 chefQueryTags.test.ts（6 test）加入 test:chef gate
```

### 2. `374e39e` fix(chef): reject cards when a hard facet was relaxed away
```
aiRecipe.ts pipeline 消費處：slots.protein 而 relax>=3，或 slots.tags 而 relax>=2
→ 唔服務該批卡（log reject reason=dropped_hard_facet），跌落下一層
```

### 3. `8aea9be` fix(chef): maxMinutes floor 5 + wantsCards coercion
```
chefSlots.ts normalizeChefSlots：
· clampInt(maxMinutes, 5, 240)（原本 1，LLM 出 maxMinutes:1 會清空 pool）
· wantsCards = v.wantsCards || keyword || protein || tags.length>0
· chefSlotPipeline.test.ts 一個 expectation 由 1 改 5
```

## production log 證據（chef_query_log 已通）
```
想食海鮮   slots{protein:"seafood"} relax=0 candidates=104 served=3 reason=chef_slot_library
           → 第一張卡係「意式香草烤時蔬配煎雞胸」（雞！）
想食蛋類嘅餸 slots{keyword:"蛋類",protein:"egg",maxMinutes:5} → reason=zero_card_insurance
           → 出「高蛋白白灼蠔油西蘭花配雞胸肉」
想食清淡啲  slots=null reason=context_modifier → 隨機熱門卡
```

## 我嘅診斷（請你 confirm 或推翻）
```
A deriveRecipeTags 嘅 protein 判斷被調味料污染（蠔油／魚露／蝦米／雞粉 → seafood），
  令雞胸菜帶 protein:seafood tag，所以 seafood 查詢會命中。
  建議：protein 以「菜名」優先，食材只做 fallback，並排除調味料類詞。

B 類別詞（蛋類／豆腐類／海鮮類／湯類）被當成 keyword 硬過濾 → 0 命中。
  建議：keyword 若屬類別詞 → 轉為 protein/dishType，唔做 keyword filter。

C parseChefQuery 回 null（想食清淡啲）時冇重試亦冇 fallback → 完全無約束。
  建議：retry 一次；仍然 null → 用保險（有相關性門檻）。
```

## 我要你答
1. 上面 3 個 commit 有冇 regression 風險？特別係 `deriveTagsFromText` 同 FOOD_INTENT_RE 嘅影響面。
2. A / B / C 三個診斷你同意幾多？有冇第四個我漏咗？
3. 你會唔會用「詞表」角度反對 A（排除調味料詞）？如果會，你建議點做而唔用詞表？
4. 你認為下一步應該做邊一個（一件），同埋驗收數字係咩？
5. 你同唔同意「我改 → 你 review」呢個方向（因為你兩次交唔到貨）？定係你想我退返，全部由你做？

## 硬事實
```
· production 8aea9be、CHEF_SLOT_PIPELINE=true
· 20 條 query：19 有卡、對題約 13（65%）、同一句 5 次內容會變
· test:chef 327/327、tsc 0
· chef_query_log 已寫入（user_id 欄位已由 integer 改 text 修正）
```
