# 審核（只分析，唔准改 code／commit／deploy）

## 背景
上架前 AI Chef 已達標：production `5bacdb8`、20 條 × 5 次 = 100/100、零紅線、
test 332/332、tsc 0。

## 待你審嘅 P1（上架後第一件）
「匯入 parse 只出『繁中 + 用戶語言』，其餘語言交 deferred worker」

原因（已查證）：
```
· parse prompt 一次過要求 name/description/steps/每 ingredient × 4 語言
  → LLM parse ~25s、output ~2,597 tokens
· deferred worker 已有 buildTranslationPatch()（只補缺失欄位，冇重複翻譯）
  → 即係 parse 做咗本應由 deferred 做嘅工序（工序放錯位置，唔係重複）
```

方案：
```
1. parse 只出：繁中 canonical + 請求者語言（zh 用戶只出繁中；en 用戶出 zh+en）
2. 其餘 3 語言交 deferred（worker 完全不改）
3. 改之前先量 10 條真 URL parse 的 p50/p95，確認 25s 唔係個別案例
4. UI：非中文用戶嘅卡片，主語言已 ready 就正常顯示；其他語言未 ready 顯示原語言 + 「翻譯中」badge（唔可以出中文當正文）
```

## 要你答
1. 你同意「worker 唔需要改、只改 parse 輸出語言數」？有冇漏？
2. parse 只出 2 語言，估計 output token 減幾多？25s 會降到幾多？（要你按 code 判斷，唔好估得太樂觀）
3. 有冇其他隱藏成本：例如 deferred worker 併發、翻譯失敗重試、`translation_status` 狀態機
4. 如果用戶語言係 fil/id，而 deferred 未完成，UI 顯示「原文 + 翻譯中」定「等 ready 才顯示」？你建議邊個？為什麼？
5. 呢個改動有冇可能影響 AI Chef（我哋今日改咗很多）？
6. 你認為 P1 仲有冇更值得先做嘅事（例如素食主菜、菜系內容）？

## 限制
只讀 repo 內檔案。唔准改任何東西。
