# 只答 4 條（唔准執行 git／shell，唔准改檔）

```diff
diff --git a/server/routers/aiRecipe.ts b/server/routers/aiRecipe.ts
index 6eeeb91..e6b0121 100644
--- a/server/routers/aiRecipe.ts
+++ b/server/routers/aiRecipe.ts
@@ -6031,9 +6031,6 @@ async function applyZeroCardInsurance(
   // requested 3-dish-1-soup set with three arbitrary cards.
   if (detectMealShapeLoose(text)) return result;
   if ((result.intentOverride?.requested.total ?? 0) > 1) return result;
-  if (!isFoodRelatedForInsurance(result, text, params.mode, params.forceText, params.telemetry)) {
-    return result;
-  }
 
   try {
     const pool = await loadMealPool(params.familyId, params.searchOverride);
@@ -6062,8 +6059,9 @@ async function applyZeroCardInsurance(
     const minutesAsk = /(\d{1,3})\s*分鐘/.exec(text)?.[1];
     if (minutesAsk && (result.recipes?.length ?? 0) === 0) {
       const limit = Number(minutesAsk);
+      const SNACK_RE = /燕麥|西米|布丁|蛋糕|奶凍|雪糕|甜|糖水|飲|茶|咖啡|多士|吐司|bagel|乳酪|優格|yogurt|smoothie/i;
       const quick = rows
-        .filter((row) => cookOf(row) > 0 && cookOf(row) <= limit)
+        .filter((row) => cookOf(row) > 0 && cookOf(row) <= limit && !SNACK_RE.test(String((row as any)?.name ?? "")))
         .sort((a, b) => cookOf(a) - cookOf(b))
         .slice(0, 3)
         .map(toCard);
@@ -6093,6 +6091,11 @@ async function applyZeroCardInsurance(
       }
     }
 
+    // Anything that is not this kind of explicit fallback still needs a food signal.
+    if (!isFoodRelatedForInsurance(result, text, params.mode, params.forceText, params.telemetry)) {
+      return result;
+    }
+
     // A named dish the library does not have must NOT be answered with three
     // unrelated popular cards — ask whether to design it instead (0 credit).
     // Only dish-shaped names count (煲／麵／飯／糕…): ingredient words like 雞 or 牛
@@ -6114,16 +6117,17 @@ async function applyZeroCardInsurance(
       if (!hasDish) {
         // The 「食譜庫」 quick reply needs alternatives or it does nothing —
         // offer the closest library dishes (same characters / same protein).
-        const alts = rows
-          .filter((row) => {
+        const scoredAlts = rows
+          .map((row) => {
             const name = String((row as any)?.name ?? "");
-            if (!name) return false;
             const shared = Array.from(dishCandidate).filter((ch) => name.includes(ch)).length;
-            return shared >= 2;
+            return { row, shared };
           })
+          .filter((entry) => String((entry.row as any)?.name ?? "").length > 0)
+          .sort((a, b) => b.shared - a.shared)
           .slice(0, 3)
-          .map(toCard);
-        const fallbackAlts = alts.length > 0 ? alts : rows.slice(0, 3).map(toCard);
+          .map((entry) => toCard(entry.row));
+        const fallbackAlts = scoredAlts;
         console.log(`[AI Chef] named_dish_miss dish=${dishCandidate} — asking instead of serving popular cards (alts=${fallbackAlts.length})`);
         return {
           ...result,
@@ -7139,13 +7143,17 @@ export const aiRecipeRouter = router({
       // Answer it straight from the library with cards that actually use those
       // ingredients — the normal chat pipeline ignored the list entirely.
       const pantryText = lastUserText(input.messages) ?? "";
-      const pantryDb = /用以下食材|以下食材|用呢啲食材|食材[：:]/.test(pantryText) ? await getDb() : null;
-      if (mode === "chat" && pantryDb && /用以下食材|以下食材|用呢啲食材|食材[：:]/.test(pantryText)) {
+      const PANTRY_RE = /用以下食材|以下食材|用呢啲食材|食材[：:]|雪櫃|冰箱/;
+      const pantryDb = PANTRY_RE.test(pantryText) ? await getDb() : null;
+      if (mode === "chat" && pantryDb && PANTRY_RE.test(pantryText)) {
         // The colon follows 「煮餸」 in the canned prompt (食材煮餸：青菜、洋蔥…),
         // so anchor on the first colon instead of on 食材.
-        const listed = (pantryText.match(/[：:]\s*([^\n。]+)/)?.[1] ?? "")
-          .split(/[、,，/]+/)
-          .map((item) => item.trim())
+        // 「雪櫃得雞蛋同蔥」 has no colon — split on 得/同/、 too.
+        const listedPart = (pantryText.match(/[：:]\s*([^\n。]+)/)?.[1] ?? "")
+          || (pantryText.match(/得([^\n。]+)/)?.[1] ?? "");
+        const listed = listedPart
+          .split(/[、，,同＋+/]+/)
+          .map((item) => item.replace(/^(有|仲有|同|得)/, "").trim())
           .filter((item) => item.length >= 1 && item.length <= 8);
         const wanted = Array.from(new Set(listed)).slice(0, 6);
         if (wanted.length > 0) {
@@ -7172,8 +7180,15 @@ export const aiRecipeRouter = router({
                 .map((ing: any) => (typeof ing === "string" ? ing : String(ing?.name ?? "")))
                 .join(" ")}`;
               const hits = wanted.filter((item) => haystack.includes(item)).length;
