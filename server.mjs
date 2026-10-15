import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCardImage, getRiftCards, getRiftPrices } from './asset-cache.mjs';
import { makeCatalog } from './catalog.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (pathname === '/api/catalog') {
      const [catalog, prices] = await Promise.all([getRiftCards(), getRiftPrices()]);
      return json(res, 200, makeCatalog(catalog, prices));
    }
    const image = pathname.match(/^\/api\/card-image\/(\d{4,10})$/);
    if (image) {
      const asset = await getCardImage(image[1]);
      if (!asset) return json(res, 404, { error: '卡图不存在' });
      const bytes = await readFile(asset.file);
      res.writeHead(200, { 'content-type': asset.type, 'content-length': bytes.length, 'cache-control': 'public, max-age=604800' });
      return res.end(bytes);
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });

    const file = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
    const requested = path.resolve(dist, file);
    if (!requested.startsWith(dist + path.sep) && requested !== path.join(dist, 'index.html')) return json(res, 403, { error: '禁止访问' });
    const info = await stat(requested).catch(() => null);
    const target = info?.isFile() ? requested : path.join(dist, 'index.html');
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': contentTypes[path.extname(target)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    json(res, 502, { error: error.message || '服务暂不可用' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`tcgStock: http://127.0.0.1:${port}`));
