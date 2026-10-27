import type { ChefRequested, RequestedRole } from "./chefIntent";

export type RecipeCandidate<T> = {
  recipe: T;
  role: RequestedRole;
  source?: "library" | "ai";
};

export type AssembleDeps<T> = {
  pickLibrary: (role: RequestedRole, count: number, excludeNames: string[]) => Promise<RecipeCandidate<T>[]>;
  generate: (role: RequestedRole, count: number, excludeNames: string[]) => Promise<RecipeCandidate<T>[]>;
  validate: (recipe: T, role: RequestedRole) => boolean;
  nameOf: (recipe: T) => string;
  maxRounds?: number;
};

export type AssembleResult<T> = {
  cards: T[];
  served: number;
  requested: number;
  missingRoles: RequestedRole[];
  sources: { library: number; ai: number };
  warnings: string[];
};

const normalizeRole = (role: RequestedRole): RequestedRole => role;

function normalizeRequested(requested: ChefRequested): RequestedRole[] {
  const total = Math.max(0, Math.floor(requested.total));
  const roles = requested.roles.slice(0, total).map(normalizeRole);
  while (roles.length < total) roles.push("any");
  return roles;
}

function countRoles(roles: RequestedRole[]): Map<RequestedRole, number> {
  const out = new Map<RequestedRole, number>();
  for (const role of roles) out.set(role, (out.get(role) ?? 0) + 1);
  return out;
}

function nameKey(name: string): string {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function assembleRecipeSet<T>(
  requested: ChefRequested,
  deps: AssembleDeps<T>,
): Promise<AssembleResult<T>> {
  const roles = normalizeRequested(requested);
  if (roles.length === 0) {
    return { cards: [], served: 0, requested: 0, missingRoles: [], sources: { library: 0, ai: 0 }, warnings: [] };
  }

  const picked: Array<{ recipe: T; role: RequestedRole; source: "library" | "ai" }> = [];
  const usedNames = new Set<string>();

  const tryCandidate = (candidate: RecipeCandidate<T> | undefined, role: RequestedRole, source: "library" | "ai"): boolean => {
    if (!candidate) return false;
    const key = nameKey(deps.nameOf(candidate.recipe));
    if (!key || usedNames.has(key)) return false;
    let valid = false;
    try {
      valid = deps.validate(candidate.recipe, role);
    } catch {
      valid = false;
    }
    if (!valid) return false;
    usedNames.add(key);
    picked.push({ recipe: candidate.recipe, role, source });
    return true;
  };

  // 1) Library first, role by role. Never bail out before the target count.
  for (const role of roles) {
    if (picked.length >= roles.length) break;
    let candidates: RecipeCandidate<T>[] = [];
    try {
      candidates = await deps.pickLibrary(role, 1, [...usedNames]);
    } catch {
      candidates = [];
    }
    for (const candidate of candidates) {
      if (tryCandidate(candidate, role, "library")) break;
    }
  }

  const missingFor = (): RequestedRole[] => {
    const wanted = countRoles(roles);
    const have = countRoles(picked.map((p) => p.role));
    const missing: RequestedRole[] = [];
    for (const [role, count] of wanted) {
      const diff = count - (have.get(role) ?? 0);
      for (let i = 0; i < diff; i++) missing.push(role);
    }
    return missing;
  };

  // 2) AI fills only missing roles, with a bounded retry. Partial is allowed,
  // but never a silent zero-card success.
  const rounds = Math.max(1, deps.maxRounds ?? 2);
  for (let round = 0; round < rounds; round++) {
    const missing = missingFor();
    if (missing.length === 0) break;
    const generatedByRole = await Promise.all(
      missing.map(async (role) => {
        try {
          return { role, candidates: await deps.generate(role, 1, [...usedNames]) };
        } catch {
          return { role, candidates: [] as RecipeCandidate<T>[] };
        }
      }),
    );
    for (const { role, candidates } of generatedByRole) {
      if (picked.length >= roles.length) break;
      for (const candidate of candidates) {
        if (tryCandidate(candidate, role, "ai")) break;
      }
    }
  }

  const missingRoles = missingFor();
  const warnings = missingRoles.length > 0
    ? [`missing_roles:${missingRoles.join(",")}`]
    : [];

  return {
    cards: picked.map((p) => p.recipe),
    served: picked.length,
    requested: roles.length,
    missingRoles,
    sources: {
      library: picked.filter((p) => p.source === "library").length,
      ai: picked.filter((p) => p.source === "ai").length,
    },
    warnings,
  };
}
