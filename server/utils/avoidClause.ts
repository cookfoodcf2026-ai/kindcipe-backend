/**
 * 由用戶句子剝走「忌口子句」，只留返「佢想食咩」。
 *
 * 點解需要：postcondition（例如 protein 過濾）讀原文，
 * 「4 人食。3 餸 1 湯；避免：蝦」會被當成「用戶想食蝦」，
 * 結果只保留海鮮卡，明明湊夠 4 張都變成 3 張（production 實測）。
 *
 * 規則：只刪「關鍵詞 + 冒號 + 緊接嘅清單」，清單以標點結束；
 * 冇冒號嘅（例如「避免太油」）唔動，因為唔一定係食材清單。
 */

const AVOID_KEYWORDS = [
  "避免", "忌口", "戒口", "過敏", "敏感",
  "唔想食", "唔食", "唔要", "不要", "不吃", "走",
];

const LIST_END = "，,；;。\n\r\u3000";

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function stripAvoidClauses(text: string): string {
  let out = String(text ?? "");
  for (const keyword of AVOID_KEYWORDS) {
    // 關鍵詞後面一定要有冒號（全形或半形）才算「清單子句」
    const re = new RegExp(
      `[；;，,]?\\s*${escapeRe(keyword)}\\s*[：:]\\s*[^${LIST_END}]*`,
      "gu",
    );
    out = out.replace(re, " ");
  }
  // 「我想食雞，唔食牛肉」— 冇冒號但明顯係忌口嘅單項，都剝走
  out = out.replace(/[，,；;]\s*(?:唔食|唔要|不要|不吃|走)\s*[^\s，,；;。]*/gu, " ");
  return out
    .replace(/\s+([，,；;。、])/gu, "$1")   // 標點前唔留空格
    .replace(/^[，,；;。、\s]+/u, "")      // 開頭唔留殘餘標點
    .replace(/\s{2,}/gu, " ")
    .trim();
}
