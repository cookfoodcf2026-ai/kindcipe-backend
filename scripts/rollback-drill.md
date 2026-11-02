# Rollback drill (read-only rehearsal)

> 呢份文件只記錄 rehearsal 同手動 rollback 步驟。**唔准執行 `railway redeploy`，除非車主在場。**
> `scripts/check-rollback.sh` 只會列 deployment / 印 SQL，唔會 deploy、push、login 或連 DB。

## 1. 上次 local rehearsal 實測（Hermes 代跑，照抄）

- 舊 code：`cc94794`（`0cc86bf` 嘅 `HEAD~10`）
- 臨時 worktree：`~/.hermes/cache/scratch/wt_rollback`（已清理）
- 指令：`env -u DATABASE_URL npm run test:chef`
- 結果：**tests 182 / pass 181 / fail 1**
- 唯一 fail：`hidden A can run in isolation and is deterministic`
- 失敗原因：`Error ENOENT ~/.hermes/cache/scratch/hidden_A.jsonl`
- 分類：**純環境 fixture 路徑問題，唔係舊 code regression**
  - test 用 `resolve(process.cwd(), "../hidden_A.jsonl")`
  - worktree cwd 喺 scratch，`../` 指去 scratch，唔係 `manus/`
- 補跑：fixture 放回該位置後
  `npx tsx --test server/services/chefDomain/chefDomain.test.ts`
  → **tests 5 / pass 5 / fail 0**
- 結論：舊 code 喺新目錄結構下可跑、無 crash。

**限制（必須記住）**：`test:chef` 係 DB-free（`DATABASE_URL` 已 unset），所以 rehearsal **只證明舊 code 唔會因為 code 層而爆**，**唔證明**舊 code 讀新 column 唔會 500；真正 DB 相容性要靠 production read-only SQL 同 staging/restore DB 驗證。

## 2. 查 current / previous deployment（唯讀）

```bash
bash scripts/check-rollback.sh
```

- 已登入 Railway：印 `CURRENT` / `PREVIOUS` deployment id、status、created、commit。
- 未安裝或未登入：script 會印「需要車主手動跑 railway login」，**唔會自行 login**。
- 查閱後要人手確認 previous deployment 係邊個；script 唔會代你 redeploy。

## 3. Code rollback（車主在場才做）

```bash
railway redeploy -y <PREVIOUS_DEPLOYMENT_ID>
```

Rollback code 唔會自動移除 DB 新 object；以下 additive objects 會保留：

- 0048/0049：`ai_chef_meal_state` + turn-state columns
- 0050：`official_recipes.scenario_tags_user`、`custom_recipes.scenario_tags_user`
- 0051：`families.legacy_ai_credits`
- 0052：`ai_chef_family_safety` + `allergens`

驗證 SQL 已由 `check-rollback.sh` 印出；用 read-only `psql` 執行，唔好做 write。

## 4. DB rollback

- Additive schema 一般**唔需要** rollback；舊 code 會忽略新 column/table。
- 如果要 rollback 資料（例如新 code 寫入舊 code 唔識嘅值），要：
  1. 停 service / 停止寫入
  2. 用 deploy runbook 嘅 production backup + restore 流程
  3. restore 後再開 service
- 唔好逐個 column 手動 drop；會令 schema_migrations 同實際 schema 不一致。

## 5. 最大風險（一句）

**Rollback 最大風險係「code rollback 成功但資料/額度語義已改變」：舊 code 唔識 `legacy_ai_credits`、scenario user tags、allergen 資料，唔會 500，但 quota／篩選結果會同新 code 不一致，必須以 backup/restore 或明確資料修復處理，而唔係當 rollback 已完成。**

## 6. 驗證清單

```bash
bash -n scripts/check-rollback.sh
bash scripts/check-rollback.sh
git status --short
```

預期：
- `bash -n` 無輸出（exit 0）
- script 印 current/previous deployment 或明確 login fallback
- 印 0050/0051/0052 SQL
- `--redeploy` 參數會 exit 1 + 警告
