const BRAND_ALIASES = {
  apple: "Apple",
  hp: "HP",
  hewlett: "HP",
  dell: "Dell",
  lenovo: "Lenovo",
  asus: "ASUS",
  acer: "Acer",
};
const TYPE_ALIASES = {
  laptop: "Computadora",
  notebook: "Computadora",
  pc: "Computadora",
  computadora: "Computadora",
  desktop: "Computadora",
};
const STATUS_ALIASES = {
  alta: "ALTA",
  baja: "BAJA",
  mantenimiento: "MANTENIMIENTO",
};

function looksLikeSerial(s) {
  const t = (s || "").trim();
  if (!/^[A-Za-z0-9\-]{8,20}$/.test(t)) return false;
  if (!/\d{3,}/.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  return true;
}

function normalizeFilters(raw) {
  const f = {};
  if (raw.brandName)
    f.brandName = BRAND_ALIASES[raw.brandName.toLowerCase()] || raw.brandName;
  if (raw.typeName)
    f.typeName = TYPE_ALIASES[raw.typeName.toLowerCase()] || raw.typeName;
  if (raw.status)
    f.status =
      STATUS_ALIASES[raw.status.toLowerCase()] || raw.status.toUpperCase();
  return f;
}

// Reemplaza parseQueryToFilters por esta versión:
function parseQueryToFilters(q) {
  const original = (q || "").trim();

  const found = {};
  // Busca marca / brand:
  const mBrand =
    original.match(/\bmarca\s+([a-záéíóúüñ0-9\-]+)/i) ||
    original.match(/\bbrand:([^\s]+)/i);
  if (mBrand) found.brandName = mBrand[1];

  // Busca status:
  const mStatus =
    original.match(/\bstatus\s+([a-záéíóúüñ]+)/i) ||
    original.match(/\bstatus:([^\s]+)/i);
  if (mStatus) found.status = mStatus[1];

  // Busca tipo:
  const mType =
    original.match(/\b(laptop|notebook|desktop|computadora)\b/i) ||
    original.match(/\btype:([^\s]+)/i);
  if (mType) found.typeName = mType[1] || mType[0];

  // Detecta posible serial en cualquier token
  const tokens = original.split(/\s+/);
  const serialToken = tokens.find((t) =>
    looksLikeSerial(t.replace(/serial:|serie:/i, ""))
  );
  const maybeSerial = serialToken
    ? serialToken.replace(/^(serial:|serie:)/i, "")
    : null;

  return {
    text: original,
    textOriginal: original,
    filters: normalizeFilters(found),
    maybeSerial,
  };
}

function buildQdrantFilter(filters) {
  const must = [];
  for (const [k, v] of Object.entries(filters || {})) {
    must.push({ key: k, match: { value: v } });
  }
  return must.length ? { must } : undefined;
}

module.exports = { parseQueryToFilters, buildQdrantFilter, looksLikeSerial };
