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

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // AI Chef SSE streaming endpoint
  app.post("/api/ai-chef/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const { messages = [], familyId, userId } = req.body || {};
    if (!messages.length) {
      res.write("event: error\ndata: {\"message\":\"No messages\"}\n\n");
      res.end();
      return;
    }

    try {
      const { streamAIChefChat } = await import("./routers/aiRecipe");
      for await (const event of streamAIChefChat(messages, familyId, userId)) {
        if (event.type === "text") {
          res.write(`event: text\ndata: ${JSON.stringify({ token: event.value })}\n\n`);
        } else if (event.type === "recipes") {
          res.write(`event: recipes\ndata: ${JSON.stringify(event.value)}\n\n`);
        } else if (event.type === "done") {
          res.write("event: done\ndata: {}\n\n");
        }
      }
    } catch (err) {
      console.log("[AIChef] SSE error:", err);
      res.write("event: error\ndata: {\"message\":\"Server error\"}\n\n");
    }
    res.end();
  });

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
  });
}

startServer().catch(console.error);
