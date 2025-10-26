const { pool } = require("./mysql");

async function keywordSearchMySQL({ q, limit = 20, filters = {} }) {
  const likeQ = `%${q}%`;
  const where = [];
  const args = [];

  if (filters.brandName) {
    where.push("b.name = ?");
    args.push(filters.brandName);
  }
  if (filters.typeName) {
    where.push("t.name = ?");
    args.push(filters.typeName);
  }
  if (filters.status) {
    where.push("i.status = ?");
    args.push(filters.status);
  }

  const whereSql = where.length ? "AND " + where.join(" AND ") : "";

  const [rows] = await pool.query(
    `SELECT
       i.id,
       i.serialNumber,
       i.activeNumber,
       i.status,
       i.comments,
       i.receptionDate,
       i.internalFolio,
       i.createdAt,
       i.altaDate,
       i.bajaDate,
       m.name       AS modelName,
       b.name       AS brandName,
       t.name       AS typeName,
       inv.code     AS invoiceCode,
       po.code      AS purchaseOrderCode,
       cfs.customFieldsText
     FROM Inventory i
     JOIN Model m           ON i.modelId = m.id
     JOIN InventoryBrand b  ON m.brandId = b.id
     JOIN InventoryType t   ON m.typeId = t.id
     LEFT JOIN Invoice inv  ON inv.id = i.invoiceId
     LEFT JOIN PurchaseOrder po ON po.id = i.purchaseOrderId
     LEFT JOIN (
       SELECT ic.inventoryId,
              GROUP_CONCAT(CONCAT(cf.name, ': ', ic.value) SEPARATOR ' | ') AS customFieldsText
       FROM InventoryCustomField ic
       JOIN CustomField cf ON cf.id = ic.customFieldId
       GROUP BY ic.inventoryId
     ) cfs ON cfs.inventoryId = i.id
     WHERE i.enabled = 1
       AND (
         m.name LIKE ? OR
         b.name LIKE ? OR
         t.name LIKE ? OR
         i.serialNumber LIKE ? OR
         i.activeNumber LIKE ? OR
         i.comments LIKE ? OR
         i.internalFolio LIKE ? OR
         inv.code LIKE ? OR
         po.code LIKE ? OR
         cfs.customFieldsText LIKE ?
       )
       ${whereSql}
     LIMIT ?`,
    [
      likeQ,
      likeQ,
      likeQ,
      likeQ,
      likeQ,
      likeQ,
      likeQ,
      likeQ,
      likeQ,
      likeQ,
      ...args,
      limit,
    ]
  );

  return rows.map((r, idx) => ({ score: 1.0 / (idx + 1), ...r }));
}

module.exports = { keywordSearchMySQL };
