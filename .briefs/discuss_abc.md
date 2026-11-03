# 討論（只准分析，唔准改任何檔、唔准 commit、唔准 git 操作）

## 背景：今日已修（production 4d5a04a）
```
· 素食 postcondition（唔會出肉）
· protein 用食材 category（海鮮唔會出雞）
· 類別詞（蛋類／海鮮類／粉麵／湯）轉 protein / dishType
· 清淡／辣啲 modifier 唔再被 planner 吞掉
· 素食／kids／quick 主菜優先排序
· dishType 改為只比對菜名（生粉唔再令所有菜變麵）
20 條 query：19 有卡、對題約 16（80%）
```

## 剩三個問題（需要你分析根因，唔要改）
### A「想食粉麵」→ 文字追問（0 卡）
```
chef_query_log：slots {dishType:"noodle", wantsCards:true} relax_level=0 served=0 reason=library_miss
本地用同一 retrieveChefCards（離線 dump 337 張）測試：有卡（豉油王炒麵 / 臘味煲仔飯 / 榨菜肉絲湯米粉）
→ 即係 production 根本冇行到 pipeline，或者 pool 同本地唔同
請你喺 code 找出：router 有邊個早段分支會喺 pipeline 之前 return 文字（同 library_miss 相關）
```

### B「有咩一鍋到底」→ 慢燉牛肉寬粉（唔算一鍋）
```
slots 應有 tags ["one-pot","ricecooker"]；實際出嘅卡唔一定係一鍋
請分析：deriveScenarios 嘅 one-pot 判斷（電飯煲／煲仔／燜）夠唔夠覆蓋？香港常見「一鑊熟／一鍋到底／煲仔菜」
```

### C「小朋友食咩好」→ 西米露／乳酪碗
```
tags kids；已加主菜權重但仍然出甜品
請分析：kids tag 應該點樣分「小朋友主菜」vs「兒童甜品」，現時 scoreRecipe 權重夠唔夠
```

## 要你答
1. A 嘅確切 return 位置（檔名 + 行號 + 條件），同為何 production 會 library_miss 而本地唔會
2. B 嘅 tag 覆蓋缺口（唔准用詞表做解法，講結構性做法）
3. C 嘅排序權重建議（具體數字）
4. 三個嘅優先次序，同每個嘅驗收標準
5. 有冇我漏咗嘅根因

## 限制
```
· 只准讀 repo 內檔案
· 唔准改檔、唔准 commit、唔准 git、唔准 deploy
· 答案要具體到檔名／函數／行號
