import postgres from 'postgres';
import 'dotenv/config';

async function updateChawanmushiTags() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });

  const EXTRA_TAGS = ["蒸蛋", "蛋", "蒸", "egg", "steam", "chawanmushi"];

  try {
    const rows = await db`
      SELECT id, name, tags FROM official_recipes
      WHERE name = '日式茶碗蒸'
    `;

    if (rows.length === 0) {
      console.log('❌ Recipe "日式茶碗蒸" not found');
      return;
    }

    for (const row of rows) {
      let current: string[] = [];
      try {
        current = Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags ?? '[]');
      } catch {
        current = [];
      }
      const merged = Array.from(new Set([...current, ...EXTRA_TAGS]));

      const res = await db`
        UPDATE official_recipes
        SET tags = ${JSON.stringify(merged)},
            updated_at = NOW()
        WHERE id = ${row.id}
        RETURNING id, name, tags;
      `;
      console.log('✅ Updated:', res[0].name);
      console.log('   Tags:', JSON.stringify(res[0].tags));
    }
  } catch (err: any) {
    console.error('❌ Error:', err.message);
  } finally {
    await db.end();
  }
}

updateChawanmushiTags();