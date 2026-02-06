import { Experience } from '@tradingEngine/types';

export class CircularBuffer<T> {
  private buffer: T[];
  private pointer: number = 0;
  private size: number;
  private filled: boolean = false;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size);
  }

  push(item: T): void {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.size;
    if (this.pointer === 0) this.filled = true;
  }

  get(index: number): T | undefined {
    if (!this.filled && index >= this.pointer) return undefined;
    return this.buffer[(this.pointer - 1 - index + this.size) % this.size];
  }

  toArray(): T[] {
    if (!this.filled) return this.buffer.slice(0, this.pointer);
    return [...this.buffer.slice(this.pointer), ...this.buffer.slice(0, this.pointer)];
  }

  isFull(): boolean {
    return this.filled;
  }

  clear(): void {
    this.pointer = 0;
    this.filled = false;
    this.buffer = new Array(this.size);
  }
}

export class ReplayBuffer {
  private buffer: Experience[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  add(experience: Experience): void {
    this.buffer.push(experience);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  sample(batchSize: number): Experience[] {
    const samples: Experience[] = [];
    const indices = new Set<number>();
    
    while (indices.size < Math.min(batchSize, this.buffer.length)) {
      indices.add(Math.floor(Math.random() * this.buffer.length));
    }
    
    indices.forEach(i => samples.push(this.buffer[i]));
    return samples;
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}

export class ShortTermMemory extends ReplayBuffer {
  private timeWindow: number;
  private timestamps: number[] = [];

  constructor(maxSize: number, timeWindow: number = 5000) {
    super(maxSize);
    this.timeWindow = timeWindow;
  }

  add(experience: Experience): void {
    super.add(experience);
    this.timestamps.push(Date.now());
    this.pruneOldExperiences();
  }

  private pruneOldExperiences(): void {
    const now = Date.now();
    while (this.timestamps.length > 0 && now - this.timestamps[0] > this.timeWindow) {
      this.timestamps.shift();
      // Remove oldest experience
      this.sample(this.size() - 1);
    }
  }
}
