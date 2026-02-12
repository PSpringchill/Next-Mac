import { NextRequest, NextResponse } from 'next/server';

// Proxy Binance Futures 1m klines to avoid CORS issues on client side.
// GET /api/klines?symbol=BNBUSDT&interval=1m&limit=360

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || 'BNBUSDT').toUpperCase();
  const interval = searchParams.get('interval') || '1m';
  const limit = Math.min(parseInt(searchParams.get('limit') || '360', 10), 1500);

  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Binance returned ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=30', // cache 30s
      },
    });
  } catch (error) {
    console.error('[/api/klines] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch klines from Binance' },
      { status: 502 },
    );
  }
}
