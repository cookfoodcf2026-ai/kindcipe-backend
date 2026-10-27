function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const cookieSecret = process.env.JWT_SECRET ?? "";
if (process.env.NODE_ENV === "production" && cookieSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}

export const ENV = {
  // App
  appId: process.env.APP_ID ?? "kindcipe",
  cookieSecret,
  isProduction: process.env.NODE_ENV === "production",

  // Database (Supabase PostgreSQL)
  databaseUrl: process.env.DATABASE_URL ?? "",

  // Auth (not used in self-hosted, kept for compatibility)
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",

  // Cloudflare R2 Storage
  r2AccountId: process.env.R2_ACCOUNT_ID ?? "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  r2BucketName: process.env.R2_BUCKET_NAME ?? "",
  r2PublicUrl: process.env.R2_PUBLIC_URL ?? "",

  // Alibaba Cloud DashScope (Qwen LLM)
  dashScopeApiKey: process.env.DASHSCOPE_API_KEY ?? "",
  dashScopeBaseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",

  // External APIs
  rapidApiKey: process.env.RAPIDAPI_KEY ?? "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "Kindcipe <onboarding@resend.dev>",

  // Beta: treat every household as a paid (Pro) subscriber, with generous limits.
  // Unset before the public launch to restore normal free/trial gating.
  betaAllPaid: process.env.BETA_ALL_PAID === "true",

  // Expo Push Notifications
  expoPushToken: process.env.EXPO_PUSH_TOKEN ?? "",

  // Sign in with Apple — Web/Android OAuth (Services ID + Key)
  appleTeamId: process.env.APPLE_TEAM_ID ?? "",
  appleKeyId: process.env.APPLE_KEY_ID ?? "",
  appleServicesId: process.env.APPLE_SERVICES_ID ?? "",
  applePrivateKey: process.env.APPLE_PRIVATE_KEY ?? "",
  appleWebRedirectUri: process.env.APPLE_WEB_REDIRECT_URI ?? "",

  // Stripe (web billing)
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
  stripePriceYearly: process.env.STRIPE_PRICE_YEARLY ?? "",
  stripePriceMonthlyPromo: process.env.STRIPE_PRICE_MONTHLY_PROMO ?? "",
  stripePriceYearlyPromo: process.env.STRIPE_PRICE_YEARLY_PROMO ?? "",
  stripeSuccessUrl: process.env.STRIPE_SUCCESS_URL ?? "",
  stripeCancelUrl: process.env.STRIPE_CANCEL_URL ?? "",

  // Trial-first Instagram promo (C9T) + first-100 founding members.
  earlybirdPromoActive: process.env.EARLYBIRD_PROMO_ACTIVE === "true",
  earlybirdCap: positiveInt(process.env.EARLYBIRD_CAP, 100),
  earlybirdWindowDays: positiveInt(process.env.EARLYBIRD_WINDOW_DAYS, 7),

  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "",
  frontendUrl: process.env.FRONTEND_URL ?? "",

  // Observability (optional — Sentry disabled when DSN is empty)
  sentryDsn: process.env.SENTRY_DSN ?? "",

  // AI cost guardrails. Daily token budget for the whole backend (0 = unlimited).
  // When exceeded, LLM calls fail closed until midnight UTC — protects against a
  // quota-logic bug or abuse turning into an unbounded DashScope bill.
  llmDailyTokenBudget: Number(process.env.LLM_DAILY_TOKEN_BUDGET ?? 0),
};
