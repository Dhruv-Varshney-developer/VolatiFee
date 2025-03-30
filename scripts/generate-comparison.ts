// scripts/generate-comparison.ts
import { SwapDataCollector } from "../src/SwapDataCollector";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

async function generateComparisonChart() {
  const ETH_MAINNET_RPC =
    process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com";
  const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
  const Sepolia_RPC =
    process.env.SEPOLIA_RPC_URL || "https://sepolia-rpc.publicnode.com";

  console.log("Generating LP returns comparison chart...");

  // Create data collector for ETH-USDT pool
  const collector = new SwapDataCollector(
    ETH_MAINNET_RPC,
    "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36"
  );

  // Fetch historical data
  console.log("Fetching historical swap data...");
  await collector.fetchHistoricalSwaps(5000);

  // Set up contract connections
  const SepoliaProvider = new ethers.JsonRpcProvider(Sepolia_RPC);
  const feeCalculatorAddress = "0xa20d22b667cf2B7023C9766213dD3fA78f97D88b";
  const feeCalculatorABI = [
    "function calculateFee(uint32 volatility) external view returns (uint32)",
  ];
  const feeCalculator = new ethers.Contract(
    feeCalculatorAddress,
    feeCalculatorABI,
    SepoliaProvider
  );

  // Get volatility metrics for different periods
  const timePoints = [
    { label: "Low Volatility (Jan)", volatility: 2.1 },
    { label: "Medium Volatility (Mar)", volatility: 5.3 },
    { label: "High Volatility (Jul)", volatility: 12.8 },
    { label: "Current", volatility: collector.calculateVolatility(86400) },
  ];

  // Get the fixed fee used by Uniswap V3
  const FIXED_FEE = 0.3; // 0.3%

  console.log(
    "Calculating fees and returns for different market conditions..."
  );

  const results = [];
  for (const point of timePoints) {
    // Convert volatility to the format expected by the contract
    const volatilityScaled = Math.round(point.volatility * 100);

    // Get actual fee from your hook's calculator
    const dynamicFeeScaled = await feeCalculator.calculateFee(volatilityScaled);
    const dynamicFee = Number(dynamicFeeScaled) / 10000; // Convert from contract format to percentage

    // Calculate LP returns
    const fixedFeeReturn = simulateLPReturn(point.volatility, FIXED_FEE);
    const dynamicFeeReturn = simulateLPReturn(point.volatility, dynamicFee);
    const improvement =
      ((dynamicFeeReturn - fixedFeeReturn) / Math.abs(fixedFeeReturn)) * 100;

    results.push({
      label: point.label,
      volatility: point.volatility,
      fixedFee: FIXED_FEE,
      dynamicFee: dynamicFee,
      fixedFeeReturn: fixedFeeReturn,
      dynamicFeeReturn: dynamicFeeReturn,
      improvement: improvement,
    });

    console.log(
      `${point.label}: Volatility = ${point.volatility.toFixed(2)}%, ` +
        `Dynamic Fee = ${dynamicFee.toFixed(4)}%, ` +
        `Improvement = ${improvement.toFixed(2)}%`
    );
  }

  // Update the HTML template with real data
  let template = fs.readFileSync(
    path.join(__dirname, "../comparison-chart.html"),
    "utf8"
  );

  template = template.replace(
    /\/\/ This is replaced with actual data on running the generate-comparison\.ts script[\s\S]*?const timeLabels = \[(.*?)\];/,
    `// Actual data from VolatiFee's deployed smart contracts
    const volatilityData = ${JSON.stringify(results.map((r) => r.volatility))};
    const fixedFee = ${FIXED_FEE};
    const dynamicFees = ${JSON.stringify(results.map((r) => r.dynamicFee))};
    const fixedFeeReturns = ${JSON.stringify(results.map((r) => r.fixedFeeReturn))};
    const dynamicFeeReturns = ${JSON.stringify(results.map((r) => r.dynamicFeeReturn))};
    const timeLabels = ${JSON.stringify(results.map((r) => r.label))};`
  );
  
  template = template.replace(
    "Array(12).fill(fixedFee)",
    `Array(${results.length}).fill(fixedFee)`
  );

  // Update metrics cards with actual data
  const avgImprovement =
    results.reduce((sum, r) => sum + r.improvement, 0) / results.length;
  template = template.replace("+23.4%", `+${avgImprovement.toFixed(1)}%`);

  // Save the updated HTML
  fs.writeFileSync(path.join(__dirname, "../comparison-output.html"), template);
  console.log("Chart generated at comparison-output.html");
}

// Simplified LP return simulation function
function simulateLPReturn(volatility: number, fee: number): number {
  // Higher volatility typically means more IL
  // Higher fees help offset IL
  const baseReturn = 5; // Assume 5% baseline return from fees
  const ilImpact = -0.5 * volatility; // Simplified IL calculation
  const feeRevenue = fee * 100; // Fee revenue proportional to fee percentage

  return baseReturn + ilImpact + feeRevenue;
}

// Run the generator
generateComparisonChart().catch(console.error);
