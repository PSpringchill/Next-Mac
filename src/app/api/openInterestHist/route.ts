import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let symbol = searchParams.get('symbol') || 'BTCUSDT';
  const period = searchParams.get('period') || '1h';
  const limit = searchParams.get('limit') || '24';

  // Handle invalid symbols like COLLECTUSDT
  if (symbol === 'COLLECTUSDT') {
    symbol = 'BTCUSDT'; // Fallback to valid symbol
  }

  try {
    // Fetch data from Binance API with proper headers
    let response = await fetch(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    // If symbol not found (404) or bad request (400), try fallback to BTCUSDT
    if (!response.ok && (response.status === 404 || response.status === 400) && symbol !== 'BTCUSDT') {
      console.warn(`Symbol ${symbol} not found on Binance OI API, falling back to BTCUSDT`);
      response = await fetch(
        `https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=${period}&limit=${limit}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Add CORS headers
    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('Error fetching open interest data:', error);
    
    // Return mock data as fallback
    const mockData = Array.from({ length: parseInt(limit) }, (_, i) => ({
      timestamp: Date.now() - (i * 3600000),
      openInterest: Math.random() * 1000000 + 500000,
      sumOpenInterest: Math.random() * 10000000 + 5000000,
      sumOpenInterestValue: Math.random() * 500000000 + 250000000,
    }));

    return NextResponse.json(mockData, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
