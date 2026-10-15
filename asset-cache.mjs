import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const imagesDir = path.join(dataDir, 'images');
const inflight = new Map();
const USER_AGENT = 'tcgStock/0.1 (Riftbound market simulator)';
const imageHosts = new Set(['tcgplayer-cdn.tcgplayer.com', 'cmsassets.rgpub.io']);
const IMAGE_LIMIT = 5 * 1024 * 1024;
let imageActive = 0;
const imageQueue = [];

async function queuedImage(task) {
  if (imageActive >= 4) await new Promise((resolve) => imageQueue.push(resolve));
  imageActive++;
  try { return await task(); }
  finally { imageActive--; imageQueue.shift()?.(); }
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return null; }
}

async function saveAtomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`行情接口返回 ${response.status}`);
  return response.json();
}

async function persistentJson(name, url, ttl, validate) {
  const file = path.join(dataDir, name);
  const info = await stat(file).catch(() => null);
  if (info && Date.now() - info.mtimeMs < ttl) {
    const saved = await readJson(file);
    if (validate(saved)) return saved;
  }
  if (inflight.has(file)) return inflight.get(file);
  const pending = (async () => {
    try {
      const data = await fetchJson(url);
      if (!validate(data)) throw new Error('行情批量文件格式无效');
      await saveAtomic(file, JSON.stringify(data));
      return data;
    } catch (error) {
      const stale = await readJson(file);
      if (validate(stale)) return stale;
      throw error;
    }
  })();
  inflight.set(file, pending);
  try { return await pending; }
  finally { inflight.delete(file); }
}

export const getRiftCards = () => persistentJson('rifthunt-cards.json', 'https://api.rifthunt.com/bulk/cards', 24 * 60 * 60 * 1000, (value) => Array.isArray(value?.cards));
export const getRiftPrices = () => persistentJson('rifthunt-prices.json', 'https://api.rifthunt.com/bulk/prices', 60 * 60 * 1000, (value) => Array.isArray(value?.prices));

async function existingImage(id) {
  for (const extension of ['jpg', 'png', 'webp']) {
    const file = path.join(imagesDir, `${id}.${extension}`);
    if (await stat(file).then((item) => item.isFile()).catch(() => false)) return { file, type: `image/${extension === 'jpg' ? 'jpeg' : extension}` };
  }
  return null;
}

export async function getCardImage(id) {
  if (!/^\d{4,10}$/.test(String(id))) return null;
  const local = await existingImage(id);
  if (local) return local;
  const key = `image:${id}`;
  if (inflight.has(key)) return inflight.get(key);
  const pending = queuedImage(async () => {
    const existing = await existingImage(id);
    if (existing) return existing;
    const catalog = await getRiftCards();
    const imageUrl = catalog.cards.find((card) => String(card.tcgId) === String(id))?.imgUrl;
    if (!imageUrl) return null;
    const url = new URL(imageUrl);
    if (url.protocol !== 'https:' || !imageHosts.has(url.hostname)) throw new Error('卡图来源不受支持');
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`卡图接口返回 ${response.status}`);
    const type = response.headers.get('content-type')?.split(';')[0];
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    if (!extension) throw new Error('卡图格式不受支持');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > IMAGE_LIMIT) throw new Error('卡图文件过大');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > IMAGE_LIMIT) throw new Error('卡图文件过大');
    const file = path.join(imagesDir, `${id}.${extension}`);
    await saveAtomic(file, bytes);
    return { file, type };
  });
  inflight.set(key, pending);
  try { return await pending; }
  finally { inflight.delete(key); }
}
