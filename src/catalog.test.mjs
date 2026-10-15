import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCatalog } from '../catalog.mjs';

test('published snapshot preserves product, finish and quote date; URLs stay under the Pages base', () => {
  const catalogue = { fetched: '2026-10-14', cards: [{ tcgId: '123456', name: 'Card', num: 1, imgUrl: 'https://example.com/art.jpg' }, { name: 'No product' }, { tcgId: '234567', name: 'Unpriced' }] };
  const prices = { fetched: '2026-10-15', prices: [{ tcgId: 123456, updatedAt: '2026-10-15', finishes: { normal: { market: 3 }, foil: { market: 8 } } }] };
  const data = makeCatalog(catalogue, prices, (card) => card.imgUrl ? `/tcgStock/card-images/${card.tcgId}.webp` : null);
  assert.equal(data.cards.length, 2);
  assert.equal(data.cards[0].id, '123456');
  assert.equal(data.cards[0].image, '/tcgStock/card-images/123456.webp');
  assert.equal(data.cards[0].rift.date, '2026-10-15');
  assert.equal(data.cards[0].rift.finishes.foil.market, 8);
  assert.equal(data.cards[1].rift, null);
  assert.equal(data.cards[1].image, null);
});
