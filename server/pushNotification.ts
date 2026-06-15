/**
 * Expo Push Notification helper
 * Uses Expo's free push notification service — no API key required.
 * Tokens are in the format: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

/**
 * Send push notifications to one or more Expo push tokens.
 * Silently ignores errors so it never blocks the main flow.
 */
export async function sendPushNotifications(
  tokens: string[],
  message: PushMessage
): Promise<void> {
  if (!tokens || tokens.length === 0) return;

  // Filter valid Expo push tokens
  const validTokens = tokens.filter(
    (t) => t && (t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["))
  );
  if (validTokens.length === 0) return;

  const messages = validTokens.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    sound: message.sound ?? "default",
    badge: message.badge,
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.warn("[Push] Expo push failed:", res.status, await res.text());
    }
  } catch (err) {
    console.warn("[Push] Failed to send push notification:", err);
  }
}
