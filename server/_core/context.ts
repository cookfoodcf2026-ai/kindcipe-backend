import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getDb, setDefaultFamily } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { families, familyMembers } from "../../drizzle/schema";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  activeFamilyId: number | null;
  activeFamilyRole: "owner" | "admin" | "helper" | "member" | null;
  /**
   * 廚房試用到期／免費身份，但成員人數 > 1（爺嫲保留期）。
   * 成員只能檢視共用資料，不能寫入；owner 仍可管理。
   */
  sharedLocked: boolean;
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
  let sharedLocked = false;

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
          await setDefaultFamily(String(user.id), firstMember[0].familyId);
        }
      }
    }

    // Shared lock: 免費/到期 且 成員 >1，非 owner/admin 成員只可檢視
    if (activeFamilyId && activeFamilyRole && activeFamilyRole !== "owner" && activeFamilyRole !== "admin" && db) {
      const [fam] = await db
        .select({
          subscriptionStatus: families.subscriptionStatus,
          subscriptionExpiresAt: families.subscriptionExpiresAt,
          trialEndsAt: families.trialEndsAt,
        })
        .from(families)
        .where(eq(families.id, activeFamilyId))
        .limit(1);
      if (fam) {
        const now = new Date();
        let status = fam.subscriptionStatus ?? "free";
        if (status === "trial" && fam.trialEndsAt && fam.trialEndsAt < now) status = "free";
        if (status === "active" && fam.subscriptionExpiresAt && fam.subscriptionExpiresAt < now) status = "expired";
        const [cnt] = await db
          .select({ c: sql`count(*)::int` })
          .from(familyMembers)
          .where(eq(familyMembers.familyId, activeFamilyId));
        sharedLocked = (status === "free" || status === "expired") && Number(cnt?.c ?? 0) > 1;
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    activeFamilyId,
    activeFamilyRole,
    sharedLocked,
  };
}
