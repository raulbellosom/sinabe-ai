const { pool } = require('./mysql');

async function keywordSearchMySQL({ q, limit = 20, filters = {} }) {
  const likeQ = `%${q}%`;
  const where = [];
  const args = [];

  if (filters.brandName) { where.push('b.name = ?'); args.push(filters.brandName); }
  if (filters.typeName)  { where.push('t.name = ?'); args.push(filters.typeName); }
  if (filters.status)    { where.push('i.status = ?'); args.push(filters.status); }

  const whereSql = where.length ? ('AND ' + where.join(' AND ')) : '';

  const [rows] = await pool.query(
    `SELECT i.id, i.serialNumber, i.activeNumber, i.status, i.createdAt,
            m.name AS modelName, b.name AS brandName, t.name AS typeName
     FROM Inventory i
     JOIN Model m ON i.modelId = m.id
     JOIN InventoryBrand b ON m.brandId = b.id
     JOIN InventoryType t ON m.typeId = t.id
     WHERE i.enabled = 1
       AND (m.name LIKE ? OR b.name LIKE ? OR t.name LIKE ? OR i.serialNumber LIKE ? OR i.activeNumber LIKE ?)
       ${whereSql}
     LIMIT ?`,
    [likeQ, likeQ, likeQ, likeQ, likeQ, ...args, limit]
  );
  return rows.map((r, idx) => ({ score: 1.0/(idx+1), ...r }));
}

module.exports = { keywordSearchMySQL };