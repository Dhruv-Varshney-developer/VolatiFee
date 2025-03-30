import { OracleUpdater } from "../src/OracleUpdater";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  // Get configuration from environment or use defaults
  const ETH_MAINNET_RPC =
    process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com";
  const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
  const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || "";
  const Sepolia_RPC =
    process.env.SEPOLIA_RPC_URL || "https://sepolia-rpc.publicnode.com";

  if (!PRIVATE_KEY) {
    console.error("ERROR: Private key not found in environment variables");
    return;
  }

  // IMPORTANT: Using ETH-USDT pool on mainnet for data collection
  // But the oracle updates will happen on Sepolia through the wallet's private key
  const pools = [
    {
      address: "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36", // ETH-USDT on mainnet
      poolId:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      name: "ETH-USDT",
    },
  ];

  console.log("Starting Oracle Updater with configuration:");
  console.log(`- Oracle address on Sepolia: ${ORACLE_ADDRESS}`);
  console.log(
    `- Data source: ${pools[0].name} (${pools[0].address}) on Ethereum mainnet`
  );

  // Create the updater with both Ethereum mainnet (for data) and Sepolia (for updates)
  const updater = new OracleUpdater(
    ETH_MAINNET_RPC, // For data collection from mainnet
    Sepolia_RPC,
    PRIVATE_KEY, // For sending transactions to Sepolia
    ORACLE_ADDRESS, // Your deployed oracle on Sepolia
    pools
  );

  // Initialize with historical data
  console.log("\nInitializing with historical data from Ethereum mainnet...");
  await updater.initialize();

  // Start monitoring and updating every 5 minutes
  console.log("\nStarting continuous monitoring and oracle updates...");
  await updater.startMonitoring(5 * 60 * 1000);
}

// Run the script
main().catch(console.error);
