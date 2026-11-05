import type { ChefIntent } from "./chefIntent";

/**
 * 契約嘅單一真相來源。
 *
 * 點解需要：`intent.requested.total` 係分類器嘅原始輸出，唔一定等於「用戶要求幾多張卡」。
 * 例：一句「我想食魚」分類器可能填 total=3（因為內部預設 3 餸），
 * 但產品規則係「一句話 = 1 張卡」。之前用 output 層強改 total 去迎合 validator，
 * 結果連「分類器出錯」嘅訊號都改走埋。
 *
 * 正確做法：原值保留（intentTotal），另外計 requiredCards，validation 只認 requiredCards。
 */
export type ChefContractSource = "intent" | "policy";

export type ChefContract = {
  /** 驗證（served 要等於幾多）同 status 判斷都用呢個 */
  requiredCards: number;
  /** 分類器原始輸出，只作 observability，唔參與驗證 */
  intentTotal: number;
  source: ChefContractSource;
  /** intentTotal 同 requiredCards 唔一致 = 分類器同產品規則有落差 */
  mismatch: boolean;
};

export function resolveChefContract(intent: ChefIntent | undefined | null): ChefContract {
  const total = Number(intent?.requested?.total ?? 0);
  const intentTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;

  // 產品規則：只有 meal 意圖可以要求多過一張卡；其餘一律 1 張。
  const requiredCards = intent?.kind === "meal" ? Math.max(1, intentTotal || 1) : 1;

  return {
    requiredCards,
    intentTotal,
    source: intent?.kind === "meal" ? "intent" : "policy",
    mismatch: intentTotal > 0 && intentTotal !== requiredCards,
  };
}
