import { ENV } from "./env";

export async function sendPasswordResetEmail(params: { email: string; name?: string | null; resetLink: string }) {
  if (!ENV.resendApiKey) {
    if (!ENV.isProduction) {
      console.log("[PasswordResetEmail][DEV]", params.email, params.resetLink);
      return;
    }
    throw new Error("RESEND_API_KEY is not configured");
  }

  const displayName = params.name?.trim() || "Kindcipe 用戶";
  const subject = "重設你的 Kindcipe 密碼";
  const text = [
    `你好 ${displayName},`,
    "",
    "我們收到重設密碼請求。",
    `請於 15 分鐘內打開以下連結：${params.resetLink}`,
    "",
    "如果不是你本人操作，可以忽略此電郵。",
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.resendApiKey}`,
    },
    body: JSON.stringify({
      from: ENV.resendFromEmail,
      to: params.email,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to send reset email: ${response.status} ${detail}`);
  }
}
