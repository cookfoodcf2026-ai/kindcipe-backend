/**
 * Backend user-facing message catalog (push notifications + emails).
 *
 * Backend must NEVER send Chinese to a non-Chinese recipient. Resolve strings
 * with msg(lang, key, vars). lang comes from the recipient's stored language
 * (users.language / families.language), falling back to zh-TW.
 */
export type Lang = "zh-TW" | "en" | "fil" | "id";

export function normalizeLang(l?: string | null): Lang {
  const s = String(l ?? "").toLowerCase();
  if (s.startsWith("fil") || s.startsWith("tl")) return "fil";
  if (s.startsWith("id") || s.startsWith("in")) return "id";
  if (s.startsWith("en")) return "en";
  return "zh-TW";
}

const M: Record<string, Record<Lang, string>> = {
  // ── Emails ──
  "email.reset.subject": { "zh-TW": "重設你的 Kindcipe 密碼", en: "Reset your Kindcipe password", fil: "I-reset ang password ng Kindcipe", id: "Atur ulang kata sandi Kindcipe" },
  "email.reset.greeting": { "zh-TW": "你好 {{name}},", en: "Hi {{name}},", fil: "Kumusta {{name}},", id: "Halo {{name}}," },
  "email.reset.received": { "zh-TW": "我們收到重設密碼請求。", en: "We received a request to reset your password.", fil: "Nakatanggap kami ng kahilingan na i-reset ang password mo.", id: "Kami menerima permintaan mengatur ulang kata sandi." },
  "email.reset.link": { "zh-TW": "請於 15 分鐘內打開以下連結：{{link}}", en: "Open the link below within 15 minutes: {{link}}", fil: "Buksan ang link sa loob ng 15 minuto: {{link}}", id: "Buka tautan berikut dalam 15 menit: {{link}}" },
  "email.reset.ignore": { "zh-TW": "如果不是你本人操作，可以忽略此電郵。", en: "If you didn't request this, you can ignore this email.", fil: "Kung hindi ikaw ang humiling, balewalain ang email na ito.", id: "Jika bukan Anda, abaikan email ini." },
  "email.verify.subject": { "zh-TW": "Kindcipe 驗證碼 {{code}}", en: "Kindcipe verification code {{code}}", fil: "Kindcipe verification code {{code}}", id: "Kode verifikasi Kindcipe {{code}}" },
  "email.verify.greeting": { "zh-TW": "你好 {{name}},", en: "Hi {{name}},", fil: "Kumusta {{name}},", id: "Halo {{name}}," },
  "email.verify.codeLine": { "zh-TW": "你的 Kindcipe 驗證碼是：{{code}}", en: "Your Kindcipe verification code is: {{code}}", fil: "Ang Kindcipe verification code mo ay: {{code}}", id: "Kode verifikasi Kindcipe Anda: {{code}}" },
  "email.verify.valid": { "zh-TW": "此驗證碼 10 分鐘內有效。", en: "This code is valid for 10 minutes.", fil: "Valid ang code na ito sa loob ng 10 minuto.", id: "Kode ini berlaku selama 10 menit." },
  "email.verify.ignore": { "zh-TW": "如果不是你本人操作，可以忽略此電郵。", en: "If you didn't request this, you can ignore this email.", fil: "Kung hindi ikaw ang humiling, balewalain ang email na ito.", id: "Jika bukan Anda, abaikan email ini." },
  "email.verify.heading": { "zh-TW": "驗證你的電郵", en: "Verify your email", fil: "I-verify ang iyong email", id: "Verifikasi email Anda" },
  "email.verify.codeLabel": { "zh-TW": "你的驗證碼", en: "Your code", fil: "Ang code mo", id: "Kode Anda" },
  "email.verify.validShort": { "zh-TW": "10 分鐘內有效", en: "Valid for 10 minutes", fil: "Valid sa loob ng 10 minuto", id: "Berlaku 10 menit" },

  // ── Push: shopping approval ──
  "push.shoppingApproved.title": { "zh-TW": "✅ 採購已批准", en: "✅ Purchase approved", fil: "✅ Naaprubahan ang pagbili", id: "✅ Pembelian disetujui" },
  "push.shoppingApproved.body": { "zh-TW": "已批准採購：{{name}}", en: "Purchase approved: {{name}}", fil: "Naaprubahan: {{name}}", id: "Disetujui: {{name}}" },
  "push.shoppingRejected.title": { "zh-TW": "❌ 採購未批准", en: "❌ Purchase not approved", fil: "❌ Hindi naaprubahan ang pagbili", id: "❌ Pembelian tidak disetujui" },
  "push.shoppingRejected.body": { "zh-TW": "未批准採購：{{name}}", en: "Purchase not approved: {{name}}", fil: "Hindi naaprubahan: {{name}}", id: "Tidak disetujui: {{name}}" },

  // ── Push: meal plan ──
  "push.mealProposed.title": { "zh-TW": "🍽️ {{actor}} 提議排餐", en: "🍽️ {{actor}} proposed a meal", fil: "🍽️ Nag-propose ng pagkain si {{actor}}", id: "🍽️ {{actor}} mengusulkan makan" },
  "push.mealProposed.body": { "zh-TW": "{{label}} · 等待確認", en: "{{label}} · awaiting approval", fil: "{{label}} · hinihintay ang approval", id: "{{label}} · menunggu persetujuan" },
  "push.mealUpdated.title": { "zh-TW": "📅 排餐已更新", en: "📅 Meal plan updated", fil: "📅 Na-update ang plano", id: "📅 Rencana diperbarui" },
  "push.mealBatchProposed.title": { "zh-TW": "🍽️ {{actor}} 提議 {{n}} 天排餐", en: "🍽️ {{actor}} proposed {{n}} days", fil: "🍽️ Nag-propose si {{actor}} ng {{n}} araw", id: "🍽️ {{actor}} mengusulkan {{n}} hari" },
  "push.mealBatchAdded.title": { "zh-TW": "📅 已排入 {{n}} 天晚餐", en: "📅 {{n}} dinners added", fil: "📅 Naidagdag ang {{n}} hapunan", id: "📅 {{n}} makan malam ditambahkan" },
  "push.mealAdded.title": { "zh-TW": "📅 已加入排餐", en: "📅 Added to meal plan", fil: "📅 Naidagdag sa plano", id: "📅 Ditambahkan ke rencana" },
  "push.mealType.breakfast": { "zh-TW": "早餐", en: "Breakfast", fil: "Almusal", id: "Sarapan" },
  "push.mealType.lunch": { "zh-TW": "午餐", en: "Lunch", fil: "Tanghalian", id: "Makan siang" },
  "push.mealType.dinner": { "zh-TW": "晚餐", en: "Dinner", fil: "Hapunan", id: "Makan malam" },
  "push.mealType.snack": { "zh-TW": "小食", en: "Snack", fil: "Meryenda", id: "Camilan" },

  // ── Push: recipe ──
  "push.newRecipe.title": { "zh-TW": "🍳 新食譜加入廚房", en: "🍳 New recipe added", fil: "🍳 Bagong recipe naidagdag", id: "🍳 Resep baru ditambahkan" },
  "push.newRecipe.body": { "zh-TW": "匯入了新食譜：{{name}}", en: "Imported a new recipe: {{name}}", fil: "Nag-import ng bagong recipe: {{name}}", id: "Mengimpor resep baru: {{name}}" },
};

export function msg(lang: string | null | undefined, key: string, vars?: Record<string, string | number>): string {
  const l = normalizeLang(lang);
  const row = M[key];
  let out = row ? (row[l] ?? row["zh-TW"]) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
  return out;
}
