/**
 * schema.org Recipe (JSON-LD) extraction.
 *
 * Most recipe websites embed a `application/ld+json` block with a Recipe node —
 * the most accurate, cheapest source (no LLM, no hallucination). We also resolve
 * the creator's own outbound recipe link from a social post's caption/description
 * and read the JSON-LD there (same dish, authoritative).
 */

export type JsonLdRecipe = {
  name: string;
  description?: string;
  ingredients: string[];
  steps: string[];
  cookTime?: number; // minutes
  servings?: number;
  image?: string;
  author?: string;
};

const SOCIAL_DOMAIN_RE =
  /(instagram\.com|facebook\.com|fb\.watch|fb\.me|youtube\.com|youtu\.be|tiktok\.com|xiaohongshu\.com|xhslink\.com|threads\.(net|com))/i;

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function stripHtml(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseIsoDuration(s: unknown): number | undefined {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(String(s ?? ""));
  if (!m) return undefined;
  const mins = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  return mins > 0 ? mins : undefined;
}

function flattenInstructions(v: unknown): string[] {
  const out: string[] = [];
  for (const item of toArray<any>(v as any)) {
    if (typeof item === "string") {
      const t = stripHtml(item);
      if (t) out.push(t);
      continue;
    }
    const type = String(item?.["@type"] ?? "");
    if (/(HowToSection)/i.test(type) && item?.itemListElement) {
      out.push(...flattenInstructions(item.itemListElement));
      continue;
    }
    const t = stripHtml(item?.text ?? item?.name ?? "");
    if (t) out.push(t);
  }
  return out;
}

function mapRecipeNode(node: any): JsonLdRecipe | null {
  const name = stripHtml(node?.name);
  if (!name) return null;
  const ingredients = toArray<any>(node?.recipeIngredient ?? node?.ingredients)
    .map((i) => stripHtml(typeof i === "string" ? i : i?.name ?? ""))
    .filter(Boolean);
  const steps = flattenInstructions(node?.recipeInstructions);
  // Require REAL content — never fabricate.
  if (ingredients.length === 0 && steps.length === 0) return null;

  const yieldRaw = toArray<any>(node?.recipeYield)[0];
  const servings = yieldRaw != null ? parseInt(String(yieldRaw).match(/\d+/)?.[0] ?? "", 10) : undefined;

  const imgRaw = toArray<any>(node?.image)[0];
  const image = typeof imgRaw === "string" ? imgRaw : imgRaw?.url ? String(imgRaw.url) : undefined;

  const authorRaw = node?.author;
  const author = Array.isArray(authorRaw) ? authorRaw[0]?.name : authorRaw?.name ?? (typeof authorRaw === "string" ? authorRaw : undefined);

  return {
    name,
    description: stripHtml(node?.description) || undefined,
    ingredients,
    steps,
    cookTime: parseIsoDuration(node?.totalTime ?? node?.cookTime ?? node?.prepTime),
    servings: Number.isFinite(servings as number) ? (servings as number) : undefined,
    image,
    author: author ? String(author) : undefined,
  };
}

/** Extract the first schema.org Recipe from raw HTML, or null. */
export function extractRecipeJsonLd(html: string): JsonLdRecipe | null {
  if (!html) return null;
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of scripts) {
    let data: any;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const nodes = Array.isArray(data) ? data : (data?.["@graph"] ? data["@graph"] : [data]);
    for (const node of nodes) {
      const types = toArray(node?.["@type"]).map((t) => String(t).toLowerCase());
      if (types.includes("recipe")) {
        const r = mapRecipeNode(node);
        if (r) return r;
      }
    }
  }
  return null;
}

/**
 * Find the creator's own outbound recipe link inside a social caption/description
 * (first non-social URL). Used to fetch that website's JSON-LD (same dish).
 */
export function findOutboundRecipeUrl(text: string): string | null {
  const urls = String(text ?? "").match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];
  for (const u of urls) {
    const clean = u.replace(/[.,;)\]]+$/, "");
    if (!SOCIAL_DOMAIN_RE.test(clean)) return clean;
  }
  return null;
}
