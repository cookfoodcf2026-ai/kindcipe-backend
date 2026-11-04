# 只答 3 條（唔准執行 git，唔准改檔；以下係完整 diff，讀完直接答）

```diff
diff --git a/server/routers/aiRecipe.ts b/server/routers/aiRecipe.ts
index 99a488d..31cce98 100644
--- a/server/routers/aiRecipe.ts
+++ b/server/routers/aiRecipe.ts
@@ -4007,13 +4007,17 @@ async function processAIChefChatCore(
   // concrete library card instead of asking "what do you want to cook?".
   const pantryTerms = extractMealIngredients(lastUserText);
   const pantryRequest = !plannedTurn && mode === "chat" && Boolean(db)
-    && /雪櫃|冰箱|pantry|剩|得/i.test(lastUserText)
+    // The app's 雪櫃食材 tab sends a canned "用以下食材煮餸：青菜、洋蔥、豆腐" prompt,
+    // which never contains 雪櫃 — match the list form too.
+    && /雪櫃|冰箱|pantry|剩|得|用以下食材|以下食材|用呢啲食材|食材[：:]/i.test(lastUserText)
     && pantryTerms.length >= 2;
   if (pantryRequest) {
     for (const term of pantryTerms.slice(0, 4)) {
       const search = await trySearch(term, 20);
       if (!search.ok) break;
-      const cards = rowsToSuggested(search.rows, excludeSets, 1);
+      // Ignore the "already seen" list here: with 3 fridge items the pool is tiny,
+      // and skipping seen cards turned the pantry tab into 0 cards.
+      const cards = rowsToSuggested(search.rows, mkExcludeSets([], []), 1);
       if (cards.length > 0) {
         return {
           content: lang.startsWith("en")
@@ -4100,6 +4104,9 @@ async function processAIChefChatCore(
     // Only an explicit multi-card ask ("三餸一湯", "4 道菜") may skip the pipeline.
     // A vague total from the intent layer is what made 「有咩湯水」return 1 card.
     if (chefIntent.requested.total > 1 && /[0-9一二兩两三四五六七八九十]\s*(?:個|个|道|款)?\s*(?:餸|菜|湯|汤)/.test(lastUserText)) return "multi_card";
+    // Pantry lists are handled by pantry-first (it searches each ingredient);
+    // the slot pipeline turned them into a library_miss with 0 cards.
+    if (/雪櫃|冰箱|用以下食材|以下食材|用呢啲食材|食材[：:]/.test(lastUserText)) return "pantry";
     if (explicitAiRequest) return "explicit_ai";
     if (!lastUserText) return "empty_text";
     return null;
@@ -4959,7 +4966,12 @@ async function processAIChefChatCore(
       : rows;
 
     const explicitTermCandidate = extractMealIngredients(lastUserText)[0] ?? "";
-    const explicitTerm = isSpecificFoodTerm(explicitTermCandidate) ? explicitTermCandidate : "";
+    // Scenario words are not dishes: 「素食」「高蛋白」 would otherwise be treated as
+    // an explicit item and dead-end at 0 cards on the hotkey path.
+    const SCENARIO_WORDS_RE = /素食|吃素|高蛋白|蛋白質|快手|清淡|電飯煲|親子|宴客|一鍋到底/;
+    const explicitTerm = isSpecificFoodTerm(explicitTermCandidate) && !SCENARIO_WORDS_RE.test(explicitTermCandidate)
+      ? explicitTermCandidate
+      : "";
     if (explicitTerm) {
       const semanticRows = safeRows.filter((row) => rowMatchesFoodQuery(row, explicitTerm));
       const scenarioRank = (row: Record<string, unknown>) =>
@@ -6008,6 +6020,9 @@ async function applyZeroCardInsurance(
   if (params.forceText) return result;
   if (params.mode !== "chat" && params.mode !== "ai") return result;
   if (result.clarifyReason === "safety") return result;
+  // Pantry-first already answered with a card that uses the user's ingredients;
+  // topping it up with popular cards is what produced 抹茶優格杯 after 青菜/洋蔥/豆腐.
+  if (result.intentOverride?.reason === "pantry_first") return result;
 
   const text = lastUserText(params.inputMessages as any).trim();
   if (!text) return result;
@@ -6025,6 +6040,35 @@ async function applyZeroCardInsurance(
     const banned = [...params.avoidIngredients, ...(params.knownAllergens ?? [])];
     const rows = insurancePoolRows(pool, banned);
 
+    // A named dish the library does not have must NOT be answered with three
+    // unrelated popular cards — ask whether to design it instead (0 credit).
+    // Only dish-shaped names count (煲／麵／飯／糕…): ingredient words like 雞 or 牛
+    // appear in normal requests and must not trigger this guard.
+    const DISH_HINT_RE = /(煲|麵|粉|飯|粥|湯|糕|卷|餅|餃|丸|扒|盅|鍋)/;
+    const dishCandidate = (() => {
+      const cleaned = String(text ?? "").replace(/[，。！？、,.!?\s]/g, "");
+      const match = cleaned.match(/^(?:我)?(?:要|想食|想煮|想整|食)?(.{2,12})$/);
+      const candidate = (match?.[1] ?? "").trim();
+      if (candidate.length < 2 || !DISH_HINT_RE.test(candidate)) return "";
+      if (/素食|素菜|高蛋白|清淡|快手|小朋友|宴客|一鍋|有咩|推介|建議|邊個|食咩|幫我/.test(candidate)) return "";
+      return candidate;
+    })();
+    if (dishCandidate && params.mode !== "ai" && result.clarifyReason !== "lib_search_fail") {
+      const hasDish = pool.some((row) => {
+        const name = String((row as any).name ?? "");
+        return name.length > 0 && (name.includes(dishCandidate) || dishCandidate.includes(name));
+      });
+      if (!hasDish) {
+        console.log(`[AI Chef] named_dish_miss dish=${dishCandidate} — asking instead of serving popular cards`);
+        return {
+          ...result,
+          recipes: [],
+          content: libraryMissReply(params.lang, dishCandidate, []),
+          clarifyReason: "library_miss" as const,
+        };
+      }
+    }
+
     if (rows.length > 0) {
       let trendingNames: string[] = [];
       try {
@@ -6088,6 +6132,34 @@ async function applyZeroCardInsurance(
       }
 
       if (cards.length > 0) {
+        // Pantry ask ("用以下食材煮餸：青菜、洋蔥、豆腐") must serve recipes that
+        // actually use those ingredients — not popular cards that ignore them.
+        const pantryMatch = String(text ?? "").match(/食材[：:]\s*(.+)$/);
+        if (pantryMatch) {
+          const wanted = pantryMatch[1]
+            .split(/[、,，/\s]+/)
+            .map((item) => item.replace(/[。！？].*$/, "").trim())
+            .filter((item) => item.length >= 1)
+            .map((item) => item.slice(0, 2));
+          const usesWanted = (card: any) => {
+            const haystack = `${card.name ?? ""} ${(card.ingredients ?? [])
+              .map((ing: any) => (typeof ing === "string" ? ing : String(ing?.name ?? "")))
+              .join(" ")}`;
+            return wanted.some((kw) => kw && haystack.includes(kw));
+          };
+          const matched = cards.filter(usesWanted);
+          if (matched.length === 0) {
+            console.log(`[AI Chef] pantry_miss items=${wanted.join("|")} — asking instead of serving unrelated cards`);
+            return {
+              ...result,
+              recipes: [],
+              content: `我用你提供嘅食材（${pantryMatch[1].trim()}）喺食譜庫搵唔到合適食譜。要我用 AI 即場設計嗎？（1 credit）`,
+              clarifyReason: "ingredient_miss" as const,
+            };
+          }
+          cards.length = 0;
+          cards.push(...matched.slice(0, 3));
+        }
         await recordServedLibraryCards(params.familyId, cards);
         const existing = result.recipes ?? [];
         const seen = new Set(existing.map((card) => normalizeName(card.name)));
@@ -6996,6 +7068,49 @@ export const aiRecipeRouter = router({
         requestId,
       });
       const mode = input.mode ?? "chat";
+
+      // 雪櫃食材 tab sends a canned list ("用以下食材煮餸：青菜、洋蔥、豆腐").
+      // Answer it straight from the library with cards that actually use those
+      // ingredients — the normal chat pipeline ignored the list entirely.
+      const pantryText = lastUserText(input.messages) ?? "";
+      const pantryDb = /用以下食材|以下食材|用呢啲食材|食材[：:]/.test(pantryText) ? await getDb() : null;
+      if (mode === "chat" && pantryDb && /用以下食材|以下食材|用呢啲食材|食材[：:]/.test(pantryText)) {
+        const listed = (pantryText.match(/食材[：:]\s*([^\n。]+)/)?.[1] ?? "")
+          .split(/[、,，/]+/)
+          .map((item) => item.trim())
+          .filter((item) => item.length >= 1 && item.length <= 8);
+        const wanted = Array.from(new Set(listed)).slice(0, 6);
+        if (wanted.length > 0) {
+          const picked: Record<string, any> = {};
+          for (const item of wanted) {
+            const rows = await pantryDb
+              .select()
+              .from(officialRecipes)
+              .where(and(
+                eq(officialRecipes.isActive, true),
+                or(ilike(officialRecipes.name, `%${item}%`), ilike(officialRecipes.ingredients, `%${item}%`)),
+              ))
+              .limit(4);
+            for (const row of rows) {
+              const card = toChefLibraryRecipe(row as any);
+              const key = String(card.name ?? "");
+              if (key && !picked[key]) picked[key] = card;
+            }
+          }
+          const cards = Object.values(picked).slice(0, 3);
+          if (cards.length > 0) {
+            console.log(`[AI Chef] pantry_direct items=${wanted.join("|")} cards=${cards.length}`);
+            return {
+              content: `用你嘅食材（${wanted.join("、")}），可以試呢幾道：`,
+              recipes: cards,
+              alternatives: [],
+              llmUsed: false,
+            } as any;
+          }
+          console.log(`[AI Chef] pantry_direct items=${wanted.join("|")} cards=0`);
+        }
+      }
+
       if (mode === "ai" && !input.aiEntry) {
         console.warn(`[AI Chef] ai telemetry missing request=${requestId}`);
       }
@@ -7534,6 +7649,53 @@ export const aiRecipeRouter = router({
         reason: `${result.clarifyReason ?? effectiveIntent.reason}${pipelineTelemetry?.skipReason ? `|skip=${pipelineTelemetry.skipReason}` : ""}`,
         servedSources: sources,
       });
+
+      // Single-dish questions must not return a pile of cards (隨機抽 sent 6).
+      if (!detectMealShapeLoose(lastUserText(input.messages) ?? "") && Array.isArray(finalResponse.recipes) && finalResponse.recipes.length > 3) {
+        console.log(`[AI Chef] capped cards ${finalResponse.recipes.length} -> 3 (no meal shape)`);
+        finalResponse.recipes = (finalResponse.recipes as any[]).slice(0, 3);
+      }
+
+      // 清淡 / 親子 must not be answered with heavy or spicy dishes.
+      const heavyText = lastUserText(input.messages) ?? "";
+      const HEAVY_RE = /辣|咖喱|沙嗲|麻辣|糖醋|紅燒|三杯|鹵|滷|炸|孜然|黑椒/;
+      const wantsLight = /清淡|少油|輕盈|輕食/i.test(heavyText);
+      const wantsKid = /親子|小朋友|細路|孩子/i.test(heavyText);
+      if ((wantsLight || wantsKid) && Array.isArray(finalResponse.recipes) && finalResponse.recipes.length > 0) {
+        const filtered = (finalResponse.recipes as any[]).filter((recipe) => !HEAVY_RE.test(String(recipe?.name ?? "")));
+        if (filtered.length > 0 && filtered.length !== finalResponse.recipes.length) {
+          console.log(`[AI Chef] ${wantsLight ? "light" : "kid"} postcondition removed=${finalResponse.recipes.length - filtered.length}`);
+          finalResponse.recipes = filtered;
+        }
+      }
+
+      // Red line, every path: a 素食 ask must never get meat/seafood cards.
+      // deriveRecipeTags misses names like 豬絞肉 (ingredients have no category),
+      // so match the ingredient text directly.
+      const vegRecipes = (finalResponse.recipes ?? []) as any[];
+      if (/素食|吃素|食素|vegan|vegetarian/i.test(lastUserText(input.messages) ?? "") && vegRecipes.length > 0) {
+        const MEAT_RE = /豬|牛|羊|雞|鴨|鵝|魚|蝦|蟹|蜆|蠔|帶子|瑤柱|火腿|煙肉|臘腸|排骨|肉/;
+        const isMeat = (raw: unknown) => {
+          const name = String(raw ?? "");
+          if (!name) return false;
+          if (/素(蠔油|肉|雞|魚|蝦|排骨|火腿)/.test(name)) return false;
+          return MEAT_RE.test(name);
+        };
+        const kept = vegRecipes.filter((recipe: any) => {
+          const items = (recipe.ingredients ?? []).map((item: any) =>
+            typeof item === "string" ? item : String(item?.name ?? ""),
+          );
+          return !isMeat(recipe.name) && !items.some(isMeat);
+        });
+        if (kept.length !== vegRecipes.length) {
+          console.log(`[AI Chef] veg postcondition removed=${vegRecipes.length - kept.length} path=${metricPath}`);
+          finalResponse.recipes = kept as typeof finalResponse.recipes;
+          if (kept.length === 0) {
+            finalResponse.content = "我搵唔到合適嘅素食主菜，試下：紅燒豆腐、素麻婆豆腐、蒜蓉炒雜菌？";
+          }
+        }
+      }
+
       return finalResponse;
     }),
 });
diff --git a/server/services/chefSlots.ts b/server/services/chefSlots.ts
index 5e35b7f..4cb8860 100644
--- a/server/services/chefSlots.ts
+++ b/server/services/chefSlots.ts
@@ -118,12 +118,16 @@ export const CHEF_SLOT_PROMPT = `你只做一件事：把用戶最新一句說
    例：「有咩湯水」→ { "dishType": "soup", "wantsCards": true }；「有咩蒸嘅餸」→ { "method": "steam", "wantsCards": true }。
 8. servingsHint = 用戶講幾多人食；冇講就 null。
 9. 粵語口語、錯字、中英夾雜、省略都要理解；唔確定就寧願欄位留 null，唔准猜。
