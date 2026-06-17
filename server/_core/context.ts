import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getDb } from "../db";
import { and, eq } from "drizzle-orm";
import { familyMembers } from "../../drizzle/schema";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  activeFamilyId: number | null;
  activeFamilyRole: "owner" | "admin" | "helper" | "member" | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }

  let activeFamilyId: number | null = null;
  let activeFamilyRole: "owner" | "admin" | "helper" | "member" | null = null;

  if (user) {
    const headerFamilyId = opts.req.headers["x-family-id"];
    const db = await getDb();

    if (headerFamilyId && db) {
      const fid = parseInt(Array.isArray(headerFamilyId) ? headerFamilyId[0] : headerFamilyId, 10);
      if (!isNaN(fid)) {
        const member = await db
          .select()
          .from(familyMembers)
          .where(and(eq(familyMembers.familyId, fid), eq(familyMembers.userId, String(user.id))))
          .limit(1);
        if (member.length > 0) {
          activeFamilyId = fid;
          activeFamilyRole = member[0].familyRole;
        }
      }
    }

    if (!activeFamilyId && db) {
      const defaultMember = await db
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.userId, String(user.id)), eq(familyMembers.isDefault, true)))
        .limit(1);
      if (defaultMember.length > 0) {
        activeFamilyId = defaultMember[0].familyId;
        activeFamilyRole = defaultMember[0].familyRole;
      }

      if (!activeFamilyId) {
        const firstMember = await db
          .select()
          .from(familyMembers)
          .where(eq(familyMembers.userId, String(user.id)))
          .limit(1);
        if (firstMember.length > 0) {
          activeFamilyId = firstMember[0].familyId;
          activeFamilyRole = firstMember[0].familyRole;
          await db.update(familyMembers).set({ isDefault: true }).where(eq(familyMembers.id, firstMember[0].id));
        }
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    activeFamilyId,
    activeFamilyRole,
  };
}
