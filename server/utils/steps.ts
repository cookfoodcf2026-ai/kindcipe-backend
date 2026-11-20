/**
 * 步驟碎片合併。
 *
 * 來源（IG／FB caption、YouTube transcript、LLM 輸出）經常按行斷句，
 * 令一句話被切成兩三段，例如日文：
 *   「少量の油をひいて、よく熱したフライパンに」
 *   「皮目を下にして押し付けるように焼く。」
 * 結果 app 顯示一堆殘句。
 *
 * 規則：一條步驟如果冇以終結標點收尾（。！？.!?:：）而且下一段存在，
 * 就同下一段合併；同時合併過短（< 6 字）嘅碎片。
 * 保留原有物件其他欄位（duration / tip 等），只改 instruction。
 */

const TERMINAL = /[。！？!?.…」』”"）)]$/;
const TOO_SHORT = 6;

type AnyStep = { instruction?: string; text?: string; [k: string]: unknown };

function textOf(step: AnyStep | string): string {
  if (typeof step === "string") return step;
  return String(step?.instruction ?? step?.text ?? "");
}

function withText(step: AnyStep | string, text: string): AnyStep | string {
  if (typeof step === "string") return text;
  if ("instruction" in step) return { ...step, instruction: text };
  return { ...step, text };
}

export function mergeDanglingSteps<T extends AnyStep | string>(steps: T[]): T[] {
  const input = (steps ?? []).filter((s) => textOf(s).trim().length > 0);
  const out: (AnyStep | string)[] = [];
  for (const raw of input) {
    const step = typeof raw === "string" ? raw.trim() : raw;
    const text = textOf(step).trim();
    if (out.length === 0) {
      out.push(typeof step === "string" ? text : withText(step, text));
      continue;
    }
    const prev = out[out.length - 1];
    const prevText = textOf(prev).trim();
    const prevDangling = !TERMINAL.test(prevText) || prevText.length < TOO_SHORT;
    if (prevDangling) {
      const joiner = /[\u3040-\u30ff\u4e00-\u9fff]$/.test(prevText) ? "" : " ";
      out[out.length - 1] = withText(prev, `${prevText}${joiner}${text}`.trim());
    } else {
      out.push(typeof step === "string" ? text : withText(step, text));
    }
  }
  return out as T[];
}