+10. **只解析最新一句。** 上一輪對話只可以用嚟理解代詞（「呢個」「嗰個」）或「同上／都要」，
+    唔可以繼承上一輪嘅 protein / dishType / method / tags。
+    例：上輪「小朋友想食蒸水蛋」，今輪「辛辣嘢呢」→ 只可以出 tags=["spicy"]，
+    唔可以有 kids / steam / egg。
 10. avoid = 用戶明確唔想要嘅食材或條件（「唔要牛」「走辣」「唔食海鮮」→ ["牛"]/["辣"]/["海鮮"]）。冇就 []。
 11. 只輸出 JSON，唔准加解釋或 markdown。`;
 
 /** Bump whenever the prompt or the slot semantics change: cached parses from an
  *  older parser must never be reused (stale maxMinutes/wantsCards bit us badly). */
-export const CHEF_SLOT_PARSER_VERSION = "2026-11-04a";
+export const CHEF_SLOT_PARSER_VERSION = "2026-11-04b";
 
 /** Stable cache key: NFKC, lowercase, drop whitespace/punctuation. */
 export function normalizeChefText(text: string): string {
```

## 問題（逐條答，唔好寫其他東西）
1. 呢批 diff 邊一段最有可能令正確答案被錯誤過濾走？（指出 commit + 行）
2. `pantry_direct` 早退（chat 入口、未經 quota/credit/audit log）有咩風險？會唔會令免費用戶繞過上限？
3. 有冇一段應該用 flag 包住而唔係直接改行為？
