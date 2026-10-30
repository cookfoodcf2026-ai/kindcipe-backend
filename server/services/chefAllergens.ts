import { eq } from "drizzle-orm";
import { aiChefFamilySafety } from "../../drizzle/schema";
import { getDb } from "../db";
import type { SuggestedRecipe } from "../routers/aiRecipe";

export const ALLERGEN_GROUPS: Record<string, string[]> = {
  "蝦": ["蝦", "蝦仁", "大蝦", "蝦球", "shrimp", "prawn"],
  "奶": ["奶", "牛奶", "芝士", "起司", "牛油", "奶油", "乳酪", "milk", "cheese", "butter", "dairy"],
  "花生": ["花生", "花生醬", "peanut"],
  "蛋": ["蛋", "雞蛋", "鴨蛋", "egg"],
  "麩質": ["麩質", "麵粉", "小麥", "麵包", "意粉", "gluten", "wheat", "flour"],
  "大豆": ["大豆", "黃豆", "豆腐", "豆卜", "豆乾", "豆漿", "soy", "soya", "tofu"],
  "堅果": ["堅果", "杏仁", "腰果", "核桃", "榛子", "開心果", "nut", "almond", "cashew", "walnut"],
  "魚": ["魚", "魚肉", "鱸魚", "三文魚", "鯇魚", "tuna", "salmon", "fish"],
  "蟹": ["蟹", "蟹肉", "蟹柳", "crab"],
  "貝類": ["貝類", "蜆", "蠔", "帶子", "扇貝", "蚵", "蛤", "mussel", "clam", "oyster", "scallop", "shellfish"],
};

const DECLARATION_RE = /敏感|過敏|allergy|allergic|唔食|不吃|唔可以食|不能吃|avoid/i;

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

export function detectDeclaredAllergens(text: string): string[] {
  const raw = String(text ?? "");
  if (!raw.trim() || !DECLARATION_RE.test(raw)) return [];
  const found = new Set<string>();
  if (/海鮮|海鲜|seafood/i.test(raw)) {
    ["蝦", "蟹", "貝類", "魚"].forEach((allergen) => found.add(allergen));
  }
  for (const [allergen, terms] of Object.entries(ALLERGEN_GROUPS)) {
    if (terms.some((term) => normalize(raw).includes(normalize(term)))) found.add(allergen);
  }
  return [...found];
}

function recipeAllergenText(recipe: { name?: unknown; ingredients?: unknown }): string {
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((ingredient: any) => typeof ingredient === "string" ? ingredient : ingredient?.name ?? "").join(" ")
    : "";
  return normalize(`${recipe.name ?? ""} ${ingredients}`);
}

export function filterAllergenCards<T extends { name?: unknown; ingredients?: unknown }>(recipes: T[], allergens: string[]): T[] {
  if (allergens.length === 0) return recipes;
  const terms = [...new Set(allergens.flatMap((allergen) => ALLERGEN_GROUPS[allergen] ?? [allergen]))].map(normalize).filter(Boolean);
  return recipes.filter((recipe) => {
    const haystack = recipeAllergenText(recipe);
    return !terms.some((term) => haystack.includes(term));
  });
}

export function allergenSafetyReply(lang: string, allergens: string[]): string {
  const list = allergens.join("、");
  if (lang.startsWith("en")) {
    return `Because you declared an allergy to ${list}, I won't show those cards. You can look for other dishes or tell me another type of food.`;
  }
  if (lang.startsWith("fil")) {
    return `Dahil sinabi mong allergic ka sa ${list}, hindi ko ipapakita ang mga card na iyon. Pwede kang tumingin ng ibang ulam o magsabi ng ibang klase ng pagkain.`;
  }
  if (lang.startsWith("id")) {
    return `Karena Anda menyatakan alergi terhadap ${list}, saya tidak akan menampilkan kartu tersebut. Anda bisa melihat hidangan lain atau memilih jenis makanan lain.`;
  }
  return `因為你聲明對「${list}」敏感，我唔敢出呢啲卡。可以睇其他菜，或者話我知想食邊類（例如菜、湯、肉）。`;
}

export function applyAllergenGuard<T extends SuggestedRecipe>(recipes: T[], allergens: string[], lang: string): {
  recipes: T[];
  removed: number;
  blocked: boolean;
  content?: string;
  clarifyReason?: "safety";
} {
  if (allergens.length === 0) return { recipes, removed: 0, blocked: false };
  const kept = filterAllergenCards(recipes, allergens);
  const removed = recipes.length - kept.length;
  if (removed === 0) return { recipes, removed: 0, blocked: false };
  if (kept.length === 0) {
    return { recipes: [], removed, blocked: true, content: allergenSafetyReply(lang, allergens), clarifyReason: "safety" };
  }
  return { recipes: kept, removed, blocked: false };
}

export async function getFamilyAllergens(familyId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const [row] = await db.select().from(aiChefFamilySafety).where(eq(aiChefFamilySafety.familyId, familyId)).limit(1);
    return Array.isArray(row?.allergens) ? row!.allergens.map(String).filter(Boolean) : [];
  } catch (error) {
    console.warn("[AI Chef] allergen read failed:", (error as Error)?.message || error);
    return [];
  }
}

export async function addFamilyAllergens(familyId: number, allergens: string[]): Promise<void> {
  if (allergens.length === 0) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await getFamilyAllergens(familyId);
    const merged = [...new Set([...existing, ...allergens])];
    await db.insert(aiChefFamilySafety).values({
      familyId,
      allergens: merged,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: aiChefFamilySafety.familyId,
      set: { allergens: merged, updatedAt: new Date() },
    });
  } catch (error) {
    console.warn("[AI Chef] allergen write failed:", (error as Error)?.message || error);
  }
}
