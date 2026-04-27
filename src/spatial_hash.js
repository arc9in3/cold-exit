export class SpatialHash2D {
  constructor(cellSize = 5) {
    this.cellSize = cellSize;
    this._invCellSize = 1 / cellSize;
    this._cells = new Map();
    this._marks = new WeakMap();
    this._queryStamp = 0;
  }

  clear() {
    this._cells.clear();
  }

  _cellKey(cellX, cellZ) {
    return ((cellX + 32768) << 16) | ((cellZ + 32768) & 0xffff);
  }

  rebuildAabbs(items, getBounds) {
    this.clear();
    for (const item of items) {
      const bounds = getBounds(item);
      if (!bounds) continue;
      const minCellX = Math.floor(bounds.minX * this._invCellSize);
      const maxCellX = Math.floor(bounds.maxX * this._invCellSize);
      const minCellZ = Math.floor(bounds.minZ * this._invCellSize);
      const maxCellZ = Math.floor(bounds.maxZ * this._invCellSize);
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          const key = this._cellKey(cellX, cellZ);
          let bucket = this._cells.get(key);
          if (!bucket) {
            bucket = [];
            this._cells.set(key, bucket);
          }
          bucket.push(item);
        }
      }
    }
  }

  rebuildPoints(items, getPoint) {
    this.clear();
    for (const item of items) {
      const point = getPoint(item);
      if (!point) continue;
      const cellX = Math.floor(point.x * this._invCellSize);
      const cellZ = Math.floor(point.z * this._invCellSize);
      const key = this._cellKey(cellX, cellZ);
      let bucket = this._cells.get(key);
      if (!bucket) {
        bucket = [];
        this._cells.set(key, bucket);
      }
      bucket.push(item);
    }
  }

  queryAabb(minX, maxX, minZ, maxZ, out) {
    out.length = 0;
    const stamp = ++this._queryStamp;
    const minCellX = Math.floor(minX * this._invCellSize);
    const maxCellX = Math.floor(maxX * this._invCellSize);
    const minCellZ = Math.floor(minZ * this._invCellSize);
    const maxCellZ = Math.floor(maxZ * this._invCellSize);
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const bucket = this._cells.get(this._cellKey(cellX, cellZ));
        if (!bucket) continue;
        for (const item of bucket) {
          if (this._marks.get(item) === stamp) continue;
          this._marks.set(item, stamp);
          out.push(item);
        }
      }
    }
    return out;
  }
}