-              return { card, hits };
+              // 用戶話「雪櫃得雞蛋同蔥」，就唔可以出蔥爆牛肉 —— 卡片唔准引入
+              // 用戶冇提到嘅肉類／海鮮。
+              const MEAT_WORD = /豬|牛|羊|雞|鴨|鵝|魚|蝦|蟹|蜆|蠔|帶子|瑤柱/;
+              const cardName = String(card.name ?? "");
+              const introducesMeat = (cardName.match(new RegExp(MEAT_WORD.source, "g")) ?? [])
+                .some((word: string) => !wanted.some((item) => item.includes(word) || word.includes(item)));
+              return { card, hits, introducesMeat };
             })
+            .filter((entry) => !entry.introducesMeat)
             .sort((a, b) => b.hits - a.hits);
           const cards = scored.filter((entry) => entry.hits > 0).map((entry) => entry.card).slice(0, 3);
           if (cards.length > 0) {
@@ -7747,6 +7762,25 @@ export const aiRecipeRouter = router({
         }
       }
 
+      // 「茶碗蒸」＋「電飯煲茶碗蒸」係同一道菜，唔好當兩張。
+      if (Array.isArray(finalResponse.recipes) && finalResponse.recipes.length > 1) {
+        const seenStems = new Set<string>();
+        const unique = (finalResponse.recipes as any[]).filter((recipe) => {
+          const stem = String(recipe?.name ?? "")
+            .replace(/^(電飯煲|氣炸鍋|焗爐|微波爐|慢煮)/, "")
+            .replace(/[（(][^)）]*[)）]/g, "")
+            .trim();
+          if (!stem) return true;
+          if (seenStems.has(stem)) return false;
+          seenStems.add(stem);
+          return true;
+        });
+        if (unique.length !== finalResponse.recipes.length) {
+          console.log(`[AI Chef] dedupe removed=${finalResponse.recipes.length - unique.length}`);
+          finalResponse.recipes = unique;
+        }
+      }
+
       // Red line, every path: a 素食 ask must never get meat/seafood cards.
       // deriveRecipeTags misses names like 豬絞肉 (ingredients have no category),
       // so match the ingredient text directly.
```

## 背景
上一輪你審過之後，我加咗：
- 20 分鐘類時間查詢 / 「唔要辣」→ 由 pool 揀卡（原本 0 卡）
- 卡片近似重複去重（茶碗蒸 vs 電飯煲茶碗蒸）
- 雪櫃食材：卡片唔准引入用戶冇講嘅肉類（原本出「蔥爆牛肉」）
- 具名菜式 miss → alternatives 一定 3 張（食譜庫掣之前係死掣）

## 問題
1. 呢批 diff 有冇 regression 風險？指出最危險嗰段。
2. 去重（strip 電飯煲/括號後比較）會唔會誤殺真正唔同嘅菜？
3. 雪櫃「唔准引入未列出肉類」用菜名 regex，有冇明顯誤判？（例：素雞、魚香茄子）
4. 你上一輪講嘅 pantry_direct 早退繞過 quota/audit —— 我未改。要唔要即刻改，定可以上架後補？
