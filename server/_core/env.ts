export const ENV = {
  // App
  appId: process.env.APP_ID ?? "kindcipe",
  cookieSecret: process.env.JWT_SECRET ?? "",
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

  // Google Vertex AI (replaces GEMINI_API_KEY)
  gcpProjectId: process.env.GCP_PROJECT_ID ?? "",
  gcpLocation: process.env.GCP_LOCATION ?? "asia-east2",
  gcpServiceAccountJson: process.env.GCP_SERVICE_ACCOUNT_JSON ?? "",

  // External APIs
  rapidApiKey: process.env.RAPIDAPI_KEY ?? "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",

  // Expo Push Notifications
  expoPushToken: process.env.EXPO_PUSH_TOKEN ?? "",

  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "",
  frontendUrl: process.env.FRONTEND_URL ?? "",
};
