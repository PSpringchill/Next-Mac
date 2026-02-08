* Framework to capture the dynamics of high-frequency limit order books.
* ￼

In this project I used machine learning methods to capture the high-frequency limit order book dynamics and Ema 4,8,12 cross trading strategy to get the P&L outcomes.
    * 
    * ￼
    * Depth Ratio
    * ￼
* Feature Extractor
    * Rise Ratio
* Learning Model Trainer
    * RandomForestClassifier
    * ExtraTreesClassifier
    * AdaBoostClassifier
    * GradientBoostingClassifier
    * SVM
* Use best model to predict next 10 seconds

Implement Unit Tests: Create comprehensive unit tests for each component to ensure reliability.

Add Backtesting: Develop a backtesting framework to evaluate strategy performance on historical data. 

Optimize Performance: Profile the code to identify and optimize bottlenecks, especially in the critical path.

Add Logging: Implement a robust logging system to track system behavior and assist with debugging.

Enhance Security: Add secure handling of API keys and implement authentication for exchange APIs.
// Create a trading system
TradingSystem ts(0.01, 0.02); // stopLoss, takeProfit

// Enable backtesting mode
ts.enableBacktestMode();

// Generate synthetic data or load from file
ts.generateSyntheticData("BTCUSDT”, 1000, 10000.0, 0.001);
// OR
// ts.loadHistoricalDataFromFile("historical_data.csv");

// Run backtest
BacktestResults results = ts.runBacktest();

// View results
std::cout << results.generateReport() << std::endl;

// Save results to CSV for further analysis
results.saveToCSV("backtest_results.csv");