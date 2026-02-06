// src/components/Dashboard/DashboardCard.tsx
import React, { ReactNode, useState } from 'react';
import { 
  Paper, 
  Typography, 
  Box, 
  IconButton, 
  Collapse,
  Tooltip,
  PaperProps 
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Refresh,
  MoreVert,
  Fullscreen
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';

interface DashboardCardProps extends PaperProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  height?: string;
  collapsible?: boolean;
  onRefresh?: () => void;
  actions?: ReactNode;
  gradient?: boolean;
}

const StyledPaper = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'gradient'
})<{ gradient?: boolean }>(({ theme, gradient }) => ({
  padding: theme.spacing(1.5),
  background: gradient 
    ? 'linear-gradient(135deg, rgba(0, 255, 136, 0.05) 0%, rgba(0, 170, 255, 0.05) 100%)'
    : 'rgba(15, 17, 20, 0.85)',
  backdropFilter: 'blur(24px)',
  borderRadius: 20,
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: '0 25px 55px rgba(0, 0, 0, 0.65)',
  transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
  position: 'relative',
  overflow: 'hidden',
  '&:hover': {
    boxShadow: '0 30px 60px rgba(0, 0, 0, 0.75)',
    borderColor: 'rgba(0, 255, 136, 0.2)'
  },
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '2px',
    background: gradient
      ? 'linear-gradient(90deg, #00ff88, #00aaff)'
      : 'transparent'
  }
}));

const CardHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: theme.spacing(1),
  paddingBottom: theme.spacing(0.5),
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
}));

const CardActions = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(0.5)
}));

export const DashboardCard: React.FC<DashboardCardProps> = ({
  title,
  subtitle,
  children,
  height,
  collapsible = false,
  onRefresh,
  actions,
  gradient = false,
  sx,
  ...paperProps
}) => {
  const [expanded, setExpanded] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const handleExpand = () => {
    if (collapsible) {
      setExpanded(!expanded);
    }
  };

  const handleFullscreen = () => {
    // Implement fullscreen logic
    setFullscreen(!fullscreen);
  };

  return (
    <StyledPaper 
      gradient={gradient} 
      sx={{
        height: height || 'auto',
        minHeight: expanded ? height : 'auto',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...sx
      }} 
      {...paperProps}
    >
      {title && (
        <CardHeader sx={{ flex: '0 0 auto' }}>
          <Box>
            <Typography 
              variant="h6" 
              sx={{ 
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.85rem',
                letterSpacing: '0.02rem',
                textTransform: 'uppercase'
              }}
            >
              {title}
            </Typography>
            {subtitle && (
              <Typography 
                variant="caption" 
                sx={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.65rem' }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          
          <CardActions>
            {actions}
            
            {onRefresh && (
              <Tooltip title="Refresh">
                <IconButton 
                  size="small" 
                  onClick={onRefresh}
                  sx={{ color: 'rgba(255, 255, 255, 0.5)', p: 0.5 }}
                >
                  <Refresh sx={{ fontSize: '1rem' }} />
                </IconButton>
              </Tooltip>
            )}
            
            <Tooltip title="Fullscreen">
              <IconButton 
                size="small"
                onClick={handleFullscreen}
                sx={{ color: 'rgba(255, 255, 255, 0.5)', p: 0.5 }}
              >
                <Fullscreen sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
            
            {collapsible && (
              <Tooltip title={expanded ? "Collapse" : "Expand"}>
                <IconButton 
                  size="small"
                  onClick={handleExpand}
                  sx={{ color: 'rgba(255, 255, 255, 0.5)', p: 0.5 }}
                >
                  {expanded ? <ExpandLess sx={{ fontSize: '1rem' }} /> : <ExpandMore sx={{ fontSize: '1rem' }} />}
                </IconButton>
              </Tooltip>
            )}
            
            <Tooltip title="More options">
              <IconButton 
                size="small"
                sx={{ color: 'rgba(255, 255, 255, 0.5)', p: 0.5 }}
              >
                <MoreVert sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
          </CardActions>
        </CardHeader>
      )}
      
      <Collapse 
        in={expanded} 
        timeout="auto" 
        sx={{ 
          flex: height === '100%' ? '1 1 auto' : '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: height === '100%' ? '100%' : 'auto',
          '& .MuiCollapse-wrapper': { 
            height: height === '100%' ? '100%' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            flex: 1
          },
          '& .MuiCollapse-wrapperInner': { 
            height: height === '100%' ? '100%' : 'auto',
            display: 'flex', 
            flexDirection: 'column',
            flex: 1
          }
        }}
      >
        <Box sx={{ 
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100%'
        }}>
          {children}
        </Box>
      </Collapse>
    </StyledPaper>
  );
};