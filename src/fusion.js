function rrfFuse(arrays, k = 60) {
  const map = new Map(); // id -> score
  arrays.forEach((arr) => {
    arr.forEach((item, rank) => {
      const id = String(item.id);
      const add = 1.0 / (k + rank + 1);
      map.set(id, (map.get(id) || 0) + add);
    });
  });
  const byId = new Map();
  arrays.flat().forEach(x => { if (x && !byId.has(String(x.id))) byId.set(String(x.id), x); });
  return Array.from(map.entries())
    .sort((a,b) => b[1]-a[1])
    .map(([id]) => byId.get(id));
}

module.exports = { rrfFuse };