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

/**
 * Send the 6-digit email verification code (bilingual zh + en).
 */
export async function sendVerificationEmail(params: { email: string; name?: string | null; code: string }) {
  if (!ENV.resendApiKey) {
    if (!ENV.isProduction) {
      console.log("[VerificationEmail][DEV]", params.email, "code:", params.code);
      return;
    }
    throw new Error("RESEND_API_KEY is not configured");
  }

  const displayName = params.name?.trim() || "Kindcipe 用戶";
  const subject = `Kindcipe 驗證碼 ${params.code} · Verify your email`;
  const text = [
    `你好 ${displayName} / Hi ${displayName},`,
    "",
    `你的 Kindcipe 驗證碼是：${params.code}`,
    `Your Kindcipe verification code is: ${params.code}`,
    "",
    "此驗證碼 10 分鐘內有效。",
    "This code is valid for 10 minutes.",
    "",
    "如果不是你本人操作，可以忽略此電郵。",
    "If you didn't request this, you can ignore this email.",
  ].join("\n");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,PingFang HK,Microsoft JhengHei,sans-serif;background:#FAF8F5;padding:32px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:28px">
      <h1 style="margin:0 0 8px;color:#013E77;font-size:22px">Kindcipe</h1>
      <p style="margin:0 0 20px;color:#6B7280;font-size:14px">驗證你的電郵 · Verify your email</p>
      <p style="margin:0 0 8px;color:#1F2937;font-size:15px">你的驗證碼 / Your code:</p>
      <p style="margin:0 0 20px;font-size:34px;font-weight:800;letter-spacing:8px;color:#013E77">${params.code}</p>
      <p style="margin:0;color:#6B7280;font-size:13px">10 分鐘內有效 · Valid for 10 minutes</p>
    </div>
    <p style="text-align:center;color:#9CA3AF;font-size:12px;margin-top:20px">© Kindcipe · https://kindcipe.com</p>
  </div>`;

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
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to send verification email: ${response.status} ${detail}`);
  }
}
