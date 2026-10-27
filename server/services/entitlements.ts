import { TRPCError } from "@trpc/server";
import { getFamilyMembers, getFamilySubscription } from "../db";
import {
  PLAN_LIMITS,
  isPaidStatus,
  planKeyForStatus,
  type PlanKey,
  type PlanStatus,
} from "./entitlementPolicy";

export interface FamilyEntitlements {
  familyId: number;
  status: PlanStatus;
  plan: PlanKey;
  isPaid: boolean;
  limits: (typeof PLAN_LIMITS)[PlanKey];
  memberCount: number;
  memberGraceEndsAt: Date | null;
  memberGraceActive: boolean;
  readOnly: boolean;
  canUseKol: boolean;
  canUseParty: boolean;
  activeWriteUserIds: string[];
}

export async function getFamilyEntitlements(
  familyId: number,
  userId: string
): Promise<FamilyEntitlements | null> {
  const sub = await getFamilySubscription(familyId);
  if (!sub) return null;

  const status = sub.status as PlanStatus;
  const plan = planKeyForStatus(status);
  const limits = PLAN_LIMITS[plan];
  const members = await getFamilyMembers(familyId);
  const ordered = [...members].sort(
    (a, b) => new Date(a.member.joinedAt).getTime() - new Date(b.member.joinedAt).getTime()
  );
  const owner = ordered.find((m) => m.member.familyRole === "owner");
  const nonOwners = ordered.filter((m) => m.member.familyRole !== "owner");
  const activeWriteUserIds = sub.isPaid
    ? ordered.map((m) => m.user.id)
    : sub.memberGraceActive || ordered.length <= limits.members
      ? ordered.map((m) => m.user.id)
      : [owner, nonOwners[0]]
          .filter(Boolean)
          .map((m) => m!.user.id);

  const readOnly = !sub.isPaid && !activeWriteUserIds.includes(userId);
  return {
    familyId,
    status,
    plan,
    isPaid: isPaidStatus(status),
    limits,
    memberCount: ordered.length,
    memberGraceEndsAt: sub.memberGraceEndsAt ?? null,
    memberGraceActive: Boolean(sub.memberGraceActive),
    readOnly,
    canUseKol: sub.isPaid,
    canUseParty: sub.isPaid,
    activeWriteUserIds,
  };
}

export async function assertWritable(familyId: number, userId: string): Promise<void> {
  const ent = await getFamilyEntitlements(familyId, userId);
  if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
  if (ent.readOnly) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "此廚房已變回免費方案；你目前只可檢視。請管理員升級或移除超額成員。",
    });
  }
}

export async function assertProFeature(
  familyId: number,
  userId: string,
  feature: "kol" | "party"
): Promise<void> {
  const ent = await getFamilyEntitlements(familyId, userId);
  if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "找不到家庭廚房" });
  if (feature === "kol" && !ent.canUseKol) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "網紅食譜係 Pro 功能。升級後即可瀏覽及儲存。",
    });
  }
  if (feature === "party" && !ent.canUseParty) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "派對清單係 Pro 功能。升級後即可建立及儲存。",
    });
  }
}
