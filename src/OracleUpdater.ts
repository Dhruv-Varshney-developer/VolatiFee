import { ethers } from "ethers";
import { SwapDataCollector } from "./SwapDataCollector";

// Oracle ABI (minimal version with just what we need)
const ORACLE_ABI = [
  "function updateVolatility(bytes32 poolId, uint32 volatility) external returns (bool)",
  "function lastVolatility(bytes32) external view returns (uint32)",
];

// Update interface to use pool address instead of pool ID
interface PoolInfo {
  address: string; // Pool address
  poolId: string; // V4 Hook poolId for the oracle
  name: string; // Human-readable name for logging
}

export class OracleUpdater {
  private mainnetProvider: ethers.Provider;
  private sepoliaProvider: ethers.Provider;
  private wallet: ethers.Wallet;
  private oracleContract: ethers.Contract;
  private dataCollectors: Map<string, SwapDataCollector> = new Map();
  private pools: PoolInfo[] = [];

  constructor(
    mainnetRpcUrl: string,
    sepoliaRpcUrl: string,
    privateKey: string,
    oracleAddress: string,
    pools: PoolInfo[]
  ) {
    this.mainnetProvider = new ethers.JsonRpcProvider(mainnetRpcUrl);
    this.sepoliaProvider = new ethers.JsonRpcProvider(sepoliaRpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.sepoliaProvider);
    this.oracleContract = new ethers.Contract(
      oracleAddress,
      ORACLE_ABI,
      this.wallet
    );
    this.pools = pools;

    // Initialize data collectors for each pool using pool address
    for (const pool of pools) {
      this.dataCollectors.set(
        pool.poolId, // Still use poolId as key for mapping
        new SwapDataCollector(mainnetRpcUrl, pool.address) // Use pool address for collector
      );
    }
  }

  /**
   * Initialize data collectors by fetching historical data
   */
  async initialize() {
    console.log("Initializing data collectors with historical data...");

    const promises: Promise<void>[] = [];
    for (const [poolId, collector] of this.dataCollectors.entries()) {
      const pool = this.pools.find((p) => p.poolId === poolId);
      console.log(`Fetching historical data for ${pool?.name || poolId}...`);

      promises.push(collector.fetchHistoricalSwaps(5000));
    }

    await Promise.all(promises);
    console.log("Initialization complete!");
  }

  /**
   * Start monitoring pools and updating the oracle
   */
  async startMonitoring(updateIntervalMs: number = 300000) {
    console.log(
      `Starting to monitor pools with update interval of ${updateIntervalMs}ms`
    );

    // First update
    await this.updateOracle();

    // Set update interval
    setInterval(async () => {
      try {
        await this.updateOracle();
      } catch (error) {
        console.error("Error updating oracle:", error);
      }
    }, updateIntervalMs);

    // Start listening for swap events
    this.startSwapListeners();
  }

  /**
   * Update the oracle with current volatility data
   */
  async updateOracle() {
    console.log("Updating oracle with latest volatility data...");

    for (const pool of this.pools) {
      try {
        const collector = this.dataCollectors.get(pool.poolId);
        if (!collector) continue;

        // Fetch current price to ensure we have the latest data
        await collector.getCurrentPrice();

        // Calculate volatility
        const metrics = collector.getVolatilityMetrics();

        // Use medium-term volatility (1 day) for the fee calculation
        const volatility = Math.round(metrics.mediumTerm);

        console.log(
          `Updating ${pool.name} with volatility = ${volatility / 100}%`
        );
        // Check wallet balance
        const balance = await this.sepoliaProvider.getBalance(this.wallet.address);
        const feeData = await this.sepoliaProvider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("20", "gwei");

        console.log(`Wallet Balance: ${ethers.formatEther(balance)} ETH`);
        console.log(
          `Current Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`
        );

        // Estimate gas
        const estimatedGas =
          await this.oracleContract.updateVolatility.estimateGas(
            pool.poolId,
            volatility
          );
        const gasCost = estimatedGas * gasPrice;

        console.log(`Estimated Gas: ${estimatedGas}`);
        console.log(`Estimated Gas Cost: ${ethers.formatEther(gasCost)} ETH`);

        // Check if balance is sufficient
        if (balance <= gasCost) {
          throw new Error(
            `Insufficient balance. Need ${ethers.formatEther(gasCost)} ETH`
          );
        }

        console.log(
          `Updating ${pool.name} with volatility = ${volatility / 100}%`
        );

        // Convert volatility to the format expected by the contract (percentage * 100)
        const tx = await this.oracleContract.updateVolatility(
          pool.poolId,
          volatility,
          {
            gasLimit: estimatedGas * BigInt(2), // buffer
            gasPrice: gasPrice,
          }
        );
        await tx.wait();

        console.log(`Update successful! Transaction: ${tx.hash}`);
      } catch (error) {
        console.error(`Error updating oracle for ${pool.name}:`, error);
      }
    }
  }

  /**
   * Start listening for swap events in real-time
   */
  private startSwapListeners() {
    for (const pool of this.pools) {
      console.log(`Starting swap listener for ${pool.name}...`);

      const collector = this.dataCollectors.get(pool.poolId);
      if (!collector) continue;

      collector.startListening(async (data) => {
        // Log significant price or volatility changes
        if (data.volatility > 10) {
          // Only log significant volatility (>10%)
          console.log(
            `${pool.name}: Price = ${
              data.price
            }, Volatility = ${data.volatility.toFixed(2)}%`
          );

          // Could trigger an immediate update for significant changes
          if (data.volatility > 20) {
            // Very high volatility
            console.log(
              "High volatility detected! Triggering immediate update..."
            );
            await this.updateOracle();
          }
        }
      });
    }
  }
}
