const fs = require('fs');
const path = require('path');
const ABEvaluator = require('../src/app/components/TradingEngine/ABEvaluator').default;
const StressTestHarness = require('../src/app/components/TradingEngine/StressTestHarness').default;

const parseArgs = (argv = process.argv.slice(2)) => {
  return {
    runAb: argv.includes('--ab'),
    runStress: argv.includes('--stress'),
    dataPath: argv.find((arg) => arg.startsWith('--data='))?.split('=')[1]
  };
};

const generateSampleData = () => {
  const data = [];
  let price = 100;
  for (let i = 0; i < 25; i += 1) {
    price *= 1 + (Math.sin(i / 5) * 0.002);
    data.push({
      timestamp: Date.now() + i * 1000,
      price,
      orderBook: {
        lastUpdateId: i,
        bids: [[(price - 0.5).toFixed(2), '1']],
        asks: [[(price + 0.5).toFixed(2), '1']]
      },
      openInterest: {
        openInterest: '1000',
        symbol: 'BTCUSDT',
        time: Date.now() + i * 1000
      },
      fundingRate: 0.0002
    });
  }
  return data;
};

const loadData = (dataPath) => {
  if (!dataPath) return generateSampleData();
  const fullPath = path.resolve(process.cwd(), dataPath);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw);
};

const main = async () => {
  const { runAb, runStress, dataPath } = parseArgs();
  const data = loadData(dataPath);

  if (!runAb && !runStress) {
    console.log('Usage: npm run evaluate -- --ab --stress --data=path/to/data.json');
    console.log('At least one of --ab or --stress is required.');
    process.exit(1);
  }

  if (runAb) {
    const evaluator = new ABEvaluator();
    const result = await evaluator.run(data);
    console.log('A/B Evaluation Result:');
    console.log(JSON.stringify(result, null, 2));
  }

  if (runStress) {
    const harness = new StressTestHarness();
    const scenarios = await Promise.all([
      harness.runFlashCrash(),
      harness.runApiFailure(),
      harness.runStaleFeed()
    ]);
    console.log('Stress Test Results:');
    console.log(JSON.stringify(scenarios, null, 2));
  }
};

module.exports = { parseArgs, generateSampleData, loadData, main };

if (require.main === module) {
  main();
}
