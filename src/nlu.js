const BRAND_ALIASES = { apple: 'Apple', hp: 'HP', hewlett: 'HP', dell:'Dell', lenovo:'Lenovo', asus:'ASUS', acer:'Acer' };
const TYPE_ALIASES  = { laptop:'Computadora', notebook:'Computadora', 'pc':'Computadora', computadora:'Computadora', 'desktop':'Computadora' };
const STATUS_ALIASES= { alta:'ALTA', baja:'BAJA', mantenimiento:'MANTENIMIENTO' };

function looksLikeSerial(s) {
  const t = (s||'').trim();
  return /^[A-Za-z0-9\-]{8,16}$/.test(t);
}

function normalizeFilters(raw) {
  const f = {};
  if (raw.brandName)   f.brandName  = (BRAND_ALIASES[raw.brandName.toLowerCase()] || raw.brandName);
  if (raw.typeName)    f.typeName   = (TYPE_ALIASES[raw.typeName.toLowerCase()]   || raw.typeName);
  if (raw.status)      f.status     = (STATUS_ALIASES[raw.status.toLowerCase()]   || raw.status.toUpperCase());
  return f;
}

function parseQueryToFilters(q) {
  const original = (q||'').trim();
  let text = original;

  const found = { };
  const mBrand = text.match(/\bmarca\s+([a-záéíóúüñ0-9\-]+)/i) || text.match(/\bbrand:([^\s]+)/i);
  if (mBrand) { found.brandName = mBrand[1]; text = text.replace(mBrand[0],''); }

  const mStatus = text.match(/\bstatus\s+([a-záéíóúüñ]+)/i) || text.match(/\bstatus:([^\s]+)/i);
  if (mStatus) { found.status = mStatus[1]; text = text.replace(mStatus[0],''); }

  const mType = text.match(/\b(laptop|notebook|desktop|computadora)\b/i) || text.match(/\btype:([^\s]+)/i);
  if (mType) { found.typeName = (mType[1] || mType[0]); text = text.replace(mType[0],''); }

  const tokens = original.split(/\s+/);
  const serialToken = tokens.find(t => looksLikeSerial(t.replace(/serial:|serie:/i,'')));
  const maybeSerial = serialToken ? serialToken.replace(/^(serial:|serie:)/i,'') : null;

  return { text: text.trim(), filters: normalizeFilters(found), maybeSerial };
}

function buildQdrantFilter(filters) {
  const must = [];
  for (const [k,v] of Object.entries(filters||{})) {
    must.push({ key: k, match: { value: v }});
  }
  return must.length ? { must } : undefined;
}

module.exports = { parseQueryToFilters, buildQdrantFilter, looksLikeSerial };