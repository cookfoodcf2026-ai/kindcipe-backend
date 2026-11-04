# 審核（只分析，唔准改 code／commit／deploy）

## 背景
今晚 03:00 之後我（Hermes）自己改咗以下，**未經你同意就 commit + deploy**。
請你逐個 commit 審：有冇 regression、有冇更安全做法、要唔要 revert。

## Backend（origin/main 0eaf7ef）
```
5bacdb8 → 之後嘅 commit：
47990cf  prompt：唔可以繼承上一輪 facets（辛辣嘢呢 出咗蒸肉餅）
cf5ca95  scenario search 忽略字面 query（素食熱鍵）
7d9a183  scenario 詞（素食／高蛋白）唔當「指定菜式」
0eaf7ef  scenario 熱鍵：7 日 seen 清空 pool 時最後 fallback
```

## App（kindcipe-app-4 origin/main 977428d8）
```
ee5c60bb  按鈕名統一（快手／清淡／電飯煲／親子／宴客／高蛋白／素食）
          + 「AI 生成」掣改為先打招呼（aiChef.aiAsk，4 語言）
977428d8  熱鍵改送短句（例「素食」）俾後端，唔送長 prompt
```

## 你要答
1. 每個 commit 有冇 regression 風險？特別係 `applySearchFilters`／`pickSoupMeal` 相關。
2. `47990cf`（唔繼承上一輪）會唔會令「同上」「都要」呢類跟進失效？
3. `0eaf7ef` 忽略 7 日 seen 做最後 fallback，會唔會令重複卡大量出現？
4. App 側送短句：會唔會令「用戶已經打咗字」嘅情況（lastUserContent 有內容）行為改變？
5. 有冇更安全嘅寫法（例如加 flag 而唔係直接改行為）？
6. 你會唔會要求 revert 任何一個？講明邊個同原因。

## 限制
只讀 repo 內檔案（backend）；app 嘅改動我以文字描述，你判斷風險即可。
