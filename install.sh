#!/bin/bash

echo "🚀 Installing Advanced Trading System Dependencies..."

# Clean install
rm -rf node_modules package-lock.json

# Install all dependencies
npm install --legacy-peer-deps

# Create necessary directories
mkdir -p src/tradingEngine/core
mkdir -p src/tradingEngine/ml
mkdir -p src/tradingEngine/markov
mkdir -p src/tradingEngine/features
mkdir -p src/tradingEngine/utils
mkdir -p src/tradingEngine/types
mkdir -p src/components/trading
mkdir -p src/hooks
mkdir -p src/stores
mkdir -p src/workers
mkdir -p public/workers
mkdir -p public/models

echo "✅ Installation complete!"
echo "📝 Next steps:"
echo "1. Copy the trading engine files to src/tradingEngine/"
echo "2. Copy the component files to src/components/"
echo "3. Update your .env.local with API keys"
echo "4. Run 'npm run dev' to start the development server"
