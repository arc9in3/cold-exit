function overlapsAabb(a, minX, maxX, minZ, maxZ) {
  return !(a.maxX < minX || a.minX > maxX || a.maxZ < minZ || a.minZ > maxZ);
}

export class StaticObstacleGrid2D {
  constructor(cellSize = 5) {
    this.cellSize = cellSize;
    this._invCellSize = 1 / cellSize;
    this.clear();
  }

  clear() {
    this._items = [];
    this._buckets = [];
    this._marks = new Uint32Array(0);
    this._stamp = 0;
    this._minX = 0;
    this._minZ = 0;
    this._maxX = 0;
    this._maxZ = 0;
    this._cols = 0;
    this._rows = 0;
  }

  rebuild(items, getBounds) {
    const indexed = [];
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const item of items) {
      const bounds = getBounds(item);
      if (!bounds) continue;
      indexed.push({ item, bounds });
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minZ < minZ) minZ = bounds.minZ;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxZ > maxZ) maxZ = bounds.maxZ;
    }
    if (!indexed.length) {
      this.clear();
      return;
    }

    this._minX = minX;
    this._minZ = minZ;
    this._maxX = maxX;
    this._maxZ = maxZ;
    this._cols = Math.max(1, Math.floor((maxX - minX) * this._invCellSize) + 1);
    this._rows = Math.max(1, Math.floor((maxZ - minZ) * this._invCellSize) + 1);
    this._items = indexed;
    this._buckets = Array.from({ length: this._cols * this._rows }, () => []);
    this._marks = new Uint32Array(indexed.length);
    this._stamp = 0;

    for (let i = 0; i < indexed.length; i++) {
      const { bounds } = indexed[i];
      const minCellX = this._cellX(bounds.minX);
      const maxCellX = this._cellX(bounds.maxX);
      const minCellZ = this._cellZ(bounds.minZ);
      const maxCellZ = this._cellZ(bounds.maxZ);
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        let offset = cellZ * this._cols;
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          this._buckets[offset + cellX].push(i);
        }
      }
    }
  }

  queryAabb(minX, maxX, minZ, maxZ, out) {
    out.length = 0;
    if (!this._items.length) return out;
    if (maxX < this._minX || minX > this._maxX || maxZ < this._minZ || minZ > this._maxZ) {
      return out;
    }
    const minCellX = this._clampCellX(this._cellX(minX));
    const maxCellX = this._clampCellX(this._cellX(maxX));
    const minCellZ = this._clampCellZ(this._cellZ(minZ));
    const maxCellZ = this._clampCellZ(this._cellZ(maxZ));
    let stamp = this._stamp + 1;
    if (stamp === 0xffffffff) {
      this._marks.fill(0);
      stamp = 1;
    }
    this._stamp = stamp;
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      let offset = cellZ * this._cols;
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const bucket = this._buckets[offset + cellX];
        for (let j = 0; j < bucket.length; j++) {
          const idx = bucket[j];
          if (this._marks[idx] === stamp) continue;
          this._marks[idx] = stamp;
          const entry = this._items[idx];
          if (!overlapsAabb(entry.bounds, minX, maxX, minZ, maxZ)) continue;
          out.push(entry.item);
        }
      }
    }
    return out;
  }

  _cellX(x) {
    return Math.floor((x - this._minX) * this._invCellSize);
  }

  _cellZ(z) {
    return Math.floor((z - this._minZ) * this._invCellSize);
  }

  _clampCellX(cellX) {
    if (cellX < 0) return 0;
    if (cellX >= this._cols) return this._cols - 1;
    return cellX;
  }

  _clampCellZ(cellZ) {
    if (cellZ < 0) return 0;
    if (cellZ >= this._rows) return this._rows - 1;
    return cellZ;
  }
}
