import Logger from './logger';

const UPC_API = 'https://api.upcitemdb.com/prod/trial/lookup';

export async function lookupBarcode(code) {
  Logger.info('Barcode', 'Looking up UPC', { code });
  try {
    const res = await fetch(`${UPC_API}?upc=${code}`);
    if (!res.ok) { Logger.warn('Barcode', `UPC API returned ${res.status}`); return null; }
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) { Logger.warn('Barcode', 'No item found for code', { code }); return null; }
    Logger.info('Barcode', 'Product found', { title: item.title, brand: item.brand });
    return {
      name: item.title || '',
      brand: item.brand || '',
      color: item.color || '',
      category: guessCategory(item.category || item.title || ''),
    };
  } catch (e) {
    Logger.error('Barcode', 'Lookup failed', e);
    return null;
  }
}

export function guessCategory(text) {
  const t = text.toLowerCase();
  if (/shoe|boot|sneaker|sandal|loafer|heel|trainer/.test(t)) return 'Shoes';
  if (/jacket|coat|blazer|hoodie|cardigan|sweater/.test(t)) return 'Outerwear';
  if (/pant|jean|trouser|short|skirt|legging/.test(t)) return 'Bottoms';
  if (/dress|gown|romper|jumpsuit/.test(t)) return 'Dresses';
  if (/watch|belt|bag|hat|sock|scarf|glove|jewel|necklace|ring/.test(t)) return 'Accessories';
  if (/gym|sport|yoga|athletic|active/.test(t)) return 'Activewear';
  if (/swim|bikini|board short/.test(t)) return 'Swimwear';
  return 'Tops';
}
