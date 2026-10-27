import { and, eq, inArray } from "drizzle-orm";
import { getDb, getFamilyMembers, getFamilySubscription, getPushTokensByUserIds } from "../db";
import { billingReminders, families } from "../../drizzle/schema";
import { sendTransactionalEmail } from "../_core/email";
import { sendPushNotifications } from "../pushNotification";

const DAY_MS = 24 * 60 * 60 * 1000;
const MANAGE_URL = "https://app.kindcipe.com/settings";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function runBillingReminders(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ id: families.id })
    .from(families)
    .where(inArray(families.subscriptionStatus, ["trial", "active"]));

  let sent = 0;
  const now = new Date();
  for (const row of rows) {
    const sub = await getFamilySubscription(row.id);
    if (!sub) continue;
    const isTrial = sub.status === "trial";
    const trialAutoConverts = isTrial && Boolean(sub.subscriptionPlan);
    const periodEnd = isTrial ? sub.trialEndsAt : sub.subscriptionExpiresAt;
    if (!periodEnd) continue;
    const daysLeft = Math.ceil((new Date(periodEnd).getTime() - now.getTime()) / DAY_MS);
    const threshold = isTrial ? 3 : 7;
    if (daysLeft < 0 || daysLeft > threshold) continue;
    const kind = isTrial ? "trial" : "renewal";
    const [claimed] = await db
      .insert(billingReminders)
      .values({
        familyId: row.id,
        kind,
        periodEnd: new Date(periodEnd),
        channel: "email",
      })
      .onConflictDoNothing()
      .returning({ id: billingReminders.id });
    if (!claimed) continue;

    const members = await getFamilyMembers(row.id);
    const recipients = members.filter(
      (m) => m.member.familyRole === "owner" || m.member.familyRole === "admin"
    );
    const dateLabel = formatDate(new Date(periodEnd));
    let delivered = 0;
    for (const recipient of recipients) {
      const lang = recipient.user.language ?? "zh-TW";
      const isZh = lang.startsWith("zh");
      const subject = isTrial
        ? isZh
          ? `Kindcipe Pro 試用將於 ${dateLabel} 結束`
          : `Your Kindcipe Pro trial ends on ${dateLabel}`
        : isZh
          ? `Kindcipe Pro 將於 ${dateLabel} 續訂`
          : `Your Kindcipe Pro renews on ${dateLabel}`;
      const text = isTrial
        ? isZh
          ? trialAutoConverts
            ? `你好 ${recipient.user.name ?? ""}，\n\n你的 Kindcipe Pro 試用將於 ${dateLabel} 結束，之後會自動開始付費訂閱。如不想續訂，請於到期前到「管理訂閱」取消。\n\n管理訂閱：${MANAGE_URL}`
            : `你好 ${recipient.user.name ?? ""}，\n\n你的 Kindcipe Pro 試用將於 ${dateLabel} 結束。試用完結後會自動變回免費方案。\n\n管理訂閱：${MANAGE_URL}`
          : trialAutoConverts
            ? `Hi ${recipient.user.name ?? ""},\n\nYour Kindcipe Pro trial ends on ${dateLabel} and your paid subscription will start automatically. To stop it, cancel in Manage subscription before that date.\n\nManage subscription: ${MANAGE_URL}`
            : `Hi ${recipient.user.name ?? ""},\n\nYour Kindcipe Pro trial ends on ${dateLabel}. After that the kitchen returns to the free plan.\n\nManage subscription: ${MANAGE_URL}`
        : isZh
          ? `你好 ${recipient.user.name ?? ""}，\n\n你的 Kindcipe Pro 將於 ${dateLabel} 自動續訂。如不想續訂，請於到期前到「管理訂閱」取消。\n\n管理訂閱：${MANAGE_URL}`
          : `Hi ${recipient.user.name ?? ""},\n\nYour Kindcipe Pro renews automatically on ${dateLabel}. To stop it, cancel in Manage subscription before that date.\n\nManage subscription: ${MANAGE_URL}`;
      if (recipient.user.email) {
        try {
          await sendTransactionalEmail({ email: recipient.user.email, subject, text });
          delivered++;
        } catch (error) {
          console.warn("[billingReminders] email failed", row.id, (error as Error).message);
        }
      }
    }
    const tokens = await getPushTokensByUserIds(recipients.map((r) => r.user.id));
    if (tokens.length > 0) {
      const isZh = (recipients[0]?.user.language ?? "zh-TW").startsWith("zh");
      await sendPushNotifications(tokens, {
        title: isTrial
          ? isZh ? "Pro 試用即將結束" : "Your Pro trial is ending"
          : isZh ? "Pro 即將續訂" : "Pro renewal upcoming",
        body: isTrial
          ? isZh ? `試用將於 ${dateLabel} 結束` : `Trial ends on ${dateLabel}`
          : isZh ? `訂閱將於 ${dateLabel} 續訂` : `Renews on ${dateLabel}`,
        data: { type: "billing_reminder", kind, date: dateLabel },
      }).catch(() => {});
      delivered++;
    }
    if (delivered === 0) {
      await db.delete(billingReminders).where(eq(billingReminders.id, claimed.id));
      continue;
    }
    sent++;
  }
  return sent;
}
