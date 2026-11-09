# Recipe ref 身份回填 Runbook（0064 + 0065）

## 目的

| Migration | 做乜 | 預期數字（2026-11-10 production baseline） |
|---|---|---|
| `0064_normalize_meal_plan_recipe_refs.sql` | 將 `meal_plans.recipe_id` 嘅 legacy colon ref 正規化：`official:<n>` → `official_<n>`、`user:<n>` → `user_<n>`。只限正整數、冇 leading zero。其他格式一律唔郁、唔猜。 | 符合 `^(official\|user):[1-9][0-9]*$` = **112 行**；first run updated = 112、residual colon = 0；rerun updated = 0 |
| `0065_backfill_shopping_from_meal_plan.sql` | 用 `shopping_items.from_meal_plan_id` join `meal_plans`，把 canonical `recipe_id` 回填落 `from_recipe_id`。只 by `(id, family_id)` join，**完全唔用菜名比對**。 | 可更新 orphan = **95 行**；first run updated = 95、canonical plan 但非 canonical link = 0；rerun updated = 0 |

兩支都係 idempotent，而且各自用一個 `DO $$ ... $$` block 一次過做「備份 → 更新 → 驗證」，所以單支 migration 係 atomic。`npm run db:migrate` 會用 `schema_migrations` 記錄已 apply 嘅檔名。

> 兩支 migration 都會建立臨時 rollback 備份表：
> - `_migration_0064_meal_plan_ref_backup`
> - `_migration_0065_shopping_ref_backup`
>
> 備份表只記錄本次 migration 實際寫入嘅 row（連 old value），驗證簽收前唔好 drop。

---

## 0. 前置

- 只可以對 Railway production `railway` database 執行；preflight 會拒絕 Supabase／其他 DB。
- 確認你係喺 `kindcipe-backend` repo root。
- 準備好 Railway public database URL（唔好將 URL 貼入 shell history／commit）：
  ```bash
  export DATABASE_URL='<railway-public-database-url>'
  ```
- **先確認 `main` 已經包含呢兩個 migration 檔**；production 只可以由 `main` build。未 merge 就唔好部署。

---

## 1. 先做 production snapshot（必做）

```bash
mkdir -p "$HOME/Backups/kindcipe"
STAMP="$(date +%Y%m%d-%H%M%S)"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$HOME/Backups/kindcipe/kindcipe-prod-$STAMP.dump"
```

檢查 dump 存在同唔係 0 byte：

```bash
ls -lh "$HOME/Backups/kindcipe/kindcipe-prod-$STAMP.dump"
```

### 1a. Restore 實測（唔可以用 empty DB bootstrap 代替）

`0000` 依賴 `users` baseline，empty DB bootstrap 會失敗，唔算驗證。要 restore 一個真 snapshot：

```bash
createdb kindcipe_restore_test
pg_restore \
  --no-owner \
  --no-privileges \
  --dbname=kindcipe_restore_test \
  "$HOME/Backups/kindcipe/kindcipe-prod-$STAMP.dump"
```

之後所有 dry-run 同 migration 排練，**先喺 `kindcipe_restore_test` 跑一次**：

```bash
export RESTORE_URL='postgres://localhost/kindcipe_restore_test'
```

---

## 2. Dry-run（apply 前）

### 2.1 Migration A（0064）

```bash
psql "$RESTORE_URL" -c "
SELECT CASE
         WHEN recipe_id ~ '^(official|user):[1-9][0-9]*\$' THEN 'colon_positive_no_leading_zero'
         WHEN recipe_id ~ '^(official|user):' THEN 'colon_other_kept'
         WHEN recipe_id ~ '^[0-9]+\$' THEN 'bare_number_kept'
         ELSE 'other_kept'
       END AS format,
       count(*) AS rows
  FROM meal_plans
 GROUP BY 1
 ORDER BY 1;"
```

**Expected（production 2026-11-10）：`colon_positive_no_leading_zero = 112`。**
`colon_other_kept`、`bare_number_kept`、`other_kept` 嘅數字要記錄低，apply 後要完全一樣。

### 2.2 Migration B（0065）

```bash
psql "$RESTORE_URL" -c "
SELECT CASE
         WHEN si.from_recipe_id IS NULL THEN 'orphan_null'
         WHEN si.from_recipe_id ~ '^(official|user)_[1-9][0-9]*\$' THEN 'canonical'
         ELSE 'orphan_non_canonical'
       END AS link_status,
       count(*) AS rows
  FROM shopping_items si
 WHERE si.from_meal_plan_id IS NOT NULL
 GROUP BY 1
 ORDER BY 1;"

psql "$RESTORE_URL" -c "
SELECT count(*) AS will_update
  FROM shopping_items si
  JOIN meal_plans mp
    ON si.from_meal_plan_id = mp.id
   AND si.family_id = mp.family_id
 WHERE mp.recipe_id ~ '^(official|user)_[1-9][0-9]*\$'
   AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*\$');"
```

