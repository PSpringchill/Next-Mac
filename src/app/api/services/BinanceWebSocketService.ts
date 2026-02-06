// src/services/BinanceWebSocketService.ts
import { EventEmitter } from 'events';

interface OrderBookUpdate {
  e: string;          // Event type
  E: number;          // Event time
  s: string;          // Symbol
  U: number;          // First update ID
  u: number;          // Final update ID
  b: [string, string][]; // Bids [price, quantity]
  a: [string, string][]; // Asks [price, quantity]
}

interface TradeUpdate {
  e: string;          // Event type
  E: number;          // Event time
  s: string;          // Symbol
  p: string;          // Price
  q: string;          // Quantity
  b: number;          // Buyer order ID
  a: number;          // Seller order ID
  T: number;          // Trade time
  m: boolean;         // Is buyer maker
}

interface AggTradeUpdate {
  e: string;          // Event type
  E: number;          // Event time
  s: string;          // Symbol
  p: string;          // Price
  q: string;          // Quantity
  f: number;          // First trade ID
  l: number;          // Last trade ID
  T: number;          // Trade time
  m: boolean;         // Is buyer maker
}

export class BinanceWebSocketService extends EventEmitter {
  private ws: WebSocket | null = null;
  private symbol: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  
  // Data storage for analysis
  private orderBook: {
    bids: Map<string, number>;
    asks: Map<string, number>;
    lastUpdateId: number;
  };
  
  private recentTrades: TradeUpdate[] = [];
  private orderFlow: Array<{
    time: Date;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    aggressor: 'BUYER' | 'SELLER';
  }> = [];
  
  constructor(symbol: string = 'BTCUSDT') {
    super();
    this.symbol = symbol.toLowerCase();
    this.orderBook = {
      bids: new Map(),
      asks: new Map(),
      lastUpdateId: 0
    };
  }
  
