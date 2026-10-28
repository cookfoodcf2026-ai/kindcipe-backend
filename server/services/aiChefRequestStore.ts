import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiChefRequests } from "../../drizzle/schema";
import type { ChefClaimResult, ChefRequestKey, ChefRequestStore } from "./aiChefLifecycle";
import type { IdempotencyCached } from "./aiChefIdempotency";

function whereKey(key: ChefRequestKey) {
  return and(
    eq(aiChefRequests.familyId, key.familyId),
    eq(aiChefRequests.chatId, key.chatId ?? ""),
    eq(aiChefRequests.clientMessageId, key.clientMessageId ?? ""),
  );
}

/** Production store backed by ai_chef_requests (0047). Only constructed when
 * AI_CHEF_CLIENT_MESSAGE_ID is ON, so flag OFF never touches the table. */
export function createAiChefRequestStore(userId: string): ChefRequestStore {
  return {
    async find(key) {
      const db = await getDb();
      if (!db) return undefined;
      const [row] = await db.select({
        payloadHash: aiChefRequests.payloadHash,
        responseJson: aiChefRequests.responseJson,
      }).from(aiChefRequests).where(whereKey(key)).limit(1);
      if (!row?.responseJson) return undefined;
      return { payloadHash: row.payloadHash, response: row.responseJson };
    },

    async claim(key, payloadHash): Promise<ChefClaimResult> {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable for AI Chef idempotency");
      const [inserted] = await db.insert(aiChefRequests).values({
        familyId: key.familyId,
        userId,
        chatId: key.chatId ?? "",
        clientMessageId: key.clientMessageId ?? "",
        payloadHash,
        status: "pending",
        requestedTotal: 0,
        served: 0,
        llmCalls: 0,
        costMicros: 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).onConflictDoNothing().returning({ id: aiChefRequests.id });

      if (inserted) return { decision: "claimed" };

      const [row] = await db.select({
        payloadHash: aiChefRequests.payloadHash,
        responseJson: aiChefRequests.responseJson,
      }).from(aiChefRequests).where(whereKey(key)).limit(1);
      if (!row || row.payloadHash !== payloadHash) return { decision: "conflict" };
      if (row.responseJson) {
        const cached: IdempotencyCached = { payloadHash, response: row.responseJson };
        return { decision: "reuse", cached };
      }
      return { decision: "conflict" };
    },

    async save(key, value) {
      const db = await getDb();
      if (!db) return;
      const response = value.response as {
        served?: number;
        requested?: { total?: number };
        llmCalls?: number;
      } | null;
      await db.update(aiChefRequests).set({
        status: "completed",
        responseJson: value.response as any,
        requestedTotal: response?.requested?.total ?? 0,
        served: response?.served ?? 0,
        llmCalls: response?.llmCalls ?? 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).where(whereKey(key));
    },

    async release(key) {
      const db = await getDb();
      if (!db) return;
      await db.delete(aiChefRequests).where(and(whereKey(key), eq(aiChefRequests.status, "pending")));
    },
  };
}