**Expected：`will_update = 95`。**

### 2.3 喺 restored DB 先排練

```bash
DATABASE_URL="$RESTORE_URL" npm run db:migrate
```

跟住即刻跑第 3 節嘅 verification。restored DB 全部符合預期，先再去 production。

---

## 3. Apply order：一定係 A 然後 B

```bash
# A — 0064
npm run db:migrate -- 0064_normalize_meal_plan_recipe_refs 2>/dev/null || npm run db:migrate
```

> `npm run db:migrate` 會按檔名排序跑所有未 apply 嘅 SQL；因為 `0064` < `0065`，正常一次會順序跑 A 再 B。如果想分開兩次做（建議），先確認 A 嘅 NOTICE／verification 過咗，再跑 B：
> ```bash
> # 第一次：只 apply 0064（如果 runner 支援逐支，否則先只放 0064 入 migration 目錄）
> npm run db:migrate
> # 跑第 3.1 節 verification，確認 residual colon = 0
> # 第二次：apply 0065
> npm run db:migrate
> # 跑第 3.2 節 verification
> ```

**唔准反過來（B 先）**：B 依賴 A 已經把 `meal_plans.recipe_id` 正規化；如果先跑 B，plan 仲係 colon 格式，B 嘅 `~(official|user)_...` 條件會 miss，95 行永遠補唔到。

### 3.1 Migration A verification（apply 後）

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) AS residual_colon
  FROM meal_plans
 WHERE recipe_id ~ '^(official|user):[1-9][0-9]*\$';"
```

**必須係 `0`。**

再跑一次 2.1 嘅 format 分佈 query：
- `colon_positive_no_leading_zero` 必須變 `0`；
- `colon_other_kept`、`bare_number_kept`、`other_kept` 必須同 apply 前一樣（證明冇亂郁其他格式）。

### 3.2 Migration B verification（apply 後）

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) AS canonical_plan_noncanonical_link
  FROM shopping_items si
  JOIN meal_plans mp
    ON si.from_meal_plan_id = mp.id
   AND si.family_id = mp.family_id
 WHERE mp.recipe_id ~ '^(official|user)_[1-9][0-9]*\$'
   AND (si.from_recipe_id IS NULL OR si.from_recipe_id !~ '^(official|user)_[1-9][0-9]*\$');"
```

**必須係 `0`。**

再確認 backup 表行數：

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM _migration_0064_meal_plan_ref_backup;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM _migration_0065_shopping_ref_backup;"
```

First run 應該分別係 `112` 同 `95`（如果係 rerun 就睇返第一次 apply 嘅數）。

### 3.3 Preflight gate

```bash
npm run preflight -- 0064_normalize_meal_plan_recipe_refs
npm run preflight -- 0065_backfill_shopping_from_meal_plan
```

兩個都要 `ok: true`。

---

## 4. Rollback

原則：**只回退本次 migration 寫入嘅 row**，而且只限該 row 之後冇再被改過（`current value = new value`）。唔會 full restore、唔會碰原本就係 canonical 嘅資料。

次序一定係 **B 先，A 後**（reverse order）：

```bash
# 1) Rollback B — 用 backup 表還原 from_recipe_id
psql "$DATABASE_URL" -c "
UPDATE shopping_items si
   SET from_recipe_id = b.old_from_recipe_id
  FROM _migration_0065_shopping_ref_backup b
 WHERE si.id = b.shopping_item_id
   AND si.from_recipe_id = b.new_from_recipe_id;"

# 2) Rollback A — 用 backup 表還原 meal_plans.recipe_id
psql "$DATABASE_URL" -c "
UPDATE meal_plans mp
   SET recipe_id = b.old_recipe_id
  FROM _migration_0064_meal_plan_ref_backup b
 WHERE mp.id = b.meal_plan_id
   AND mp.recipe_id = b.new_recipe_id;"
