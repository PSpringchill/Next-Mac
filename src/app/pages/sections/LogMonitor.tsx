// src/components/Dashboard/LogMonitor.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Box, Paper, Typography, Button, Chip } from '@mui/material';
import { Download, Clear, Pause, PlayArrow } from '@mui/icons-material';
import { useMLEngine } from '../../api/MLContext';

interface LogEntry {
  timestamp: string;
  type: 'TRAINING' | 'FEATURE' | 'ERROR' | 'INFO';
  message: string;
  data?: any;
}

const LogMonitor: React.FC = () => {
  const { history } = useMLEngine();
  const [localLogs, setLocalLogs] = useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState<string>('ALL');
  const logContainerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!isPaused) {
      setLocalLogs(history.logs);
    }
  }, [history.logs, isPaused]);
  
  // Auto-scroll to bottom
  useEffect(() => {
    if (logContainerRef.current && !isPaused) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [localLogs, isPaused]);
  
  const downloadLogs = () => {
    const logText = localLogs.map(log => 
      `[${log.timestamp}] [${log.type}] ${log.message}${log.data ? '\n' + JSON.stringify(log.data, null, 2) : ''}`
    ).join('\n\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ml_logs_${new Date().toISOString()}.txt`;
    a.click();
  };
  
  const getLogColor = (type: string) => {
    switch (type) {
      case 'ERROR': return '#ff4444';
      case 'WARNING': return '#ffaa00';
      case 'FEATURE': return '#00ff88';
      case 'TRAINING': return '#00aaff';
      default: return '#ffffff';
    }
  };
  
  const filteredLogs = filter === 'ALL' 
    ? localLogs 
    : localLogs.filter(log => log.type === filter);
  
  return (
    <Paper sx={{ 
      p: 2, 
      bgcolor: '#0a0a0a',
      height: '500px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 2
      }}>
        <Typography variant="h6" sx={{ color: '#fff' }}>
          ML Training Logs
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          {['ALL', 'TRAINING', 'FEATURE', 'INFO', 'ERROR'].map(type => (
            <Chip
              key={type}
              label={type}
              onClick={() => setFilter(type)}
              color={filter === type ? 'primary' : 'default'}
              size="small"
            />
          ))}
          
          <Button
            startIcon={isPaused ? <PlayArrow /> : <Pause />}
            onClick={() => setIsPaused(!isPaused)}
            size="small"
          >
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          
          <Button
            startIcon={<Clear />}
            onClick={() => setLocalLogs([])}
            size="small"
          >
            Clear
          </Button>
          
          <Button
            startIcon={<Download />}
            onClick={downloadLogs}
            size="small"
          >
            Download
          </Button>
        </Box>
      </Box>
      
      <Box
        ref={logContainerRef}
        sx={{
          flex: 1,
          overflow: 'auto',
          bgcolor: '#000',
          p: 2,
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          borderRadius: 1,
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        {filteredLogs.map((log, index) => (
          <Box
            key={index}
            sx={{
              color: getLogColor(log.type),
              mb: 1,
              pb: 1,
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
            }}
          >
            <Box sx={{ opacity: 0.7 }}>
              [{log.timestamp}] [{log.type}]
            </Box>
            <Box sx={{ mt: 0.5 }}>{log.message}</Box>
            {log.data && (
              <Box sx={{
                mt: 0.5,
                ml: 2,
                opacity: 0.8,
                fontSize: '0.8rem'
              }}>
                <pre>{JSON.stringify(log.data, null, 2)}</pre>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default LogMonitor;