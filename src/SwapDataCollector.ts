import { ethers } from "ethers";

// Uniswap V3 Pool ABI (simplified)
const UNISWAP_V3_POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

export class SwapDataCollector {
  private provider: ethers.Provider;
  private pool: ethers.Contract;

  // Store historical price data
  private priceData: {
    timestamp: number;
    price: number;
    tick: number;
    sqrtPriceX96: bigint;
  }[] = [];

  constructor(
    rpcUrl: string = "https://1rpc.io/eth",
    poolAddress: string = "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36"
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.pool = new ethers.Contract(
      poolAddress,
      UNISWAP_V3_POOL_ABI,
      this.provider
    );
  }

  /**
   * Convert sqrtPriceX96 to actual price
   * @param sqrtPriceX96 The sqrt price in X96 format
   * @returns The actual price
   */
  private sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
    try {
      const TOKEN0_DECIMALS = 18; // WETH
      const TOKEN1_DECIMALS = 6;  // USDT
      const decimalAdjustment = 10 ** (TOKEN0_DECIMALS - TOKEN1_DECIMALS);


      // Q64.96 fixed point number conversion for Uniswap V3 price
      // Price = (sqrtPriceX96 / 2^96)^2
      // We need high precision to avoid losing decimal information

      // First, convert sqrtPriceX96 to a decimal representation
      const Q96 = BigInt(2) ** BigInt(96);

      // Divide sqrtPriceX96 by 2^96 to get the base price ratio
      const baseRatio =
        Number((sqrtPriceX96 * BigInt(1_000_000_000_000)) / Q96) /
        1_000_000_000_000;

      // Square the ratio to get the actual price
      const priceBeforeAdjustment = baseRatio * baseRatio;
      const price = priceBeforeAdjustment * decimalAdjustment;

      // For ETH/USDT, we want USDT per ETH
      // WETH is token0, USDT is token1 in this pool
      return price > 0 ? price : 0;
    } catch (error) {
      console.error("Error converting sqrtPriceX96 to price:", error);
      return 0;
    }
  }
  /**
   * Get the current price from the pool
   */
  async getCurrentPrice(): Promise<{
    price: number;
    tick: number;
    sqrtPriceX96: bigint;
  }> {
    // Get current state directly from the pool
    const slot0 = await this.pool.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;
    const tick = slot0.tick;
    const price = this.sqrtPriceX96ToPrice(sqrtPriceX96);

    // Add to price history
    this.priceData.push({
      timestamp: Math.floor(Date.now() / 1000),
      price,
      tick,
      sqrtPriceX96,
    });

    // Keep only last 100 price points
    if (this.priceData.length > 100) {
      this.priceData.shift();
    }

    return { price, tick, sqrtPriceX96 };
  }

  /**
   * Calculate volatility based on price history
   * @param timeWindow Time window in seconds to calculate volatility for
   */
  calculateVolatility(timeWindow: number = 3600): number {
    const now = Math.floor(Date.now() / 1000);
    const cutoffTime = now - timeWindow;

    // Filter price data for the time window
    const relevantData = this.priceData.filter(
      (data) => data.timestamp >= cutoffTime
    );

    if (relevantData.length < 2) {
      console.warn("Not enough price data points for volatility calculation");
      return 0;
    }

    // Calculate price changes (returns) between consecutive data points
    try {
      const returns: number[] = [];
      for (let i = 1; i < relevantData.length; i++) {
        const priceBefore = relevantData[i - 1].price;
        const priceAfter = relevantData[i].price;
        if (priceBefore === 0) {
          console.warn("Zero price encountered, skipping calculation");
          continue;
        }

        const returnPct = (priceAfter - priceBefore) / priceBefore;
        returns.push(returnPct);
      }
      if (returns.length < 2) {
        console.warn("Insufficient valid returns for volatility calculation");
        return 0;
      }

      // Calculate volatility as the standard deviation of returns
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const squaredDiffs = returns.map((r) => Math.pow(r - avgReturn, 2));
      const variance =
        squaredDiffs.reduce((sum, sd) => sum + sd, 0) / returns.length;
      const volatility = Math.sqrt(variance);

      // Annualize and convert to percentage
      // Assuming data points are roughly evenly spaced in time
      const timeSpanInSeconds =
        relevantData[relevantData.length - 1].timestamp -
        relevantData[0].timestamp;
      const timeSpanInYears = timeSpanInSeconds / (365 * 24 * 3600);
      const samplesPerYear = returns.length / timeSpanInYears;
      const annualizedVolatility = volatility * Math.sqrt(samplesPerYear) * 100;

      return isFinite(annualizedVolatility) ? annualizedVolatility : 0;
    } catch (error) {
      console.error("Error calculating volatility:", error);
      return 0;
    }
  }

  /**
   * Start listening for swap events in real-time
   */
  async startListening(callback?: (data: any) => void): Promise<void> {
    console.log(`Starting to listen for swap events for pool...`);

    // Get initial price
    await this.getCurrentPrice();

    // Listen for swap events (no need for specific pool ID filter)
    this.pool.on(
      "Swap",
      async (
        sender,
        recipient,
        amount0,
        amount1,
        sqrtPriceX96,
        liquidity,
        tick,
        event
      ) => {
        const price = this.sqrtPriceX96ToPrice(sqrtPriceX96);
        const block = await event.getBlock();

        const swapData = {
          timestamp: block.timestamp,
          price,
          tick,
          sqrtPriceX96: sqrtPriceX96.toString(),
          amount0: amount0.toString(),
          amount1: amount1.toString(),
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
        };

        // Add to price history
        this.priceData.push({
          timestamp: block.timestamp,
          price,
          tick,
          sqrtPriceX96,
        });

        // Keep only last 100 price points
        if (this.priceData.length > 100) {
          this.priceData.shift();
        }

        // Calculate current volatility
        const volatility = this.calculateVolatility();
        console.log(
          `New swap event - Price: ${price}, Volatility: ${volatility.toFixed(
            2
          )}%`
        );

        // Call callback if provided
        if (callback) {
          callback({
            ...swapData,
            volatility,
          });
        }
      }
    );

    console.log("Listening for swap events...");
  }

  /**
   * Fetch historical swap events
   * @param blockCount Number of blocks to look back
   */
  async fetchHistoricalSwaps(blockCount: number = 10000): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = currentBlock - blockCount;

    console.log(
      `Fetching swap events from block ${fromBlock} to ${currentBlock}...`
    );

    // Create filter for Swap events (no specific pool ID needed)
    const swapFilter = this.pool.filters.Swap();
    const events = await this.pool.queryFilter(
      swapFilter,
      fromBlock,
      currentBlock
    );

    console.log(`Found ${events.length} swap events`);

    // Process events in chronological order
    for (const event of events) {
      if ("args" in event) {
        const args = event.args;
        const block = await event.getBlock();

        const price = this.sqrtPriceX96ToPrice(args.sqrtPriceX96);
        if (price > 0) {
          console.log(
            `Event - Price: ${price}, Tick: ${args.tick}, Timestamp: ${block.timestamp}`
          );
        }
        // Add to price history
        this.priceData.push({
          timestamp: block.timestamp,
          price,
          tick: args.tick,
          sqrtPriceX96: args.sqrtPriceX96,
        });
      }
    }
    // Sort by timestamp
    this.priceData.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate volatility based on the historical data
    const volatility = this.calculateVolatility();
    console.log(`Historical volatility: ${volatility.toFixed(2)}%`);
  }

  /**
   * Get volatility metrics for different time windows
   */
  getVolatilityMetrics(): {
    shortTerm: number;
    mediumTerm: number;
    longTerm: number;
  } {
    return {
      shortTerm: this.calculateVolatility(3600), // 1 hour
      mediumTerm: this.calculateVolatility(86400), // 1 day
      longTerm: this.calculateVolatility(604800), // 1 week
    };
  }

  /**
   * Export price data for external use
   */
  getPriceData() {
    return this.priceData;
  }
}
