import { mkdir, readFile, writeFile, stat, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { makeCatalog } from '../catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.PAGES_BASE_PATH || '/';
if (!/^\/(?:[\w.-]+\/)*$/.test(base)) throw new Error('PAGES_BASE_PATH must start and end with /');
const cache = path.join(root, '.cache', 'market');
const images = path.join(root, 'public', 'card-images');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => stat(file).then((value) => value.isFile()).catch(() => false);
await Promise.all([mkdir(cache, { recursive: true }), mkdir(images, { recursive: true })]);

async function bulk(name, key, ttl) {
  const file = path.join(cache, name);
  const info = await stat(file).catch(() => null);
  if (info && Date.now() - info.mtimeMs < ttl) {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(saved[key])) return saved;
  }
  try {
    const response = await fetch(`https://api.rifthunt.com/bulk/${key}`, {
      headers: { 'User-Agent': 'tcgStock/0.1 (https://github.com/GenjiCy/tcgStock)', accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data[key]) || !data[key].length) throw new Error('Invalid bulk export');
    await writeFile(file, JSON.stringify(data));
    return data;
  } catch (error) {
    // Keep the site available during an upstream outage; quote dates still gate trading.
    const fallback = info ? file : path.join(root, 'data', name);
    const data = JSON.parse(await readFile(fallback, 'utf8'));
    if (!Array.isArray(data[key]) || !data[key].length) throw error;
    console.warn(`Using saved ${key}: ${error.message}`);
    return data;
  }
}

const [catalog, prices] = await Promise.all([
  bulk('rifthunt-cards.json', 'cards', 24 * 60 * 60 * 1000),
  bulk('rifthunt-prices.json', 'prices', 60 * 60 * 1000),
]);
const cards = [...new Map(catalog.cards.filter((card) => /^\d{4,10}$/.test(String(card.tcgId)) && card.imgUrl).map((card) => [String(card.tcgId), card])).values()];
const available = new Set();
let converted = 0;
let failed = 0;
const hosts = new Set(['tcgplayer-cdn.tcgplayer.com', 'cmsassets.rgpub.io']);

async function image(card) {
  const id = String(card.tcgId);
  const target = path.join(images, `${id}.webp`);
  if (await exists(target)) { available.add(id); return; }
  if (process.argv.includes('--cached-images-only')) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let input;
      for (const extension of ['jpg', 'png', 'webp']) {
        const local = path.join(root, 'data', 'images', `${id}.${extension}`);
        if (await exists(local)) { input = await readFile(local); break; }
      }
      if (!input) {
        const url = new URL(card.imgUrl);
        if (url.protocol !== 'https:' || !hosts.has(url.hostname)) throw new Error('Unrecognized image host');
        // This CDN serves smaller variants; 600px high is enough for the 420px-wide output.
        if (url.hostname === 'tcgplayer-cdn.tcgplayer.com') url.pathname = url.pathname.replace('_in_1000x1000.', '_in_600x600.');
        const response = await fetch(url, { headers: { 'User-Agent': 'tcgStock/0.1 (https://github.com/GenjiCy/tcgStock)' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
        input = Buffer.from(await response.arrayBuffer());
        if (input.length > 5 * 1024 * 1024) throw new Error('Image exceeds 5 MB');
      }
      await sharp(input).resize({ width: 420, withoutEnlargement: true }).webp({ quality: 78 }).toFile(target);
      available.add(id);
      converted++;
      return;
    } catch (error) {
      if (attempt === 0) await sleep(1000);
      else {
        failed++;
        console.warn(`Image unavailable ${id}: ${error.message}`);
      }
    }
  }
}

// Four requests at a time, with a pause between batches. Only missing art is fetched.
for (let offset = 0; offset < cards.length; offset += 4) {
  const batch = cards.slice(offset, offset + 4);
  const before = converted + failed;
  await Promise.all(batch.map(image));
  if (offset % 100 === 0 || offset + 4 >= cards.length) console.log(`Card art ${Math.min(offset + 4, cards.length)}/${cards.length}; ready ${available.size}, unavailable ${failed}`);
  if (converted + failed > before && offset + 4 < cards.length) await sleep(650);
}

const snapshot = makeCatalog(catalog, prices, (card) => available.has(String(card.tcgId)) ? `${base}card-images/${card.tcgId}.webp` : null);
snapshot.generatedAt = new Date().toISOString();
const outputData = path.join(root, 'public', 'data');
await mkdir(outputData, { recursive: true });
await writeFile(path.join(outputData, 'catalog.json'), JSON.stringify(snapshot));
const build = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--base', base], {
  cwd: root, stdio: 'inherit', env: { ...process.env, VITE_CATALOG_URL: `${base}data/catalog.json` },
});
if (build.status !== 0) process.exit(build.status || 1);
await mkdir(path.join(root, 'dist', 'design'), { recursive: true });
for (const name of ['index.html', 'app.js', 'styles.css', 'assets', 'README.md', 'ios27-v8-backup']) {
  await cp(path.join(root, 'design', name), path.join(root, 'dist', 'design', name), { recursive: true });
}
await writeFile(path.join(root, 'dist', '.nojekyll'), '');
console.log(`Pages ready: ${snapshot.cards.length} cards, ${available.size} local images, price snapshot ${snapshot.fetched}`);
