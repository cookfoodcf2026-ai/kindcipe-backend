import "dotenv/config";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerSocialAuthRoutes } from "./auth";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // CORS — allow requests from the mobile app and web
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    })
  );

  // Body parser with larger size limit for image uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Social auth routes (Google, Apple)
  registerSocialAuthRoutes(app);

  // tRPC API — mounted on both the versioned path (/api/v1/trpc) and the
  // legacy path (/api/trpc) so already-shipped clients keep working.
  const trpcMiddleware = createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ error, path, input, type, ctx }) => {
      const userId = ctx?.user?.id ?? "anon";
      const familyId = ctx?.activeFamilyId ?? "-";
      const safeInput = (() => {
        try {
          if (typeof input !== "object" || input === null) return input;
          const s = JSON.stringify(input);
          return s && s.length > 2000 ? `${s.slice(0, 2000)}…(truncated)` : s;
        } catch {
          return "[unserializable]";
        }
      })();
      console.error(`[tRPC] ${type} ${path} user=${userId} family=${familyId} code=${error.code}\n  message: ${error.message}\n  input: ${safeInput}`);
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

  server.listen(port, () => {
    console.log(`Kindcipe backend running on http://localhost:${port}/`);

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
  });
}

startServer().catch(console.error);
