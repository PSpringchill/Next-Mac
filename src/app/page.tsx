'use client';
import React, { useState, useRef } from 'react';
import Image from 'next/image';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Card } from './components/MacOsDock/Card/Page';
import { Dock } from './components/MacOsDock/Dock/Page';
import { DockCard } from './components/MacOsDock/DockCard/Page';
import { DockDivider } from './components/MacOsDock/DockDivider/Page';
import DateTimeCard from './components/DateTimeCard/DateTimeCard';
import { OrderBookProvider } from './api/Page';
import MessageHub, { AddFunction } from './notification';
import { loremIpsum } from 'lorem-ipsum';
import DashboardLayout from './pages/DashboardLayout';

const GRADIENTS = [
  './contract1.png',
  './contract2.png',
  './data-analysis.png',
  './report.png',
  './emotion-recognition.png',
  './dart-board.png',
  './illustrator.png',
];

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00ff88',
    },
    secondary: {
      main: '#00aaff',
    },
    background: {
      default: '#000000',
      paper: 'rgba(15, 17, 20, 0.85)',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: '#6b6b6b #2b2b2b',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 8,
            backgroundColor: '#6b6b6b',
            border: '2px solid #2b2b2b',
          },
          '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
            borderRadius: 8,
            backgroundColor: '#2b2b2b',
          },
        },
        '@keyframes fadeIn': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      },
    },
  },
});

export default function Home() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <OrderBookProvider>
        <DashboardLayout />
      </OrderBookProvider>

    </ThemeProvider>
  );
}
