// src/tradingEngine/RollingBuffer.ts
// High-performance circular buffer with lazy sort for percentile/VaR calculations
// Replaces O(n log n) per-tick with O(1) amortized, sorting only when needed

export class RollingBuffer {
  private data: Float64Array;
  private capacity: number;
  private head: number = 0;
  private count: number = 0;
  private sortedCache: number[] | null = null;
  private dirty: boolean = false;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float64Array(capacity);
  }

  // ─── Add value — O(1) ─────────────────────────────────────────────────────

  add(value: number): void {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.dirty = true;
    this.sortedCache = null;
  }

  // ─── Lazy sort — only when needed ─────────────────────────────────────────

  private ensureSorted(): number[] {
    if (!this.dirty && this.sortedCache) return this.sortedCache;
    const arr = this.toArray();
    arr.sort((a, b) => a - b);
    this.sortedCache = arr;
    this.dirty = false;
    return this.sortedCache;
  }

  // ─── Percentile — lazy O(n log n) amortized ──────────────────────────────

  getPercentile(percentile: number): number {
    if (this.count === 0) return 0;
    const sorted = this.ensureSorted();
    const index = Math.min(
      Math.floor(sorted.length * percentile),
      sorted.length - 1
    );
    return sorted[Math.max(0, index)];
  }

  // ─── VaR (Value at Risk) — historical method ─────────────────────────────

  getVaR(confidenceLevel: number): number {
    // VaR at 99% = loss at 1st percentile (negated)
    return -this.getPercentile(1.0 - confidenceLevel);
  }

  // ─── Expected Shortfall (CVaR) ────────────────────────────────────────────

  getExpectedShortfall(confidenceLevel: number): number {
    if (this.count === 0) return 0;
    const sorted = this.ensureSorted();
    const varIndex = Math.floor(sorted.length * (1.0 - confidenceLevel));
    if (varIndex <= 0) return sorted[0] ? -sorted[0] : 0;

    let sum = 0;
    for (let i = 0; i < varIndex; i++) {
      sum += sorted[i];
    }
    return -(sum / varIndex);
  }

  // ─── Rank of value — what percentile does this value fall at? ─────────────

  getRank(value: number): number {
    if (this.count === 0) return 0.5;
    const sorted = this.ensureSorted();
    let rank = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] <= value) rank++;
      else break;
    }
    return rank / sorted.length;
  }

  // ─── Basic statistics ─────────────────────────────────────────────────────

  mean(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    const arr = this.toArray();
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  variance(): number {
    if (this.count < 2) return 0;
    const m = this.mean();
    const arr = this.toArray();
    let sumSq = 0;
    for (let i = 0; i < arr.length; i++) {
      sumSq += (arr[i] - m) ** 2;
    }
    return sumSq / arr.length;
  }

  stdDev(): number {
    return Math.sqrt(this.variance());
  }

  min(): number {
    if (this.count === 0) return 0;
    const sorted = this.ensureSorted();
    return sorted[0];
  }

  max(): number {
    if (this.count === 0) return 0;
    const sorted = this.ensureSorted();
    return sorted[sorted.length - 1];
  }

  // ─── Get latest N values (most recent first) ─────────────────────────────

  latest(n: number = 1): number[] {
    const result: number[] = [];
    const limit = Math.min(n, this.count);
    for (let i = 0; i < limit; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      result.push(this.data[idx]);
    }
    return result;
  }

  // ─── Convert to plain array ───────────────────────────────────────────────

  toArray(): number[] {
    const result: number[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + this.capacity) % this.capacity;
      result[i] = this.data[idx];
    }
    return result;
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  size(): number {
    return this.count;
  }

  getCapacity(): number {
    return this.capacity;
  }

  isFull(): boolean {
    return this.count >= this.capacity;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.dirty = false;
    this.sortedCache = null;
  }
}

export default RollingBuffer;
