# Kindcipe backend — 工作規則

（全局規則見 `~/.config/opencode/AGENTS.md`，此檔只寫 repo 專屬補充。）

## 四步關卡（車主 2026-11-08 定案，2026-11-08 晚修訂為七步，任何 code／deploy／migration 前必須跑完）

1. **Hermes 先講問題畀 OC**：事實、證據（DB／log 數字）、重現步驟、影響範圍。
   唔准一開口就落指令。
2. **OC 出 plan**：做法 ＋ 風險 ＋ 更好做法。
3. **Hermes 分析個 plan**：核實佢嘅數字、指出錯處、提反建議。
4. **再同 OC 傾**：一輪只准一個 blocking list；超過 2 輪仍然分歧 → 交車主裁。
5. **明確一致同意**：OC 要答「同意」，而 Hermes 自己亦冇保留。
   佢未答／卡權限／轉頭做其他事 = **未一致，唔准當默許**。
6. **問車主批准**：車主答「A／Agree」只係**定義需求**，唔算批准；
   要另外問一句「要唔要我做？」
7. **才做**：改 code／deploy／migration／改設定。

- 分歧未解 → 報車主三欄（佢理由／我核實數字／我反制），由車主拍板。
- deploy、push、migration **每次獨立批准**，唔可以沿用上一次。
- 未經批准改咗檔 → 第一句承認違規、列出已改檔案、提供 `git checkout -- <files>` 還原、把改動降級成提案。

## 改動前必做：回歸影響分析（Regression Impact Analysis）

任何改動開工前，先答齊四條，並在交付時寫一段「影響分析」：

1. **touch 邊啲現有功能**：具體到 endpoint／flow（登入、匯入 parseUrl／parseImage／importUser、AI Chef 出卡、扣 credit、付款 webhook、我的食譜、deep link）。
2. **有咩現有行為會改變**：預設答案係「有」，要主動證否。特別查：`null`／空陣列、舊 client 冇送新參數、flag OFF、cache 命中舊版、語言／時區、排序改變。
3. **最壞情況 + 點退**：關 flag／revert commit／Railway 上一個 deployment；用戶會見到咩 error。
4. **驗證方式**：`env -u DATABASE_URL npm run test:chef` 0 fail（跑 ≥3 次，已知 ~15% flaky）＋ `tsc --noEmit` 0 ＋ 相關舊 test。唔准只跑新 test。

未寫呢段嘅改動，一律當未完成。

## 修 bug 五步（唔准跳步）

1. **先重現，唔准靠讀 code 猜。** 用真實輸入（真 API／真 DB／真 query）重現，並寫低：輸入、期望、實際、時間。
2. **寫低基線數字。** 例如「20 條 query，7 條有卡 = 35%」。冇基線就冇「修好」可言。
3. **一次只改一樣，≤ 1 個檔優先。** 改兩個以上檔案要講明為何唔可以分開。
4. **修完用同一條 script 再跑，貼修前／修後數字。** 唔准只講「應該得」。
5. **唔准中途停。** 交付要有：commit、tsc、test 次數、修前修後數字、影響分析。做唔完要講明停喺邊同原因。

**判斷「修好」嘅唯一標準**：同一條重現 script 嘅數字有改善，而且舊 test 唔跌。

## Repo 鎖（防止兩個 agent 撞）
改任何檔之前，先認領 repo 鎖：

```bash
LOCK=~/.hermes/scripts/kindcipe-lock.sh
$LOCK status
$LOCK claim <repo> <agent> "<做咩>"
# …改嘢、驗、push、deploy…
$LOCK release <repo> <agent>
```

- `<repo>`：kindcipe-backend / kindcipe-app-4 / kindcipe-site
- 鎖 90 分鐘自動過期；未 release 就離開，下一個 agent 會等或接手
- **同一時間一個 repo 只准一條線**；另一個 agent 想改就要等
- 狀態一律寫入 `~/Desktop/Kindcipe/manus/QUEUE.md`，唔好喺唔同 tab 各寫一份