  public connect(): void {
    try {
      // Multiple streams: depth, trades, aggTrades
      const streams = [
        `${this.symbol}@depth@100ms`,      // Order book updates
        `${this.symbol}@trade`,             // Individual trades
        `${this.symbol}@aggTrade`,          // Aggregated trades
        `${this.symbol}@bookTicker`         // Best bid/ask
      ].join('/');
      
      const wsUrl = `wss://fstream.binance.com/stream?streams=${streams}`;
      
      console.log(`Connecting to Binance WebSocket: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('✅ Connected to Binance WebSocket');
        this.reconnectAttempts = 0;
        
        // Start ping to keep connection alive
        this.startPing();
        
        // Initialize order book with REST API snapshot
        this.initializeOrderBook();
        
        this.emit('connected');
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.stream) {
            const [symbol, streamType] = message.stream.split('@');
            const data = message.data;
            
            switch (streamType) {
              case 'depth':
              case 'depth@100ms':
                this.handleOrderBookUpdate(data);
                break;
              case 'trade':
                this.handleTradeUpdate(data);
                break;
              case 'aggTrade':
                this.handleAggTradeUpdate(data);
                break;
              case 'bookTicker':
                this.handleBookTickerUpdate(data);
                break;
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          this.emit('error', error);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.stopPing();
        this.reconnect();
      };
      
    } catch (error) {
      console.error('Failed to connect:', error);
      this.emit('error', error);
    }
  }
  
  private async initializeOrderBook(): Promise<void> {
    try {
      // Get order book snapshot from REST API
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/depth?symbol=${this.symbol.toUpperCase()}&limit=100`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch order book: ${response.statusText}`);
      }
      
      const snapshot = await response.json();
      
      // Clear and rebuild order book
      this.orderBook.bids.clear();
      this.orderBook.asks.clear();
      
      // Add bids
      snapshot.bids.forEach(([price, quantity]: [string, string]) => {
        this.orderBook.bids.set(price, parseFloat(quantity));
      });
      
      // Add asks
      snapshot.asks.forEach(([price, quantity]: [string, string]) => {
        this.orderBook.asks.set(price, parseFloat(quantity));
      });
      
      this.orderBook.lastUpdateId = snapshot.lastUpdateId;
      
      console.log(`Order book initialized with ${this.orderBook.bids.size} bids and ${this.orderBook.asks.size} asks`);
      
      // Emit initial state
      this.emitOrderBookState();
      
    } catch (error) {
      console.error('Failed to initialize order book:', error);
      this.emit('error', error);
    }
  }
  
  private handleOrderBookUpdate(data: OrderBookUpdate): void {
    // Skip if update is older than our snapshot
    if (data.u <= this.orderBook.lastUpdateId) {
      return;
    }
    
    // Update bids
    data.b.forEach(([price, quantity]) => {
      const qty = parseFloat(quantity);
      if (qty === 0) {
        this.orderBook.bids.delete(price);
      } else {
        this.orderBook.bids.set(price, qty);
      }
    });
    
    // Update asks
    data.a.forEach(([price, quantity]) => {
      const qty = parseFloat(quantity);
      if (qty === 0) {
        this.orderBook.asks.delete(price);
      } else {
        this.orderBook.asks.set(price, qty);
      }
    });
    
    this.orderBook.lastUpdateId = data.u;
    
    // Calculate metrics for ML
    const metrics = this.calculateOrderBookMetrics();
    
    // Emit updates
    this.emit('orderBookUpdate', {
      bids: Array.from(this.orderBook.bids.entries())
        .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
        .slice(0, 20),
      asks: Array.from(this.orderBook.asks.entries())
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
        .slice(0, 20),
      metrics,
      timestamp: data.E
    });
  }
  
  private handleTradeUpdate(data: TradeUpdate): void {
    const trade = {
      time: new Date(data.T),
      side: data.m ? 'SELL' as const : 'BUY' as const,  // If buyer is maker, it's a sell
      price: parseFloat(data.p),
      size: parseFloat(data.q),
      aggressor: data.m ? 'SELLER' as const : 'BUYER' as const
    };
    
    // Add to order flow
    this.orderFlow.push(trade);
    
    // Keep only last 1000 trades
    if (this.orderFlow.length > 1000) {
      this.orderFlow.shift();
    }
    
    // Store recent trades for analysis
    this.recentTrades.push(data);
    if (this.recentTrades.length > 100) {
      this.recentTrades.shift();
    }
    
    // Emit trade update
    this.emit('trade', trade);
    
    // Calculate flow metrics
    const flowMetrics = this.calculateOrderFlowMetrics();
    this.emit('orderFlow', {
      trade,
      metrics: flowMetrics,
      timestamp: data.E
    });
  }
  
  private handleAggTradeUpdate(data: AggTradeUpdate): void {
    // Large trades are important for ML
    const size = parseFloat(data.q);
    const price = parseFloat(data.p);
    const value = size * price;
    
    // Flag large trades (e.g., > $100k)
    if (value > 100000) {
      this.emit('largeTrade', {
        price,
        size,
        value,
        side: data.m ? 'SELL' : 'BUY',
        timestamp: data.T
      });
      
      console.log(`🐋 Large trade detected: ${data.m ? 'SELL' : 'BUY'} ${size} @ ${price.toFixed(4)} ($${value.toFixed(2)})`);
    }
  }
  
  private handleBookTickerUpdate(data: any): void {
    this.emit('bestBidAsk', {
      bestBid: parseFloat(data.b),
      bestBidQty: parseFloat(data.B),
      bestAsk: parseFloat(data.a),
      bestAskQty: parseFloat(data.A),
      timestamp: data.E
    });
  }
  
  private calculateOrderBookMetrics(): any {
    const bids = Array.from(this.orderBook.bids.entries());
    const asks = Array.from(this.orderBook.asks.entries());
    
    if (bids.length === 0 || asks.length === 0) {
      return null;
    }
    
    // Sort order book
    bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    
    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    
    // Calculate various metrics
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / bestAsk) * 100;
    
    // Volume at different levels
    const bidVolume5 = bids.slice(0, 5).reduce((sum, [_, qty]) => sum + qty, 0);
    const askVolume5 = asks.slice(0, 5).reduce((sum, [_, qty]) => sum + qty, 0);
    const bidVolume10 = bids.slice(0, 10).reduce((sum, [_, qty]) => sum + qty, 0);
    const askVolume10 = asks.slice(0, 10).reduce((sum, [_, qty]) => sum + qty, 0);
    
    // Order book imbalance
    const imbalance5 = (bidVolume5 - askVolume5) / (bidVolume5 + askVolume5);
    const imbalance10 = (bidVolume10 - askVolume10) / (bidVolume10 + askVolume10);
    
    // Depth metrics
    const bidDepth = this.calculateDepth(bids, bestBid, 0.001); // 0.1% depth
    const askDepth = this.calculateDepth(asks, bestAsk, 0.001);
    
    return {
      spread,
      spreadPercent,
      midPrice: (bestBid + bestAsk) / 2,
      imbalance5,
      imbalance10,
      bidVolume5,
      askVolume5,
      bidVolume10,
      askVolume10,
      bidDepth,
      askDepth,
      volumeRatio: bidVolume10 / (askVolume10 || 1),
      microPrice: this.calculateMicroPrice(bids, asks)
    };
  }
  
  private calculateDepth(orders: Array<[string, number]>, refPrice: number, percent: number): number {
    const threshold = refPrice * percent;
    let totalVolume = 0;
    
    for (const [price, qty] of orders) {
      const p = parseFloat(price);
      if (Math.abs(p - refPrice) > threshold) break;
      totalVolume += qty;
    }
    
    return totalVolume;
  }
  
  private calculateMicroPrice(bids: Array<[string, number]>, asks: Array<[string, number]>): number {
    if (bids.length === 0 || asks.length === 0) return 0;
    
    const bestBid = parseFloat(bids[0][0]);
    const bestBidQty = bids[0][1];
    const bestAsk = parseFloat(asks[0][0]);
    const bestAskQty = asks[0][1];
    
    // Volume-weighted mid price
    return (bestBid * bestAskQty + bestAsk * bestBidQty) / (bestBidQty + bestAskQty);
  }
  
  private calculateOrderFlowMetrics(): any {
    const recentTrades = this.orderFlow.slice(-100);
    
    if (recentTrades.length === 0) {
      return null;
    }
    
    const buyVolume = recentTrades
      .filter(t => t.side === 'BUY')
      .reduce((sum, t) => sum + t.size, 0);
    
    const sellVolume = recentTrades
      .filter(t => t.side === 'SELL')
      .reduce((sum, t) => sum + t.size, 0);
    
    const totalVolume = buyVolume + sellVolume;
    const flowImbalance = (buyVolume - sellVolume) / (totalVolume || 1);
    
    // VWAP calculation
    let vwapNumerator = 0;
    let vwapDenominator = 0;
    recentTrades.forEach(trade => {
      vwapNumerator += trade.price * trade.size;
      vwapDenominator += trade.size;
    });
    const vwap = vwapDenominator > 0 ? vwapNumerator / vwapDenominator : 0;
    
    // Trade size distribution
    const sizes = recentTrades.map(t => t.size);
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const maxSize = Math.max(...sizes);
    
    return {
      buyVolume,
      sellVolume,
      totalVolume,
      flowImbalance,
      vwap,
      avgTradeSize: avgSize,
      maxTradeSize: maxSize,
      tradeCount: recentTrades.length,
      buyRatio: buyVolume / (totalVolume || 1),
      sellRatio: sellVolume / (totalVolume || 1)
    };
  }
  
  private emitOrderBookState(): void {
    const bids = Array.from(this.orderBook.bids.entries())
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
      .slice(0, 20)
      .map(([price, qty]) => [price, qty.toString()]);
    
    const asks = Array.from(this.orderBook.asks.entries())
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .slice(0, 20)
      .map(([price, qty]) => [price, qty.toString()]);
    
    this.emit('orderBookSnapshot', {
      bids,
      asks,
      lastUpdateId: this.orderBook.lastUpdateId
    });
  }
  
  public getOrderFlow(): Array<any> {
    return this.orderFlow.slice(-50); // Get last 50 trades for display
  }
  
  public getOrderBookSnapshot(): any {
    const bids = Array.from(this.orderBook.bids.entries())
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
      .slice(0, 20);
    
    const asks = Array.from(this.orderBook.asks.entries())
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .slice(0, 20);
    
    return {
      bids: bids.map(([price, qty]) => [price, qty.toString()]),
      asks: asks.map(([price, qty]) => [price, qty.toString()]),
      lastUpdateId: this.orderBook.lastUpdateId
    };
  }
  
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, 30000); // Ping every 30 seconds
  }
  
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }
  
  public disconnect(): void {
    this.stopPing();
    if (this.ws) {  
      this.ws.close();
      this.ws = null;
    }
  }
}