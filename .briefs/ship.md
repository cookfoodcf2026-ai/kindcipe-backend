# 上架前檢查（只分析，唔准改檔／commit／git）

## 現況（production）
```
backend ca3a0c4、health ok、test:chef 328/328、tsc 0
web home/login/cook 全部 200
DB：official 337、custom 103 active、users 62、families 5、chef_query_log 420 行
AI Chef：20 條 query × 5 次 = 100/100 有卡，每次一致，紅線 0（素食無肉／海鮮無雞／蛋類無牛）
```

## 我列出嘅上架前待辦
```
A 清走測試 family（families 5，懷疑有 Mavis Test Kitchen 系列殘留）
B 確認 DB 最新備份時間，唔夠新就即刻備份
C Stripe live 真卡 HK$30 founding 升級 E2E（確認 Pro 保留、webhook 正常）
D Apple JS popup 仍然隱藏（backend OAuth redirect 已通）
E 匯入流程（parseUrl／parseImage／importUser）未在這輪回歸測試
F Cook Mode、onboarding、一週餐單 未在這輪回歸測試
```

## 要你答
1. 上面 A–F 有邊個係「唔做就唔應該上架」？邊個可以上架後再補？
2. 有冇我漏咗嘅**上架 blocker**（睇 code 同 migration 現況判斷，例如未 apply 嘅 migration、env var 缺漏、feature flag 狀態）？
3. 你會建議咩上架順序（例如先備份 → 清測試資料 → 真卡測試 → 全流程 smoke test）？
4. `CHEF_SLOT_PIPELINE=true` 而家係開住；上架前應唔應該改返 default（code 內）？
5. 有冇已知但未修嘅 bug 會令你真係唔敢上架？講出嚟。

## 限制
只准讀 repo 內檔案；唔准改任何東西。
