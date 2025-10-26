const { pool } = require('./mysql');

function levenshtein(a, b) {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_,i)=>[i]);
  for (let j=1;j<=n;j++) dp[0][j]=j;
  for (let i=1;i<=m;i++) {
    for (let j=1;j<=n;j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
    }
  }
  return dp[m][n];
}

async function suggestSerials(serial, { limit=8 } = {}) {
  const likePrefix = serial.slice(0,3) + '%';
  const [candidates] = await pool.query(
    `SELECT i.id, i.serialNumber, i.activeNumber, i.status, i.createdAt,
            m.name AS modelName, b.name AS brandName, t.name AS typeName
     FROM Inventory i
     JOIN Model m ON i.modelId = m.id
     JOIN InventoryBrand b ON m.brandId = b.id
     JOIN InventoryType t ON m.typeId = t.id
     WHERE i.enabled=1 AND i.serialNumber LIKE ?
     LIMIT 500`,
    [likePrefix]
  );
  const up = serial.toUpperCase();
  const scored = candidates.map(c => ({
    dist: levenshtein(up, (c.serialNumber||'').toUpperCase()),
    ...c
  }));
  scored.sort((a,b) => a.dist - b.dist);
  return scored.slice(0, limit);
}

module.exports = { levenshtein, suggestSerials };