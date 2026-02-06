import React, { useContext, useMemo, useState, useEffect } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { OrderBookContext } from '../../api/Page';

const OrderFlowSection: React.FC = () => {
  const context = useContext(OrderBookContext);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const orders = useMemo(() => {
    if (!context?.orderBookData) return [];

    const bids = context.orderBookData.bids.slice(0, 10);
    const asks = context.orderBookData.asks.slice(0, 10);
    
    // Combine and sort by "time" (simulated by sequence)
    const combined = [
      ...bids.map((b, i) => ({ side: 'BUY', price: parseFloat(b[0]), size: parseFloat(b[1]), time: i })),
      ...asks.map((a, i) => ({ side: 'SELL', price: parseFloat(a[0]), size: parseFloat(a[1]), time: i }))
    ].sort((a, b) => a.time - b.time);

    return combined.map(o => ({
      ...o,
      price: o.price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
      size: o.size.toFixed(4),
      time: mounted ? new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
    }));
  }, [context?.orderBookData, mounted]);

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        pb: 1,
        mb: 2,
        borderBottom: '1px solid rgba(255,255,255,0.05)'
      }}>
        <Typography variant="subtitle2" sx={{ color: '#fff', fontWeight: 800 }}>
          ORDER FLOW
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontFamily: 'monospace' }}>
          LIVE FEED
        </Typography>
      </Box>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ 
                color: 'rgba(255,255,255,0.4)', 
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.65rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                p: 1
              }}>Time</TableCell>
              <TableCell sx={{ 
                color: 'rgba(255,255,255,0.4)', 
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.65rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                p: 1
              }}>Side</TableCell>
              <TableCell sx={{ 
                color: 'rgba(255,255,255,0.4)', 
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.65rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                p: 1
              }}>Price</TableCell>
              <TableCell align="right" sx={{ 
                color: 'rgba(255,255,255,0.4)', 
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.65rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                p: 1
              }}>Size</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((order, index) => (
              <TableRow 
                key={index}
                sx={{ 
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
                  transition: 'background-color 0.2s'
                }}
              >
                <TableCell sx={{ 
                  color: 'rgba(255,255,255,0.6)', 
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  p: 1
                }}>{order.time}</TableCell>
                <TableCell sx={{ 
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  p: 1
                }}>
                  <Box sx={{ 
                    display: 'inline-block',
                    px: 0.75,
                    py: 0.15,
                    borderRadius: 0.5,
                    bgcolor: order.side === 'BUY' ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 68, 68, 0.1)',
                    color: order.side === 'BUY' ? '#00ff88' : '#ff4444',
                    fontWeight: 800,
                    fontSize: '0.65rem'
                  }}>
                    {order.side}
                  </Box>
                </TableCell>
                <TableCell sx={{ 
                  color: '#fff', 
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  p: 1
                }}>{order.price}</TableCell>
                <TableCell align="right" sx={{ 
                  color: '#fff', 
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  p: 1
                }}>{order.size}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
};

export default OrderFlowSection;