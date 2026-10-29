export type SafetyKind = "allergy" | "pregnancy" | "medical";

export type SafetyIntent = {
  kind: SafetyKind;
  matched: string;
};

const FOOD_CONTEXT = /食|煮|食譜|餐|材料|菜|湯|魚|肉|海鮮|配料|成份|成分|安全|recipe|eat|cook|food/i;

export function detectSafetyIntent(text: string): SafetyIntent | null {
  const raw = String(text ?? "").trim();
  if (!raw || !FOOD_CONTEXT.test(raw)) return null;

  const allergy = raw.match(/敏感|過敏|allergy|allergic/i);
  if (allergy) return { kind: "allergy", matched: allergy[0] };

  const pregnancy = raw.match(/懷孕|孕婦|孕妈|孕媽|pregnan/i);
  if (pregnancy) return { kind: "pregnancy", matched: pregnancy[0] };

  const medical = raw.match(/醫生|医生|醫療|医疗|药物|藥物|病|手術|手术|BB|嬰兒|嬰儿|寶寶|宝宝|baby|infant|六個月|6個月|medical|medicine/i);
  if (medical) return { kind: "medical", matched: medical[0] };

  if (/安全選擇|安全选择|安全啲/i.test(raw)) {
    return { kind: "allergy", matched: "安全選擇" };
  }
  return null;
}

export function safetyQuestion(lang: string, intent: SafetyIntent): string {
  if (lang.startsWith("en")) {
    if (intent.kind === "allergy") return "Food safety first: which ingredient or food group are you allergic to? I won't suggest a dish until you confirm.";
    if (intent.kind === "pregnancy") return "Pregnancy and food safety need individual medical advice. Please confirm what you want to ask, or check with your doctor.";
    return "I can't give medical advice. Please check with a healthcare professional; I can still help with general cooking steps.";
  }
  if (intent.kind === "allergy") {
    return "安全要緊：你對邊種食材或海鮮敏感？確認之前我唔會亂推薦或叫 AI 煮。";
  }
  if (intent.kind === "pregnancy") {
    return "懷孕期間飲食要按個人身體狀況處理；你而家想問邊款食物或食譜？建議同時諮詢醫生或營養師。";
  }
  return "我唔可以提供醫療建議；請先諮詢醫生或專業醫護人員。煮食技巧我可以幫手。";
}
