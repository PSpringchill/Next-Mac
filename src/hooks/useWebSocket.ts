import { useEffect, useRef, useCallback } from 'react';
import { useTradingStore } from '@stores/tradingStore';

interface WebSocketOptions {
  url: string;
  onMessage?: (data: any) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnectInterval?: number;
}

export const useWebSocket = ({
  url,
  onMessage,
  onError,
  onOpen,
  onClose,
  reconnectInterval = 5000
}: WebSocketOptions) => {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const updateOrderBook = useTradingStore((state) => state.updateOrderBook);

  const connect = useCallback(() => {
    try {
      ws.current = new WebSocket(url);

      ws.current.onopen = () => {
        console.log('WebSocket connected');
        onOpen?.();
      };

      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Update store with order book data
        if (data.bids && data.asks) {
          updateOrderBook(data);
        }
        
        onMessage?.(data);
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        onError?.(error);
      };

      ws.current.onclose = () => {
        console.log('WebSocket disconnected');
        onClose?.();
        
        // Attempt to reconnect
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval);
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }, [url, onMessage, onError, onOpen, onClose, reconnectInterval, updateOrderBook]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  }, []);

  return { sendMessage };
};
