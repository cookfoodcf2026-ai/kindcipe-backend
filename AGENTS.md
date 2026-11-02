# Kindcipe backend — 工作規則

（全局規則見 `~/.config/opencode/AGENTS.md`，此檔只寫 repo 專屬補充。）

## 改動前必做：回歸影響分析（Regression Impact Analysis）

任何改動開工前，先答齊四條，並在交付時寫一段「影響分析」：

1. **touch 邊啲現有功能**：具體到 endpoint／flow（登入、匯入 parseUrl／parseImage／importUser、AI Chef 出卡、扣 credit、付款 webhook、我的食譜、deep link）。
2. **有咩現有行為會改變**：預設答案係「有」，要主動證否。特別查：`null`／空陣列、舊 client 冇送新參數、flag OFF、cache 命中舊版、語言／時區、排序改變。
3. **最壞情況 + 點退**：關 flag／revert commit／Railway 上一個 deployment；用戶會見到咩 error。
4. **驗證方式**：`env -u DATABASE_URL npm run test:chef` 0 fail（跑 ≥3 次，已知 ~15% flaky）＋ `tsc --noEmit` 0 ＋ 相關舊 test。唔准只跑新 test。

未寫呢段嘅改動，一律當未完成。

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
