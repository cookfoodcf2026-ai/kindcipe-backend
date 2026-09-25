/**
 * Scan official recipes for step↔ingredient mismatches:
 * step text references a common cooking ingredient that is NOT in the ingredients list.
 * Read-only report (--dry default); use --apply to auto-add the common ones.
 * Usage: npx tsx scripts/scan-step-ingredient-mismatch.ts [--apply]
 */
import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);

// Common cooking ingredients that are almost always needed but often omitted from the list.
// {name, category, qty, unit}
const COMMON_OMITTED: Record<string, { name: string; category: string; quantity: string; unit: string }> = {
  '蒜茸': { name: '蒜茸', category: '調味料', quantity: '1', unit: '湯匙' },
  '蒜蓉': { name: '蒜蓉', category: '調味料', quantity: '1', unit: '湯匙' },
  '蒜頭': { name: '蒜頭', category: '調味料', quantity: '2', unit: '瓣' },
  '薑': { name: '薑', category: '調味料', quantity: '1', unit: '片' },
  '薑片': { name: '薑片', category: '調味料', quantity: '3', unit: '片' },
  '薑絲': { name: '薑絲', category: '調味料', quantity: '1', unit: '湯匙' },
  '蔥': { name: '蔥', category: '蔬菜', quantity: '1', unit: '條' },
  '蔥段': { name: '蔥段', category: '蔬菜', quantity: '1', unit: '條' },
  '蔥花': { name: '蔥花', category: '蔬菜', quantity: '1', unit: '湯匙' },
  '高湯': { name: '高湯', category: '其他', quantity: '1', unit: '杯' },
  '雞湯': { name: '雞湯', category: '其他', quantity: '1', unit: '杯' },
  '上湯': { name: '上湯', category: '其他', quantity: '1', unit: '杯' },
  '生抽': { name: '生抽', category: '調味料', quantity: '1', unit: '湯匙' },
  '老抽': { name: '老抽', category: '調味料', quantity: '1', unit: '茶匙' },
  '鹽': { name: '鹽', category: '調味料', quantity: '適量', unit: '' },
  '糖': { name: '糖', category: '調味料', quantity: '1', unit: '茶匙' },
  '油': { name: '油', category: '調味料', quantity: '2', unit: '湯匙' },
  '食油': { name: '食油', category: '調味料', quantity: '2', unit: '湯匙' },
  '米酒': { name: '米酒', category: '調味料', quantity: '1', unit: '湯匙' },
  '料酒': { name: '料酒', category: '調味料', quantity: '1', unit: '湯匙' },
};

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await sql`select id, name, ingredients, steps from official_recipes`;
  console.log(`Scanning ${rows.length} official recipes...\n`);

  let changed = 0;
  let changedNames: string[] = [];
  for (const r of rows) {
    const ing = JSON.parse(r.ingredients) as { name: string; category?: string }[];
    const steps = JSON.parse(r.steps) as { instruction?: string }[];
    const stepText = steps.map((s: any) => String(s?.instruction ?? s ?? '')).join('\n');
    const ingNames = ing.map((i) => String(i.name || ''));

    // For each common ingredient, if mentioned in steps AND NOT in ingredient list → add it
    const missing: { name: string; category: string; quantity: string; unit: string }[] = [];
    for (const [kw, def] of Object.entries(COMMON_OMITTED)) {
      if (!stepText.includes(kw)) continue; // not used in steps → skip
      // already present (exact or substring) → skip
      const present = ingNames.some((n) => n.includes(kw) || kw.includes(n));
      if (present) continue;
      missing.push(def);
    }
    if (missing.length === 0) continue;
    if (apply) {
      const newIng = [...ing, ...missing];
      await sql`update official_recipes set ingredients = ${JSON.stringify(newIng)} where id = ${r.id}`;
    }
    changed++;
    changedNames.push(`${r.name}: +${missing.map((m) => m.name).join(',')}`);
    console.log(`[${apply ? 'APPLY' : 'DRY'}] ${r.name} -> add: ${missing.map((m) => m.name).join(', ')}`);
  }
  console.log(`\n${changed} recipe(s) would change${apply ? ' (applied)' : ' (dry-run)'}.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
