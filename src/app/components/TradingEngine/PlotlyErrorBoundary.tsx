'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button } from '@mui/material';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class PlotlyErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Plotly Error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <Box sx={{ 
          p: 3, 
          textAlign: 'center', 
          bgcolor: 'rgba(255, 68, 68, 0.05)', 
          borderRadius: 2,
          border: '1px solid rgba(255, 68, 68, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: '200px'
        }}>
          <Typography variant="body2" color="error" gutterBottom sx={{ fontWeight: 700 }}>
            Visualization Error
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', mb: 2, display: 'block' }}>
            {this.state.error?.message || 'Failed to load chart'}
          </Typography>
          <Button 
            size="small" 
            variant="outlined" 
            color="primary"
            onClick={() => this.setState({ hasError: false })}
            sx={{ fontSize: '0.6rem' }}
          >
            Retry Loading
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default PlotlyErrorBoundary;
