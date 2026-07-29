import postgres from 'postgres';
import 'dotenv/config';

async function updateRecipeImage() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });
  
  try {
    // Update the recipe "番茄炒蛋" with the image URL
    const result = await db`
      UPDATE official_recipes 
      SET thumbnail_url = 'https://kindcipe-backend-production.up.railway.app/r2-storage/recipes/scrambled-eggs-tomatoes.png',
          updated_at = NOW()
      WHERE name = '番茄炒蛋'
      RETURNING id, name, thumbnail_url;
    `;
    
    if (result.count > 0) {
      console.log('✅ Updated recipe:', result[0]);
    } else {
      console.log('❌ Recipe "番茄炒蛋" not found');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await db.end();
  }
}

updateRecipeImage();
