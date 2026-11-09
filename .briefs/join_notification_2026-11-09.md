# 有人加入廚房 → 通知主人（backend + app）

## 問題
`family.join` 成功後只加成員就 return。主人完全收唔到通知：冇 push、冇 app 內提示。
Beta 10–20 人時，主人唔知家人／姐姐入咗，會重複 send 邀請碼。

## 要做（最小版本）
1. **Push**：join 成功後，用 `sendPushNotifications`（`server/pushNotification.ts`）通知主人嘅 token。
   - title: zh-TW `🎉 新成員加入 {{kitchen}}` / en `New member joined {{kitchen}}`
   - body: zh-TW `{{name}} 加入咗你廚房` / en `{{name}} joined your kitchen`
2. **SSE**：用 `broadcastToFamily`（`server/_core/sseSync.ts`）推一個 `memberJoined` 事件，令開住 web/app 嘅主人即時見到提示（web 冇 push）。
3. **文案**：zh-TW / en / fil / id 四個 locale 都要。
4. **唔可以**：
   - 已係成員重複 join → 唔通知
   - 加入者係主人本人 → 唔通知
   - 邀請碼錯 → 唔通知任何人
5. **唔可以**新增 DB table（保持最小）。

## 驗收
- 測試：join 通知一次、re-join 唔通知、錯碼唔通知
- backend `tsc --noEmit` 0 error
- `npm run test:chef` 全綠（現時 483）
- 改完 **唔准 commit、唔准 deploy**，只回報改動檔案 + 測試數字
