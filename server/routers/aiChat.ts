import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { aiChatSessions, aiChefRequests, chefQueryLog } from "../../drizzle/schema";

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

export function createAiChatRouter(getDbProvider: typeof getDb = getDb) {
  const requireDb = async () => {
    const db = await getDbProvider();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db;
  };

  return router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDbProvider();
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
        const db = await getDbProvider();
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

    /** Privacy: delete one chat session, but only when the caller owns it. */
    deleteSession: protectedProcedure
      .input(z.object({ id: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const deleted = await db
          .delete(aiChatSessions)
          .where(and(eq(aiChatSessions.id, input.id), eq(aiChatSessions.userId, ctx.user.id)))
          .returning({ id: aiChatSessions.id });
        return { success: true as const, deleted: deleted.length };
      }),

    /** Privacy: delete every chat session and scrub the caller's stored text. */
    clearHistory: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await requireDb();
      const userId = String(ctx.user.id);
      const deleted = await db
        .delete(aiChatSessions)
        .where(eq(aiChatSessions.userId, ctx.user.id))
        .returning({ id: aiChatSessions.id });
      // Keep the audit/billing rows, but remove the conversation text they carry.
      await db
        .update(chefQueryLog)
        .set({ rawText: null })
        .where(eq(chefQueryLog.userId, userId));
      await db
        .update(aiChefRequests)
        .set({ responseJson: null })
        .where(eq(aiChefRequests.userId, userId));
      return { success: true as const, deleted: deleted.length };
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
        const db = await getDbProvider();
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
}

export const aiChatRouter = createAiChatRouter();

function safeParse(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
