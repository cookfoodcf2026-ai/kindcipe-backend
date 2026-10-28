import { fetchPageContent } from "../server/routers/recipes";

const url = process.argv[2];
if (!url) {
  console.error("usage: npm run probe:fb -- <facebook-url>");
  process.exit(1);
}
const result = await fetchPageContent(url);
console.log(JSON.stringify({
  url,
  pageContentLen: result.text.length,
  thumbnail: Boolean(result.thumbnail),
  preview: result.text.slice(0, 240),
}, null, 2));
