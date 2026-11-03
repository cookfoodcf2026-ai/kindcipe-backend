[0m
> build · deepseek-v4-pro
[0m
[0m→ [0mRead .briefs/review3.md
[0m✱ [0mGlob "**/aiRecipe.ts"[90m 1 match[0m
[0m✱ [0mGlob "**/chefRetrieval.ts"[90m 1 match[0m
[0m✱ [0mGlob "**/chefSlots.ts"[90m 1 match[0m
[0m
[0m$ [0mgit log --oneline -6
8aea9be fix(chef): maxMinutes floor 5 (parser noise) and coerce wantsCards when a food facet is present
374e39e fix(chef): reject cards when a hard facet (protein/tag) was relaxed away
f92d0d9 fix(chef): insurance needs relevance (tag/keyword/protein) or asks with options; widen FOOD_INTENT_RE
f921092 feat(chef): widen slot pipeline, add zero-card insurance and query log
7b23054 feat(chef): wire slot parse + deterministic library pipeline (flag OFF)
a5a9648 fix(chef): guard neutral food terms and clarify silent zero-card replies
[0m
[0m→ [0mRead server/services/chefRetrieval.ts
[0m
[0m$ [0mgit show f92d0d9 --stat && echo "=====374e39e=====" && git show 374e39e --stat && echo "=====8aea9be=====" && git show 8aea9be --stat
commit f92d0d93e1110a4e1fd38a7c75f6488264b192ad
Author: Mavis Ng <Cookfoodcf2026@gmail.com>
Date:   Tue Nov 3 16:17:25 2026 +0800

    fix(chef): insurance needs relevance (tag/keyword/protein) or asks with options; widen FOOD_INTENT_RE

 package.json                          |  4 ++--
 server/routers/aiRecipe.ts            | 33 +++++++++++++++++++++++++++------
 server/services/chefQueryTags.test.ts | 25 +++++++++++++++++++++++++
 server/services/chefRetrieval.ts      |  9 +++++++++
 4 files changed, 63 insertions(+), 8 deletions(-)
=====374e39e=====
commit 374e39ebb03c78b721b65ccfc1de019ee1fbbf27
Author: Mavis Ng <Cookfoodcf2026@gmail.com>
Date:   Tue Nov 3 16:46:58 2026 +0800

    fix(chef): reject cards when a hard facet (protein/tag) was relaxed away

 server/routers/aiRecipe.ts | 10 +++++++++-
 1 file changed, 9 insertions(+), 1 deletion(-)
=====8aea9be=====
commit 8aea9bedc28beeb6242d44207296326a777aff05
Author: Mavis Ng <Cookfoodcf2026@gmail.com>
Date:   Tue Nov 3 17:05:52 2026 +0800

    fix(chef): maxMinutes floor 5 (parser noise) and coerce wantsCards when a food facet is present

 server/services/chefSlotPipeline.test.ts | 3 ++-
 server/services/chefSlots.ts             | 8 ++++++--
 2 files changed, 8 insertions(+), 3 deletions(-)
[0m
[0m→ [0mRead server/services/chefDerivedTags.ts
[0m→ [0mRead server/services/chefSlots.ts
[0m→ [0mRead server/routers/aiRecipe.ts
[0m✱ [0mGrep "FOOD_INTENT_RE|inferInsuranceSlots|insuranceAskReply|dropped_hard_facet|deriveTagsFromText|safeSlots|relaxLevel|inferInsurance|insurance"[90m in server/routers/aiRecipe.ts · 39 matches[0m
[0m→ [0mRead server/routers/aiRecipe.ts[90m [offset=3630, limit=120][0m
[0m→ [0mRead server/routers/aiRecipe.ts[90m [offset=5770, limit=280][0m
[0m→ [0mRead server/routers/aiRecipe.ts[90m [offset=4080, limit=110][0m
[0m→ [0mRead server/services/chefQueryTags.test.ts
[0m
[0m$ [0mgit show f92d0d9 -- server/routers/aiRecipe.ts server/services/chefRetrieval.ts package.json
commit f92d0d93e1110a4e1fd38a7c75f6488264b192ad
Author: Mavis Ng <Cookfoodcf2026@gmail.com>
Date:   Tue Nov 3 16:17:25 2026 +0800

    fix(chef): insurance needs relevance (tag/keyword/protein) or asks with options; widen FOOD_INTENT_RE

diff --git a/package.json b/package.json
index 52f3206..b9cd8ea 100644
--- a/package.json
+++ b/package.json
@@ -18,7 +18,7 @@
     "promote:admin": "tsx scripts/promote-admin.ts",
     "promo:codes": "tsx scripts/promo-codes.ts",
     "test:billing": "tsx --test server/services/billingRules.test.ts",
-    "test:chef": "tsx --test server/services/chefIntent.test.ts server/services/recipeSetAssembler.test.ts server/services/entitlementPolicy.test.ts server/services/aiChefPolicy.test.ts server/services/chefAllergens.test.ts server/services/recipeImportMeter.test.ts server/utils/scenario.test.ts server/services/chatQuota.test.ts server/services/chefFaq.test.ts server/services/chefDispatcher.test.ts server/services/chefDialogues.test.ts server/services/chefDomain/chefDomain.test.ts server/services/chefPlanner.test.ts server/services/chefQueryPlan.test.ts server/services/chefSafety.test.ts server/services/llmCost.test.ts server/services/chefResponse.test.ts server/services/aiChefIdempotency.test.ts server/services/aiChefLifecycle.test.ts server/services/aiChefRouting.test.ts server/services/aiChefFlagOff.test.ts server/services/aiChefFinalization.test.ts server/services/aiChefFlagMatrix.test.ts server/services/chefSlotPipeline.test.ts server/routers/facebookImport.test.ts server/routers/importNormalize.test.ts server/_core/stripeWebhook.test.ts server/utils/dishTypeGuard.test.ts server/utils/mealDiversity.test.ts server/utils/foodTermMap.test.ts",
+    "test:chef": "tsx --test server/services/chefIntent.test.ts server/services/recipeSetAssembler.test.ts server/services/entitlementPolicy.test.ts server/services/aiChefPolicy.test.ts server/services/chefAllergens.test.ts server/services/recipeImportMeter.test.ts server/utils/scenario.test.ts server/services/chatQuota.test.ts server/services/chefFaq.test.ts server/services/chefDispatcher.test.ts server/services/chefDialogues.test.ts server/services/chefDomain/chefDomain.test.ts server/services/chefPlanner.test.ts server/services/chefQueryPlan.test.ts server/services/chefSafety.test.ts server/services/llmCost.test.ts server/services/chefResponse.test.ts server/services/aiChefIdempotency.test.ts server/services/aiChefLifecycle.test.ts server/services/aiChefRouting.test.ts server/services/aiChefFlagOff.test.ts server/services/aiChefFinalization.test.ts server/services/aiChefFlagMatrix.test.ts server/services/chefSlotPipeline.test.ts server/routers/facebookImport.test.ts server/routers/importNormalize.test.ts server/_core/stripeWebhook.test.ts server/utils/dishTypeGuard.test.ts server/utils/mealDiversity.test.ts server/utils/foodTermMap.test.ts server/services/chefQueryTags.test.ts",
     "test:chef:oracle": "tsx server/scripts/reportChefOracle.ts",
     "test:chef:db": "tsx --test server/services/aiChefBugSpec.test.ts server/routers/aiRecipeRouter.test.ts server/services/llmCostStale.test.ts",
     "report:llm-cost": "tsx scripts/report-llm-cost.ts",
@@ -59,4 +59,4 @@
     "tsx": "^4.19.1",
     "typescript": "5.9.3"
   }
-}
+}
\ No newline at end of file
diff --git a/server/routers/aiRecipe.ts b/server/routers/aiRecipe.ts
index 5e37d44..94eaa1d 100644
--- a/server/routers/aiRecipe.ts
+++ b/server/routers/aiRecipe.ts
@@ -15,6 +15,7 @@ import { fallbackQueriesForFoodTerm, findFoodTerm, foodItemType, hasRequestVerb,
 import { getChatQuotaState } from "../services/chatQuota";
 import { dispatchChefTurn, normalizeDispatchContract, categoryRolesForDispatch, type ChefDispatch } from "../services/chefDispatcher";
 import { runChefSlotPipeline } from "../services/chefPipeline";
+import { deriveTagsFromText } from "../services/chefRetrieval";
 import { dbChefSlotsCache } from "../services/chefQueryCache";
 import { logChefQuery } from "../services/chefQueryLog";
 import { retrieveChefCards, toChefLibraryRecipe, validateGeneratedCard } from "../services/chefRetrieval";
@@ -3636,7 +3637,7 @@ async function applyMealShapePostcondition(
   };
 }
 
-const FOOD_INTENT_RE = /食|煮|整|整返|想|要|菜|餸|餐|湯|飯|麵/;
+const FOOD_INTENT_RE = /食|煮|整|整返|想|要|菜|餸|餐|湯|飯|麵|鍋|煲|蒸|炒|焗|燉|烤|炸|粥|粉|辣|甜|早餐|小食|點心/;
 
 /** CHEF_SLOT_PIPELINE is default OFF; OFF must keep the a5a9648 behaviour. */
 export function isChefSlotPipelineEnabled(): boolean {
@@ -5770,6 +5771,13 @@ async function processAIChefChatCore(
 
 const INSURANCE_VEG_RE = /素食|吃素|食素|vegan|vegetarian/i;
 
+function insuranceAskReply(lang: string): string {
+  if (lang.startsWith("en")) return "I couldn't find a close match. Try: steamed fish, stir-fried egg, tofu claypot — or name an ingredient and I'll search it.";
+  if (lang.startsWith("fil")) return "Wala akong malapit na tugma. Subukan: steamed fish, stir-fried egg, tofu claypot — o sabihin ang sangkap at hahanapin ko.";
+  if (lang.startsWith("id")) return "Belum ada yang cocok. Coba: ikan kukus, telur goreng, tahu claypot — atau sebut bahan dan saya carikan.";
+  return "我未搵到完全符合嘅食譜。想試下：蒸魚、炒蛋、豆腐煲？或者講個食材，我幫你搵。";
+}
+
 function insuranceReply(lang: string): string {
   if (lang.startsWith("en")) return "I wasn't completely sure what you meant, so here are the closest choices.";
   if (lang.startsWith("fil")) return "Hindi ako lubos na sigurado sa ibig mong sabihin, kaya ito ang pinakamalapit na pagpipilian.";
@@ -5788,6 +5796,11 @@ function inferInsuranceSlots(text: string, parsed: ChefSlots | null): ChefSlots
   if (vegetarian) return { wantsCards: true, tags: ["素食"] };
   if (parsed?.protein) return { wantsCards: true, protein: parsed.protein };
 
+  // Tag-only queries (早餐 / 辣 / 小朋友 / 一鍋到底 / 高蛋白 …) have no food noun
+  // but do carry a real constraint; keep it instead of falling back to popularity.
+  const tagHits = deriveTagsFromText(text);
+  if (tagHits.length > 0) return { wantsCards: true, tags: tagHits };
+
   const term = findFoodTerm(text);
   if (!term) return null;
   if (foodItemType(term) === "dish") return { wantsCards: true, keyword: term };
@@ -5937,12 +5950,20 @@ async function applyZeroCardInsurance(
       });
 
       const safeSlots = inferInsuranceSlots(text, params.telemetry?.slots ?? null);
-      const retrieval = retrieveChefCards(
-        safeSlots ?? { wantsCards: true },
-        libraryPool,
-        { count: 3, avoid: banned },
-      );
+      if (!safeSlots) {
+        // No protein / keyword / tag signal: serving popularity cards here is how
+        // "早餐" ended up returning braised beef. Ask with concrete options instead.
+        result.recipes = [];
+        result.content = insuranceAskReply(params.lang);
+        result.clarifyReason = "ambiguous_food";
+        console.log("[AI Chef] zero_card_insurance skip reason=no_relevance_signal");
+        return result;
+      }
+      const retrieval = retrieveChefCards(safeSlots, libraryPool, { count: 3, avoid: banned });
       let chosen = retrieval.cards;
+      if ((safeSlots.tags?.length ?? 0) > 0 && retrieval.relaxLevel >= 3) {
+        chosen = [];
+      }
       if (safeSlots?.protein && retrieval.relaxLevel >= 3) {
         chosen = chosen.filter((card) => validateGeneratedCard(
           {
diff --git a/server/services/chefRetrieval.ts b/server/services/chefRetrieval.ts
index 8784b71..3ef8e48 100644
--- a/server/services/chefRetrieval.ts
+++ b/server/services/chefRetrieval.ts
@@ -97,6 +97,15 @@ const TAG_RULES: Array<[RegExp, string[]]> = [
   [/素食|吃素|食素|vegan|vegetarian/i, ["vegetarian"]],
 ];
 
+/** Canonical tag keys implied by a raw user sentence (breakfast / spicy / kids / one-pot …). */
+export function deriveTagsFromText(text: string): string[] {
+  const hits: string[] = [];
+  for (const [pattern, values] of TAG_RULES) {
+    if (pattern.test(text)) hits.push(...values);
+  }
+  return [...new Set(hits)];
+}
+
 function tagKeysFor(slotTags: string[]): string[] {
   const keys: string[] = [];
   for (const raw of slotTags) {
[0m
[0m✗ [0mGrep "意式香草|煎雞胸|烤時蔬|海鮮醬|沙爹|沙嗲|XO醬|XO酱" failed
[91m[1mError: [0mRipgrep JSON record exceeded 65536 bytes
[0m
[0m$ [0mgit log --oneline -8 -- server/services/chefDerivedTags.ts
7b23054 feat(chef): wire slot parse + deterministic library pipeline (flag OFF)
[0m
[0m✱ [0mGlob "**/*.{json,ts,sql}"[90m 100 matches[0m
[0m
[0m$ [0mgit log --all --oneline -- server/services/chefDerivedTags.ts; echo "---"; git show 7b23054:server/services/chefDerivedTags.ts 2>/dev/null | grep -n "FALSE_POSITIVES" | head
7b23054 feat(chef): wire slot parse + deterministic library pipeline (flag OFF)
---
78:const PROTEIN_FALSE_POSITIVES: Array<[string, RegExp]> = [
89:  const falsePositive = PROTEIN_FALSE_POSITIVES.find(([key]) => key === protein)?.[1];
[0m
[0m→ [0mRead search-oyster.ts
[0m→ [0mRead scripts/debug-protein.ts
[0m✱ [0mGrep "applyZeroCardInsurance|applyChefCardConstraint|applySilentZeroCardClarify|isChefSlotPipelineEnabled"[90m in server/routers/aiRecipe.ts · 10 matches[0m
## 1. 三個 commit 有冇 regression 風險？

**有。最大風險唔係 `deriveTagsFromText` 本身，而係呢 3 個 commit 全部改咗「flag OFF 都要行」嘅路徑，違反咗你 code 入面自己寫嘅 invariant。**

- **最高風險：`FOOD_INTENT_RE` 加闊（aiRecipe.ts:3640）**。呢個 regex 喺 `applySilentZeroCardClarify`（:3703）同 `isFoodRelatedForInsurance`（:5862）用，兩者都**唔受 `CHEF_SLOT_PIPELINE` gate**（wrapper 裏 `:6052/:6053/:6060` 無條件行）。但你 :3642 註解明寫「OFF must keep the a5a9648 behaviour」——加闊後 OFF 行為已變。具體 false positive：單字 `煲`（「煲劇」）、`粉`（「粉絲/奶粉」）、`焗`（「焗住」）會令非食物句誤中，觸發「你想食邊一類」clarify 或保險提問。概率低但會冚。
- **`deriveTagsFromText` 影響面**：只喺 `inferInsuranceSlots`（:5809）用，經 `applyChefCardConstraint`＋`applyZeroCardInsurance`，同樣**唔 gate**。所以「tag-only query（早餐/辣/高蛋白）」喺 OFF 狀態由「出熱門卡」變成「約束檢索／或問 3 個選項」——方向啱，但係 OFF 用戶見到嘅行為變咗，要當 intended change 記錄。
- **`droppedHardFacet`（374e39e, :4132）**：只喺 flag ON 先行。兩個洞：①`tags` 喺 `relaxLevel>=1` 已唔再 soft filter（chefRetrieval.ts:227-229），但你 `relaxLevel>=2` 先 reject——即 `relax=1` 時「清淡」呢類偏好 tag 會被靜靜丟走照出卡。②「清淡／快手」係**偏好**唔係 correctness，relax 到 2 就 reject 會令 soft 查詢跌落 dispatcher → 多 call LLM／扣 credit。
- **`maxMinutes` floor 5 + `wantsCards` OR 迫真（8aea9be, chefSlots.ts:155/:161）**：只 flag ON。低風險；「1 分鐘」→5 可接受，`wantsCards:false`＋有 keyword →true 屬 intended，但 model 誤掛 keyword 喺技巧題會重新出卡。

## 2. A / B / C 同意幾多？有冇第四個？

- **A：方向啱，具體例子錯。** 蠔油／蝦米／魚露／雞粉**全部已經**喺 `PROTEIN_FALSE_POSITIVES`（chefDerivedTags.ts:78-84），而且冇一個 map 去 seafood（魚露→fish、雞粉→chicken）。真正未處理嘅污染係**菌菇類**：`海鮮菇`（含「海鮮」）、`蠔菇`、`蟹味菇`、`魚豆腐`、`魚香`——呢啲唔喺排除表。而且蛋白係 name+ingredients 做 UNION（chefDerivedTags.ts:146-147），一個壞 ingredient 就加多一個錯蛋白。
- **B：同意，機制確認。** `matchesKeyword` 喺所有 relax level 都係 hard filter（chefRetrieval.ts:216），「蛋類」做 keyword 會 `name.includes("蛋類")`／ingredient 含「蛋類」→ 幾乎必 0 命中，同你 log 一致。
- **C：部分同意。** 你建議「retry 一次」**已經存在**（chefSlots.ts:196 `for attempt<2`）。真正缺口係「parse 成功但 slots 冇任何約束」→ pipeline 喺 `relax_0` 直接出熱門卡（empty slots 唔觸發 droppedHardFacet，因為冇 protein/tags），**根本到唔到 insurance**。f92d0d9 嘅 `deriveTagsFromText` 只補咗 insurance 嗰邊，flag ON 嘅 pipeline 短路仍未堵。
- **第四個 D（你漏咗）：`toChefLibraryRecipe` 用 DB 已存 `derived_tags` 優先**（chefRetrieval.ts:80 `existing.length>0 ? existing : deriveRecipeTags`）。即係你改 `deriveRecipeTags` 唔會對「已存咗錯 tag」嘅 row 生效——污染已經 bake 入 DB，必須 recompute/migrate 先至會好。

## 3. 會唔會用「詞表」角度反對 A？

**會反對，但唔係因為詞表錯，而係因為：(a) 你已經有呢張表（`PROTEIN_FALSE_POSITIVES`），再擴係無底深潭（菌菇名、素肉名、醬料、中英 transliteration 逐個追）；(b) 真正 defect 係結構性——蛋白係 name+ingredients 的 UNION，冇優先級。**

建議（唔加詞表）：
1. **name-first 優先**：菜名 produce 到 ≥1 個蛋白 → 只用菜名嘅；菜名冇先 fallback 去 ingredients。`煎雞胸` 就永遠唔會因 `海鮮菇` 變 seafood。
2. **菇／菌／素肉喺蛋白匹配前就當蔬菜剔除**（結構性排除，唔係逐詞）。
3. **強制 recompute 已存 `derived_tags`**（否則 1、2 都唔生效，見 D）。

## 4. 下一步做邊一件？驗收數字？

**做 D＋A 合體：蛋白 name-first + 重算 `derived_tags`。** 原因：你嘅頭號證據「想食海鮮 → 第一張雞」係經 `chef_slot_library`（flag ON，production 已開）喺 `relax=0` 出嚟，即係 `matchesProtein` 誤判，根喺蛋白偵測，唔係 insurance。

驗收：
- `scripts/debug-protein.ts` 重跑：`CHICKEN_WITH_SEAFOOD_TAG` **= 0**（而家應 >0）。
- 「想食海鮮」top-3 卡蛋白 100% 屬 seafood/fish（錯蛋白 0）。
- 20 條 oracle 對題 13/20 → **≥16/20**，且「想食清淡啲」不再出隨機熱門卡。
- gate：`env -u DATABASE_URL npm run test:chef` 0 fail ×3、`tsc --noEmit` 0。

## 5. 同唔同意「我改 → 你 review」？

**唔需要退返，三個 commit 方向基本啱，我唔會要你 revert。** 但兩點要講清楚：

- 內容我認可，**但我繼續做 reviewer、唔重寫**，除非你明確話要我做。
- 過程違反咗我哋自己規則：**unreviewed 就 push＋deploy 上 production**，同 rule 9（production 只可以由已驗證 main build）、rule 10（部署 gate 缺一不可）有衝突。你要補返缺咗嘅 gate 證據先至算「已驗證」：`test:chef` 0 fail ×3 輸出、`tsc --noEmit` 0、`npm run preflight`、**production DB snapshot + restore 實測**（empty bootstrap 會 fail，規則已知）。你 brief 寫咗 327/327、tsc 0，但我**未親身跑過＝未證實**。
- 下次：影響分析要喺 deploy **之前**寫，唔係我而家事後補。呢次我可以而家補一份「影響分析」作為補鑊，但流程要扭返。

（聲明：以上 `327/327`、production 行為數字我冇重跑，只按 code 行號＋log 你提供嘅證據推論；A 嘅「菌菇污染」係由 code 推理，未用 DB 實測確認。）
