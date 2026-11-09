# 有人加入廚房 → 通知主人（加 email，web beta 用）

## 背景
`family.join` 成功後已有：push（原生 app 用）+ `broadcastToFamily`（但 sseSync 係空實作，等於冇用）。
Web beta 用戶完全收唔到通知 → 主人唔知有人加入。

## 要做
join 成功後，**發一封 email 通知主人**（best-effort，失敗唔可以影響 join）：
1. 收件人：家庭主人（`families.ownerId` 對應 `users.email`）；主人冇 email 就跳過
2. 內容：新成員名 + 廚房名；四個語言 zh-TW / en / fil / id（跟主人 `users.language`，冇就用 zh-TW）
3. 用現有 `sendTransactionalEmail`（`server/_core/email.ts`，Resend 已配置）
4. 主題（zh-TW）例：`{{name}} 加入咗你嘅廚房「{{kitchen}}」`
5. 內文（zh-TW）例：
   - 一句說明「{{name}} 用邀請碼加入咗你嘅廚房」
   - 一行 CTA「打開 Kindcipe 睇下」→ 連 `https://app.kindcipe.com`
   - 底部細字：你收到呢封係因為有人加入你嘅廚房

## 唔可以
- re-join（已係成員）→ 唔發
- 加入者係主人自己 → 唔發
- 邀請碼錯 → 唔發
- 發 email 失敗 → 唔可以令 join 失敗（try/catch）
- 唔准改 SSE、唔准 refactor push
- **唔准 commit、唔准 deploy**

## 驗收
- 新測試：join 發一封 email 一次、re-join 唔發、主人冇 email 跳過、英文主人收到英文版
- `npx tsc --noEmit` 0 error
- `npm run test:chef` 全綠（483）
- `npm run test:chef:db` 只可以多新 test，唔可以新增 fail（現有 9 個 pre-existing fail）
