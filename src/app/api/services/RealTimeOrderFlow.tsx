// src/app/services/RealTimeOrderFlow.tsx
import React, { useEffect, useState, useRef } from 'react';
import { Box, Paper, Typography, Chip, CircularProgress } from '@mui/material';
import { BinanceWebSocketService } from './BinanceWebSocketService';
import { MLReinforcementLogger } from '../../components/TradingEngine/logging/MLReinforcementLogger';
interface OrderFlowEntry {
  time: Date;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  value: number;
  isLarge: boolean;
}

const RealTimeOrderFlow: React.FC = () => {
  const [orderFlow, setOrderFlow] = useState<OrderFlowEntry[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const wsService = useRef<BinanceWebSocketService | null>(null);
  const logger = useRef<MLReinforcementLogger | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Initialize services
    wsService.current = new BinanceWebSocketService('BTCUSDT');
    logger.current = new MLReinforcementLogger();
    
    // Set up event listeners
    wsService.current.on('connected', () => {
      setIsConnected(true);
      setIsLoading(false);
      console.log('Connected to Binance');
    });
    
    wsService.current.on('trade', (trade: any) => {
      const entry: OrderFlowEntry = {
        time: trade.time,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        value: trade.price * trade.size,
        isLarge: (trade.price * trade.size) > 50000 // Flag trades > $50k
      };
      
      setOrderFlow(prev => {
        const newFlow = [entry, ...prev].slice(0, 100); // Keep last 100 trades
        return newFlow;
      });
      
      // Log significant trades
      if (entry.isLarge) {
        logger.current?.log('Large trade detected', entry, 'TRADE');
      }
    });
    
    wsService.current.on('orderFlow', (data: any) => {
      setMetrics(data.metrics);
      
      // Log flow metrics for ML analysis
      logger.current?.log('Order flow metrics', data.metrics, 'METRICS');
    });
    
    wsService.current.on('largeTrade', (trade: any) => {
      console.log('🐋 Whale alert:', trade);
      
      // Log whale trades for pattern analysis
      logger.current?.log('Whale trade', trade, 'WHALE');
    });
    
    wsService.current.on('error', (error: any) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    });
    
    // Connect to Binance
    wsService.current.connect();
    
    // Cleanup
    return () => {
      wsService.current?.disconnect();
      logger.current?.close();
    };
  }, []);
  
  // Auto-scroll to top when new trades come in
  useEffect(() => {
    if (containerRef.current && orderFlow.length > 0) {
      containerRef.current.scrollTop = 0;
    }
  }, [orderFlow]);
  
  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };
  
  const formatPrice = (price: number): string => {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    });
  };
  
  const formatSize = (size: number): string => {
    return size.toFixed(4);
  };
  
  return (
    <Paper sx={{ 
      p: 2, 
      bgcolor: '#0a0a0a',
      height: '600px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 2,
        pb: 1,
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <Typography variant="h6" sx={{ color: '#fff' }}>
          Order Flow - BTCUSDT
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {isLoading ? (
            <CircularProgress size={20} />
          ) : (
            <Chip
              label={isConnected ? 'LIVE' : 'DISCONNECTED'}
              size="small"
              sx={{
                bgcolor: isConnected ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 68, 68, 0.1)',
                color: isConnected ? '#00ff88' : '#ff4444',
                border: `1px solid ${isConnected ? '#00ff88' : '#ff4444'}`
              }}
              icon={
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: isConnected ? '#00ff88' : '#ff4444',
                    animation: isConnected ? 'pulse 2s infinite' : 'none'
                  }}
                />
              }
            />
          )}
        </Box>
      </Box>
      
      {/* Metrics Bar */}
      {metrics && (
        <Box sx={{ 
          display: 'flex', 
          gap: 2,
          mb: 2,
          p: 1,
          bgcolor: 'rgba(255, 255, 255, 0.02)',
          borderRadius: 1
        }}>
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              Flow Imbalance
            </Typography>
            <Typography 
              variant="body2" 
              sx={{ 
                color: metrics.flowImbalance > 0 ? '#00ff88' : '#ff4444',
                fontWeight: 'bold'
              }}
            >
              {(metrics.flowImbalance * 100).toFixed(2)}%
            </Typography>
          </Box>
          
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              Buy Ratio
            </Typography>
            <Typography variant="body2" sx={{ color: '#00ff88' }}>
              {(metrics.buyRatio * 100).toFixed(1)}%
            </Typography>
          </Box>
          
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              VWAP
            </Typography>
            <Typography variant="body2" sx={{ color: '#fff' }}>
              ${formatPrice(metrics.vwap)}
            </Typography>
          </Box>
          
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              Volume (100 trades)
            </Typography>
            <Typography variant="body2" sx={{ color: '#fff' }}>
              {metrics.totalVolume.toFixed(2)} BTC
            </Typography>
          </Box>
        </Box>
      )}
      
      {/* Order Flow Table Header */}
      <Box sx={{ 
        display: 'grid',
        gridTemplateColumns: '120px 80px 120px 100px',
        gap: 2,
        px: 2,
        py: 1,
        bgcolor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '4px 4px 0 0'
      }}>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
          TIME
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
          SIDE
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)', textAlign: 'right' }}>
          PRICE
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)', textAlign: 'right' }}>
          SIZE
        </Typography>
      </Box>
      
      {/* Order Flow List */}
      <Box 
        ref={containerRef}
        sx={{ 
          flex: 1,
          overflow: 'auto',
          '&::-webkit-scrollbar': {
            width: 8
          },
          '&::-webkit-scrollbar-track': {
            bgcolor: 'rgba(255, 255, 255, 0.05)'
          },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: 4
          }
        }}
      >
        {orderFlow.length === 0 && !isLoading ? (
          <Box sx={{ 
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            color: 'rgba(255, 255, 255, 0.3)'
          }}>
            Waiting for trades...
          </Box>
        ) : (
          orderFlow.map((trade, index) => (
            <Box
              key={index}
              sx={{
                display: 'grid',
                gridTemplateColumns: '120px 80px 120px 100px',
                gap: 2,
                px: 2,
                py: 1,
                bgcolor: trade.isLarge ? 'rgba(255, 170, 0, 0.05)' : 'transparent',
                borderLeft: trade.isLarge ? '2px solid #ffaa00' : 'none',
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.02)'
                },
                animation: index === 0 ? 'slideIn 0.3s ease' : 'none'
              }}
            >
              <Typography variant="body2" sx={{ 
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: 'monospace',
                fontSize: '0.85rem'
              }}>
                {formatTime(trade.time)}
              </Typography>
              
              <Chip
                label={trade.side}
                size="small"
                sx={{
                  bgcolor: trade.side === 'BUY' 
                    ? 'rgba(0, 255, 136, 0.1)' 
                    : 'rgba(255, 68, 68, 0.1)',
                  color: trade.side === 'BUY' ? '#00ff88' : '#ff4444',
                  fontSize: '0.75rem',
                  height: 20,
                  fontWeight: 'bold'
                }}
              />
              
              <Typography variant="body2" sx={{ 
                color: '#fff',
                textAlign: 'right',
                fontFamily: 'monospace'
              }}>
                ${formatPrice(trade.price)}
              </Typography>
              
              <Typography variant="body2" sx={{ 
                color: trade.isLarge ? '#ffaa00' : 'rgba(255, 255, 255, 0.8)',
                textAlign: 'right',
                fontFamily: 'monospace',
                fontWeight: trade.isLarge ? 'bold' : 'normal'
              }}>
                {formatSize(trade.size)}
                {trade.isLarge && ' 🐋'}
              </Typography>
            </Box>
          ))
        )}
      </Box>
      
      <style jsx global>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </Paper>
  );
};

export default RealTimeOrderFlow;