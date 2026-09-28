import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { aiChatSessions } from "../../drizzle/schema";

/**
 * AI Chef chat sessions — cloud-synced so the same conversation history is
 * available on both the native app and the web app (previously device-local
 * AsyncStorage only).
 */
const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  // string (legacy) or array of content blocks ({ type: "text" | "image_url" })
  content: z.union([z.string(), z.array(z.any())]),
});

export const aiChatRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(aiChatSessions)
      .where(eq(aiChatSessions.userId, ctx.user.id))
      .orderBy(desc(aiChatSessions.updatedAt));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      messages: safeParse(r.messages),
    }));
  }),

  upsert: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().min(1).max(128).default("新對話"),
        createdAt: z.number().optional(),
        messages: z.array(messageSchema).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { ok: false as const };
      const payload = JSON.stringify(input.messages ?? []);
      const now = new Date();
      await db
        .insert(aiChatSessions)
        .values({
          id: input.id,
          userId: ctx.user.id,
          title: input.title,
          messages: payload,
          createdAt: input.createdAt ? new Date(input.createdAt) : now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: aiChatSessions.id,
          set: { title: input.title, messages: payload, updatedAt: now },
          // Only update rows owned by this user (guards against ID collisions).
          where: eq(aiChatSessions.userId, ctx.user.id),
        });
      return { ok: true as const, updatedAt: now.getTime() };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { ok: false as const };
      await db
        .delete(aiChatSessions)
        .where(and(eq(aiChatSessions.id, input.id), eq(aiChatSessions.userId, ctx.user.id)));
      return { ok: true as const };
    }),

  /** Bulk-replace local sessions during first-time migration to the cloud. */
  bulkImport: protectedProcedure
    .input(
      z.object({
        sessions: z
          .array(
            z.object({
              id: z.string().min(1).max(64),
              title: z.string().min(1).max(128).default("新對話"),
              createdAt: z.number().optional(),
              messages: z.array(messageSchema).max(500),
            })
          )
          .max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { ok: false as const, imported: 0 };
      if (input.sessions.length === 0) return { ok: true as const, imported: 0 };
      const now = new Date();
      await db.insert(aiChatSessions).values(
        input.sessions.map((s) => ({
          id: s.id,
          userId: ctx.user.id,
          title: s.title,
          messages: JSON.stringify(s.messages ?? []),
          createdAt: s.createdAt ? new Date(s.createdAt) : now,
          updatedAt: now,
        }))
      );
      return { ok: true as const, imported: input.sessions.length };
    }),
});

function safeParse(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
