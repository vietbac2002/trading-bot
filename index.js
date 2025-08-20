import ccxt from "ccxt";
import moment from "moment";
import delay from "delay";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, "trades.log");
const CHART_FILE = path.join(__dirname, "chart.html");

// Track initial balance for benefit calculation
let initialBalance = null;
let totalTrades = 0;

function writeLog(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

function generateChartHtml() {
  let data = [];
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs
      .readFileSync(LOG_FILE, "utf-8")
      .split("\n")
      .filter(Boolean);
    data = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  const times = data.map((d) => d.time);
  const avgPrices = data.map((d) => d.price);
  const lastPrices = data.map((d) => d.lastPrice);
  const benefits = data.map((d) => d.benefit);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BTC/USDT Trading Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .chart-container { margin-bottom: 40px; }
    .stats { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>BTC/USDT Trading Dashboard</h1>
  
  <div class="stats">
    <h3>Trading Statistics</h3>
    <p><strong>Total Trades:</strong> ${data.length}</p>
    <p><strong>Current Benefit:</strong> $${data.length > 0 ? data[data.length - 1].benefit.toFixed(2) : '0.00'}</p>
    <p><strong>Last Update:</strong> ${data.length > 0 ? data[data.length - 1].time : 'N/A'}</p>
  </div>

  <div class="chart-container">
    <h2>Price Comparison (Average vs Last Price)</h2>
    <canvas id="priceChart" width="800" height="400"></canvas>
  </div>

  <div class="chart-container">
    <h2>Trading Benefit Over Time</h2>
    <canvas id="benefitChart" width="800" height="400"></canvas>
  </div>

  <script>
    const times = ${JSON.stringify(times)};
    const avgPrices = ${JSON.stringify(avgPrices)};
    const lastPrices = ${JSON.stringify(lastPrices)};
    const benefits = ${JSON.stringify(benefits)};

    // Price Chart
    const priceCtx = document.getElementById('priceChart').getContext('2d');
    new Chart(priceCtx, {
      type: 'line',
      data: {
        labels: times,
        datasets: [{
          label: 'Average Price',
          data: avgPrices,
          borderColor: 'blue',
          backgroundColor: 'rgba(0, 0, 255, 0.1)',
          fill: false
        }, {
          label: 'Last Price',
          data: lastPrices,
          borderColor: 'red',
          backgroundColor: 'rgba(255, 0, 0, 0.1)',
          fill: false
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { 
            display: true,
            title: { display: true, text: 'Time' }
          },
          y: { 
            display: true,
            title: { display: true, text: 'Price (USDT)' }
          }
        }
      }
    });

    // Benefit Chart
    const benefitCtx = document.getElementById('benefitChart').getContext('2d');
    new Chart(benefitCtx, {
      type: 'line',
      data: {
        labels: times,
        datasets: [{
          label: 'Trading Benefit (USDT)',
          data: benefits,
          borderColor: benefits[benefits.length - 1] >= 0 ? 'green' : 'red',
          backgroundColor: benefits[benefits.length - 1] >= 0 ? 'rgba(0, 255, 0, 0.1)' : 'rgba(255, 0, 0, 0.1)',
          fill: true
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { 
            display: true,
            title: { display: true, text: 'Time' }
          },
          y: { 
            display: true,
            title: { display: true, text: 'Benefit (USDT)' }
          }
        }
      }
    });

    // Auto-refresh every minute
    setTimeout(() => {
      window.location.reload();
    }, 60000);
  </script>
</body>
</html>`;

  fs.writeFileSync(CHART_FILE, html);
  console.log(`Chart updated: ${CHART_FILE}`);
}

async function calculateBenefit(btcPrice) {
  const balance = await binance.fetchBalance();
  const total = balance.total;
  
  // Current portfolio value in USDT
  const currentValue = (total.BTC * btcPrice) + total.USDT;
  
  // If this is the first run, set initial balance
  if (initialBalance === null) {
    initialBalance = currentValue;
    return 0; // No benefit on first run
  }
  
  return currentValue - initialBalance;
}

const binance = new ccxt.binance({
  apiKey: process.env.API_KEY,
  secret: process.env.SECRET_KEY,
});
binance.setSandboxMode(true); // Enable sandbox mode for testing

async function tick() {
  try {
    const prices = await binance.fetchOHLCV("BTC/USDT", "1m", undefined, 5);
    const formattedResponse = prices.map((price) => {
      return {
        timestamp: moment(price[0]).format("YYYY-MM-DD HH:mm:ss"),
        open: price[1],
        high: price[2],
        low: price[3],
        close: price[4],
        volume: price[5],
      };
    });

    // Business logic
    const avgPrice =
      formattedResponse.reduce((acc, price) => acc + price.close, 0) /
      formattedResponse.length;
      
    const lastPrice = formattedResponse[formattedResponse.length - 1].close;
    const direction = lastPrice > avgPrice ? "sell" : "buy";
    const TRADE_SIZE = 100;
    const quantity = TRADE_SIZE / lastPrice;

    console.log(`Average prices: ${avgPrice.toFixed(2)}. Last price: ${lastPrice.toFixed(2)}`);

    // Calculate benefit before making the trade
    const benefit = await calculateBenefit(lastPrice);

    // Create the trade order
    const order = await binance.createOrder(
      "BTC/USDT",
      "market",
      direction,
      quantity
    );

    totalTrades++;
    const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");

    // Log entry with all required fields
    const logEntry = {
      time: currentTime,
      price: parseFloat(avgPrice.toFixed(2)), // Average price
      lastPrice: parseFloat(lastPrice.toFixed(2)), // Current/last price
      benefit: parseFloat(benefit.toFixed(2)), // Current benefit in USDT
      direction: direction,
      quantity: parseFloat(quantity.toFixed(8)),
      tradeNumber: totalTrades
    };

    writeLog(logEntry);
    generateChartHtml(); // Update chart after each trade

    console.log(`${currentTime} : ${direction} ${quantity.toFixed(8)} BTC at ${lastPrice.toFixed(2)}`);
    console.log(`Trade #${totalTrades} | Benefit: ${benefit.toFixed(2)} USDT`);
    console.log(order);
    
    await printBalance(lastPrice);
    
  } catch (error) {
    console.error('Error in tick function:', error);
    
    // Log error entry
    const errorEntry = {
      time: moment().format("YYYY-MM-DD HH:mm:ss"),
      price: 0,
      lastPrice: 0,
      benefit: 0,
      error: error.message
    };
    writeLog(errorEntry);
  }
}

async function printBalance(btcPrice) {
  try {
    const balance = await binance.fetchBalance();
    const total = balance.total;
    const portfolioValue = (total.BTC * btcPrice) + total.USDT;
    
    console.log(`Balance BTC: ${total.BTC.toFixed(8)}, USDT: ${total.USDT.toFixed(2)}`);
    console.log(`Total Portfolio Value: ${portfolioValue.toFixed(2)} USDT`);
    
    if (initialBalance !== null) {
      console.log(`Total Benefit: ${(portfolioValue - initialBalance).toFixed(2)} USDT`);
    }
  } catch (error) {
    console.error('Error fetching balance:', error);
  }
}

async function main() {
  console.log('Starting BTC/USDT trading bot...');
  console.log('Chart will be generated at:', CHART_FILE);
  console.log('Logs will be saved to:', LOG_FILE);
  
  while (true) {
    await tick();
    console.log('Waiting 1 minute for next trade...\n');
    await delay(1000 * 60); // wait for 1 minute
  }
}

main().catch(console.error);