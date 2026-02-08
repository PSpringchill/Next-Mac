// ─── ECAM Color Constants (Airbus standard) ───
export const ECAM = {
  RED: '#ff2222',
  AMBER: '#ffaa00',
  GREEN: '#00ff88',
  CYAN: '#00ddff',
  WHITE: '#e0e0e0',
  MAGENTA: '#ff44ff',
  DIM: 'rgba(255,255,255,0.35)',
  BG: '#0a0a0f',
  PANEL: 'rgba(12,14,20,0.92)',
  BORDER: 'rgba(255,255,255,0.06)',
};

export type Severity = 'warning' | 'caution' | 'memo';

export interface EcamMessage {
  severity: Severity;
  system: string;
  text: string;
}

export interface ChecklistItem {
  action: string;
  status: 'todo' | 'done' | 'na';
  key: string;
}

export interface WallData {
  price: number;
  size: number;
  notional: number;
  distancePct: number;
}

export interface SmoothedTechData {
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPct: number;
  obi: number;
  totalDepth: number;
  imbalance: number;
  liquidity: number;
  wallStrength: number;
  vwap: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macd: number;
  sellWallNotional: number;
  buyWallNotional: number;
  maxWallNotional: number;
  sellWalls: WallData[];
  buyWalls: WallData[];
  nearestSellWallPct: number | null;
  nearestBuyWallPct: number | null;
  signal: string;
  heikinAshi: boolean | undefined;
}

export interface VolumeBin {
  price: number;
  bidVol: number;
  askVol: number;
}

export interface FeatureWeight {
  label: string;
  value: number;
}

export const severityColor = (s: Severity) =>
  s === 'warning' ? ECAM.RED : s === 'caution' ? ECAM.AMBER : ECAM.GREEN;

export const severityOrder = (s: Severity) =>
  s === 'warning' ? 0 : s === 'caution' ? 1 : 2;
