import { getCardImage, getRiftCards } from '../asset-cache.mjs';

const all = process.argv.includes('--all');
const catalog = await getRiftCards();
const featured = new Set(['706014', '653102', '652903', '652850', '652802']);
const ids = [...new Set(catalog.cards.filter((card) => card.tcgId && card.imgUrl && (all || featured.has(String(card.tcgId)))).map((card) => String(card.tcgId)))];
let loaded = 0;
let failed = 0;
for (let index = 0; index < ids.length; index += 4) {
  const batch = ids.slice(index, index + 4);
  const results = await Promise.allSettled(batch.map((id) => getCardImage(id)));
  for (const result of results) result.status === 'fulfilled' && result.value ? loaded++ : failed++;
  if (all && (index + 4) % 100 === 0) console.log(`Card images: ${Math.min(index + 4, ids.length)}/${ids.length}, saved ${loaded}, failed ${failed}`);
  if (index + 4 < ids.length) await new Promise((resolve) => setTimeout(resolve, 600));
}
console.log(`Card images ready: ${loaded}/${ids.length}; failed: ${failed}`);
if (failed) process.exitCode = 1;
