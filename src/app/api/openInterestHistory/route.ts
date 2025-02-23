import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const period = searchParams.get('period');

    if (!symbol || !period) {
        return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    try {
        const response = await fetch(
            `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=10`
        );

        if (!response.ok) {
            throw new Error(`Binance API responded with status ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error fetching from Binance:', error);
        return NextResponse.json({ error: 'Failed to fetch data from Binance' }, { status: 500 });
    }
}
