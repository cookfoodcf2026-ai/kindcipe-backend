import "dotenv/config";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerSocialAuthRoutes } from "./auth";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Railway (and most hosts) sit behind a proxy — needed for correct client IPs.
  app.set("trust proxy", 1);

  // CORS — the app is a native client (no Origin header). Browsers are blocked
  // unless explicitly listed in ALLOWED_ORIGINS (localhost dev is always allowed).
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((o) => Boolean(o) && o !== "*")
  );
  const localOriginPatterns = [
    /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/,
    /^exp:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/,
    /^https?:\/\/192\.168\.\d+\.\d+(?::\d+)?$/,
    /^exp:\/\/192\.168\.\d+\.\d+(?::\d+)?$/,
    /^https?:\/\/10\.0\.2\.2(?::\d+)?$/,
    /^exp:\/\/10\.0\.2\.2(?::\d+)?$/,
  ];
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin) || localOriginPatterns.some((pattern) => pattern.test(origin))) {
          return callback(null, true);
        }
        return callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    })
  );

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Global safety net for the whole API.
  const globalLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { json: { message: "請求太頻繁，請稍後再試。" } } },
  });
  // AI endpoints are long-running + costly → much stricter.
  const aiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { json: { message: "AI 請求太頻繁，請稍後再試。" } } },
  });
  app.use("/api", globalLimiter);
  app.use("/api/v1/trpc/aiRecipe", aiLimiter);
  app.use("/api/trpc/aiRecipe", aiLimiter);
  app.use("/api/v1/trpc/recipes.parse", aiLimiter);
  app.use("/api/trpc/recipes.parse", aiLimiter);

  // Body parser (10MB is plenty; images are uploaded via R2, not inline)
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // Social auth routes (Google, Apple)
  registerSocialAuthRoutes(app);

  // tRPC API — mounted on both the versioned path (/api/v1/trpc) and the
  // legacy path (/api/trpc) so already-shipped clients keep working.
  const trpcMiddleware = createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ error, path, type, ctx }) => {
      const userId = ctx?.user?.id ?? "anon";
      const familyId = ctx?.activeFamilyId ?? "-";
      console.error(`[tRPC] ${type} ${path} user=${userId} family=${familyId} code=${error.code}\n  message: ${error.message}`);
    },
  });
  app.use("/api/v1/trpc", trpcMiddleware);
  app.use("/api/trpc", trpcMiddleware);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // AI Chef SSE streaming endpoint (removed: unused by frontend & had an
  // unauthenticated familyId/userId trust issue — the tRPC aiRecipe.chat
  // procedure is the secure path)

  // R2 storage proxy — serve images stored in R2 via signed URLs
  app.get("/r2-storage/:key(*)", async (req, res) => {
    try {
      const { storageGet } = await import("./storage");
      const { url } = await storageGet(req.params.key);
      // Redirect to signed URL
      res.redirect(302, url);
    } catch {
      res.status(404).send("Not found");
    }
  });

  const port = parseInt(process.env.PORT ?? "3000");

  server.listen(port, "0.0.0.0", () => {
    console.log(`Kindcipe backend running on http://0.0.0.0:${port}/`);

    // Warmup DB connection to prevent cold-start delay on first query
    (async () => {
      try {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (db) {
          await db.execute("SELECT 1" as any);
          console.log("DB warmup query completed");
        }
      } catch (e) {
        console.warn("DB warmup failed (non-fatal):", (e as Error).message);
      }
    })();

    // Startup integrity check: flag official recipes that are missing a
    // thumbnail URL so blank cover images can NEVER silently recur.
    (async () => {
      try {
        const { getDb } = await import("./db");
        const { officialRecipes } = await import("../drizzle/schema");
        const { or, isNull, eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return;
        const rows = await db
          .select({ id: officialRecipes.id, name: officialRecipes.name })
          .from(officialRecipes)
          .where(
            or(
              isNull(officialRecipes.thumbnailUrl),
              eq(officialRecipes.thumbnailUrl, "")
            )
          )
          .limit(50);
        if (rows.length > 0) {
          console.warn(
            `[Integrity] ⚠️ ${rows.length}+ official recipes missing thumbnailUrl. ` +
              `Run scripts/upload-recipe-images.ts to backfill.\n` +
              rows.map((r) => `  - id=${r.id} ${r.name}`).join("\n")
          );
        } else {
          console.log("[Integrity] ✅ all official recipes have thumbnailUrl");
        }
      } catch (e) {
        console.warn("[Integrity] check failed (non-fatal):", (e as Error).message);
      }
    })();

    // Periodic self-heal: scan for "一欄多樣" ingredients that may have crept in
    // and split + recategorize them. Runs every 6h. Prevents multi-name recurrence.
    const SELF_HEAL_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const selfHeal = async () => {
      try {
        const { getDb } = await import("./db");
        const { sql } = await import("drizzle-orm");
        const { normalizeRecipeIngredients } = await import("./utils/ingredientNormalize");
        const db = await getDb();
        if (!db) return;
        let fixed = 0;
        for (const table of ["official_recipes", "custom_recipes"] as const) {
          const rows = await db.execute(sql`select id, name, ingredients from ${sql.raw(table)}`);
          const list = (rows as any)?.rows ?? (rows as any) ?? [];
          for (const row of list) {
            if (!row.ingredients) continue;
            let parsed: any;
            try { parsed = JSON.parse(row.ingredients); } catch { continue; }
            if (!Array.isArray(parsed)) continue;
            const normalized = normalizeRecipeIngredients(parsed);
            if (JSON.stringify(normalized) === JSON.stringify(parsed)) continue;
            await db.execute(sql`update ${sql.raw(table)} set ingredients = ${JSON.stringify(normalized)} where id = ${row.id}`);
            fixed++;
          }
        }
        if (fixed > 0) console.log(`[SelfHeal] fixed ${fixed} recipes with multi-name ingredients`);
      } catch (e) {
        console.warn("[SelfHeal] failed (non-fatal):", (e as Error).message);
      }
    };
    setInterval(selfHeal, SELF_HEAL_INTERVAL_MS);
    setTimeout(selfHeal, 60_000); // 首次啟動 1 分鐘後跑一次
  });
}

startServer().catch(console.error);
