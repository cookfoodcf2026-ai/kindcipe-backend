/**
 * AI 圖像生成（fallback 用）——當抓唔到真圖時，按菜名生成一張貼題圖片。
 * 用阿里雲 DashScope 圖像生成（非同步任務），成功後存上 R2 並回傳公開 URL。
 * 任何失敗都 return null（交由 caller 用中性佔位圖）。
 */
import { ENV } from "../_core/env";
import { storagePut } from "../storage";

const ORIGIN = (() => {
  try { return new URL(ENV.dashScopeBaseUrl).origin; } catch { return "https://dashscope-intl.aliyuncs.com"; }
})();
const API = `${ORIGIN}/api/v1`;
const MODEL = process.env.DASHSCOPE_IMAGE_MODEL ?? "";

export async function generateRecipeImage(recipeName: string): Promise<string | null> {
  const name = String(recipeName || "").trim();
  // Opt-in：只有設定好 DASHSCOPE_IMAGE_MODEL 才嘗試（避免無配置時白費 request）
  if (!name || !ENV.dashScopeApiKey || !MODEL) return null;
  try {
    const prompt = `A delicious, appetizing food photo of "${name}", Hong Kong home-cooking style, natural daylight, top-down, high detail, realistic`;
    const submit = await fetch(`${API}/services/aigc/text2image/image-synthesis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.dashScopeApiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: MODEL,
        input: { prompt },
        parameters: { size: "1024*1024", n: 1 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!submit.ok) {
      console.warn("[imageGen] submit failed:", submit.status, (await submit.text()).slice(0, 200));
      return null;
    }
    const submitJson = (await submit.json()) as { output?: { task_id?: string } };
    const taskId = submitJson?.output?.task_id;
    if (!taskId) return null;

    // Poll (max ~40s)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const q = await fetch(`${API}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${ENV.dashScopeApiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!q.ok) continue;
      const qj = (await q.json()) as any;
      const status = qj?.output?.task_status;
      if (status === "SUCCEEDED") {
        const url = qj?.output?.results?.[0]?.url;
        if (!url) return null;
        const imgResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!imgResp.ok) return null;
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const contentType = imgResp.headers.get("content-type") || "image/png";
        const { url: stored } = await storagePut(`recipe-ai/covers/ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`, buf, contentType);
        return stored;
      }
      if (status === "FAILED" || status === "UNKNOWN") return null;
    }
    return null;
  } catch (e) {
    console.warn("[imageGen] failed:", (e as Error)?.message);
    return null;
  }
}
