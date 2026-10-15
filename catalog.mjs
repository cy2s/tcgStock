// The local server and the published snapshot use the same card and price model.
export function makeCatalog(catalog, prices, imageFor = (card) => card.imgUrl ? `/api/card-image/${card.tcgId}` : null) {
  const byId = new Map(prices.prices.map((row) => [String(row.tcgId), row]));
  const cards = catalog.cards.filter((card) => card.tcgId).map((card) => {
    const price = byId.get(String(card.tcgId));
    return {
      id: String(card.tcgId), name: card.name, set: card.set, setName: card.setName,
      number: card.num, rarity: card.rarity, image: imageFor(card),
      alt: card.alt, signature: card.sig, overnumbered: card.over,
      rift: price ? { date: price.updatedAt, finishes: price.finishes } : null,
    };
  });
  return { cards, fetched: prices.fetched, catalogFetched: catalog.fetched };
}
