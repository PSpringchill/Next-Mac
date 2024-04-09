'use client';
import React, { useState, useRef } from 'react';
import Image from 'next/image';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import { Card } from './components/MacOsDock/Card/Page';
import { Dock } from './components/MacOsDock/Dock/Page';
import { DockCard } from './components/MacOsDock/DockCard/Page';
import { DockDivider } from './components/MacOsDock/DockDivider/Page';
import DateTimeCard from './components/DateTimeCard/DateTimeCard';
import { OrderBookProvider } from './api/Page';
import Dashboard from './pages/Dashboard';
import MessageHub, { AddFunction } from './notification';
import { loremIpsum } from 'lorem-ipsum';

const GRADIENTS = [
  './contract1.png',
  './contract2.png',
  './data-analysis.png',
  './report.png',
  './emotion-recognition.png',
  './dart-board.png',
  './illustrator.png',
];

export default function Home() {
  const [message, setMessage] = useState<string>('');
  const ref = useRef<null | AddFunction>(null);

  const handleClick = () => {
    ref.current?.(`Loading..`  );
    setMessage(`Loading..`);
  };

  return (
    <>
       <AppBar position="static" sx={{ backgroundColor: '#000000' }}>
        <Toolbar>
          <Typography variant="h6" >
            MTMD
          </Typography>
          <DateTimeCard />
        </Toolbar>
      </AppBar>

{/* Warp the Dashboard */}
      <OrderBookProvider>
        <div>
      <Container>
        <Dashboard />
      </Container>
      </div>
      </OrderBookProvider>

        <Container>
          <button className="p-4 mt-2" onClick={handleClick}>Notification</button>
          <MessageHub
            config={{ tension: 125, friction: 20, precision: 0.1 }}
            timeout={3000}
          >
            {(add: AddFunction) => {
              ref.current = add;
            }}
          </MessageHub>
        </Container>

        <footer className="py-4 bg-dark text-light text-center" style={{ position: 'fixed', bottom: 0, left: 0, right: 0 }}>    
            <Dock>
              {GRADIENTS.map((src, index) =>
                src ? (
                  <DockCard key={src}>
                    <Card src={src} />
                  </DockCard>
                ) : (
                  <DockDivider key={index} />
                )
              )}
            </Dock>
        </footer>
     
    </>
  );
}
