import { ENV } from "./env";
import { msg, normalizeLang } from "./msg";

export async function sendPasswordResetEmail(params: { email: string; name?: string | null; resetLink: string; lang?: string | null }) {
  if (!ENV.resendApiKey) {
    if (!ENV.isProduction) {
      console.log("[PasswordResetEmail][DEV]", params.email, params.resetLink);
      return;
    }
    throw new Error("RESEND_API_KEY is not configured");
  }

  const lang = normalizeLang(params.lang);
  const displayName = params.name?.trim() || (lang === "zh-TW" ? "Kindcipe 用戶" : "Kindcipe user");
  const subject = msg(lang, "email.reset.subject");
  const text = [
    msg(lang, "email.reset.greeting", { name: displayName }),
    "",
    msg(lang, "email.reset.received"),
    msg(lang, "email.reset.link", { link: params.resetLink }),
    "",
    msg(lang, "email.reset.ignore"),
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
 *
 * If RESEND_API_KEY is not configured the code is written to the server logs
 * instead of failing — so a Beta household can still be verified manually from
 * the Railway logs. Configure Resend before the public launch.
 */
export async function sendVerificationEmail(params: { email: string; name?: string | null; code: string; lang?: string | null }) {
  if (!ENV.resendApiKey) {
    console.warn(`[VerificationEmail] RESEND_API_KEY missing — code for ${params.email}: ${params.code}`);
    return;
  }

  const lang = normalizeLang(params.lang);
  const displayName = params.name?.trim() || (lang === "zh-TW" ? "Kindcipe 用戶" : "Kindcipe user");
  const subject = msg(lang, "email.verify.subject", { code: params.code });
  const text = [
    msg(lang, "email.verify.greeting", { name: displayName }),
    "",
    msg(lang, "email.verify.codeLine", { code: params.code }),
    "",
    msg(lang, "email.verify.valid"),
    "",
    msg(lang, "email.verify.ignore"),
  ].join("\n");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,PingFang HK,Microsoft JhengHei,sans-serif;background:#FAF8F5;padding:32px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:28px">
      <h1 style="margin:0 0 8px;color:#013E77;font-size:22px">Kindcipe</h1>
      <p style="margin:0 0 20px;color:#6B7280;font-size:14px">${msg(lang, "email.verify.heading")}</p>
      <p style="margin:0 0 8px;color:#1F2937;font-size:15px">${msg(lang, "email.verify.codeLabel")}:</p>
      <p style="margin:0 0 20px;font-size:34px;font-weight:800;letter-spacing:8px;color:#013E77">${params.code}</p>
      <p style="margin:0;color:#6B7280;font-size:13px">${msg(lang, "email.verify.validShort")}</p>
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

export async function sendTransactionalEmail(params: {
  email: string;
  subject: string;
  text: string;
  html?: string;
}) {
  if (!ENV.resendApiKey) {
    if (!ENV.isProduction) {
      console.log("[TransactionalEmail][DEV]", params.email, params.subject);
      return;
    }
    throw new Error("RESEND_API_KEY is not configured");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.resendApiKey}`,
    },
    body: JSON.stringify({
      from: ENV.resendFromEmail,
      to: params.email,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to send email: ${response.status} ${detail}`);
  }
}