```

Rollback 後注意：

- `schema_migrations` 仍然會有 `0064...`／`0065...` 記錄。如果要用 `npm run db:migrate` 重新 apply，必須先手動刪除對應記錄，否則 runner 會跳過：
  ```bash
  psql "$DATABASE_URL" -c "DELETE FROM schema_migrations WHERE name IN ('0064_normalize_meal_plan_recipe_refs','0065_backfill_shopping_from_meal_plan');"
  ```
- 確認 rollback 冇漏（backup 表每一行都應該已經還原）：
  ```bash
  psql "$DATABASE_URL" -c "
  SELECT count(*) AS not_reverted
    FROM _migration_0065_shopping_ref_backup b
    JOIN shopping_items si ON si.id = b.shopping_item_id
   WHERE si.from_recipe_id IS DISTINCT FROM b.old_from_recipe_id;"
  ```
- 完全簽收（建議觀察至少 7 日）之後，先手動清理備份表：
  ```bash
  psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS _migration_0065_shopping_ref_backup;"
  psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS _migration_0064_meal_plan_ref_backup;"
  ```
  **未簽收前唔好 drop**，否則 rollback 冇資料可還原。

---

## 5. 如果數字對唔上預期

**默認動作：停手，唔好繼續跑下一支。** 唔准為咗湊數而加 name matching、`LIKE` 菜名、或估格式。

### 5.1 Migration A before count ≠ 112

1. 先睇 2.1 嘅 format 分佈，唔好只睇總數。
2. 如果 `colon_positive_no_leading_zero` **多過 112**：
   - 可能係 baseline 之後有新 legacy 寫入。逐行 `SELECT id, recipe_id FROM meal_plans WHERE recipe_id ~ '^(official|user):[1-9][0-9]*$' ORDER BY id;` 核對。
   - 全部符合 `^(official|user):[1-9][0-9]*$` 就可以繼續；唔符合就係 predicate 有問題，停手。
3. 如果**少過 112**：
   - 可能有人手動修過。記錄實際數字，確認 residual colon 仍然可以變 0 就繼續。
   - 唔好用其他格式補數。
4. 如果 `colon_other_kept`／`bare_number_kept`／`other_kept` 有任何變化，**立即停手**，因為代表 migration 郁咗唔應該郁嘅 row。

### 5.2 Migration A after residual colon ≠ 0

- 立即用第 4 節 rollback A。
- 保留 `_migration_0064_meal_plan_ref_backup`，交出 residual rows 清單再查。

### 5.3 Migration B `will_update` ≠ 95

1. 先睇 2.2 嘅 orphan status 分佈。
2. **多過 95**：可能 baseline 後新增 orphan。逐行核對 `from_meal_plan_id`、`family_id`、plan `recipe_id` 都符合 predicate 先可以繼續；任何一行需要靠菜名／估，就停手。
3. **少過 95**：可能部分 orphan 已被新 code 修好，或 plan ref 未 canonical。用下面 query 搵出「有 plan 但冇被 B 覆蓋」嘅 row：
   ```bash
   psql "$DATABASE_URL" -c "
   SELECT si.id, si.family_id, si.from_meal_plan_id, si.from_recipe_id, mp.recipe_id AS plan_recipe_id
     FROM shopping_items si
     JOIN meal_plans mp
       ON si.from_meal_plan_id = mp.id
      AND si.family_id = mp.family_id
    WHERE mp.recipe_id !~ '^(official|user)_[1-9][0-9]*\$'
     ORDER BY si.id;"
   ```
   呢批係 plan ref 本身唔 canonical（應該由 A 處理）或其他格式，**保持原狀**，唔准猜。
4. 如果 after violations ≠ 0：用第 4 節 rollback B，保留備份表，唔好再跑。

### 5.4 任何 SQL error／NOTICE 顯示 `after` 唔係預期

- `DO` block 已經 rollback 咗自己嗰一支（atomic）。
- 但 backup 表可能已經有 row；下次重跑 `ON CONFLICT DO NOTHING` 會保留最原始 old value，安全。
- 停手、保留 log、唔好連跑第二次。

---

## 6. 簽收清單

- [ ] Snapshot 已做，dump size > 0
- [ ] Restore 到 `kindcipe_restore_test` 成功，並喺 restored DB 跑過 A → B
- [ ] A dry-run：colon positive = 112（或已逐行核對差異）
- [ ] A after：residual colon = 0；其他格式數字不變
- [ ] B dry-run：will_update = 95（或已逐行核對差異）
- [ ] B after：canonical plan 但非 canonical link = 0
- [ ] backup 表行數 = 112 / 95（first run）
- [ ] `npm run preflight -- 0064_...` 同 `0065_...` 都 `ok: true`
- [ ] 兩個 backup 表保留至少 7 日，簽收後才 drop
