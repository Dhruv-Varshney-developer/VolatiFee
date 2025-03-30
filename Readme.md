# VolatiFee

VolatiFee is a Uniswap V4 hook that provides dynamic fee adjustment based on market volatility. The project implements a sophisticated fee mechanism that automatically adjusts trading fees based on market conditions, helping to optimize LPs profits.

## Features

- Dynamic fee adjustment based on market volatility
- Integration with Uniswap V4
- Volatility oracle for real-time market data
- Customizable fee calculation parameters
- Built with Solidity and TypeScript

## Architecture:

![Architecture](architecture.png)

## Prerequisites

- Node.js (v14 or higher)
- Yarn package manager
- Hardhat development environment

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Dhruv-Varshney-developer/VolatiFee.git
cd VolatiFee
```

2. Install dependencies:

```bash
yarn install
```

3. Create a `.env` file:

```bash
cp .env.example .env
```

4. Configure your environment variables in the `.env` file:

Make sure to properly configure your `.env` file using the provided `.env.example` as a template. The environment variables are crucial for:

- Contract deployment
- Oracle updates
- Network configuration
- API keys and endpoints

## Project Structure

```
VolatiFee/
├── contracts/              # Smart contracts
│   ├── DynamicFeeHook.sol # Main hook implementation
│   ├── FeeCalculator.sol  # Fee calculation logic
│   ├── MockBaseHook.sol   # Base hook implementation for testing
│   └── VolatilityOracle.sol # Market volatility oracle
├── scripts/               # Deployment and utility scripts
│   ├── deploy.ts         # Main deployment script
│   ├── run-oracle-updater.ts # Updates volatility oracle data
│   └── generate-comparison.ts # Generates comparison between dynamic and fixed fees
├── src/                   # TypeScript source files
│   ├── deployment/       # Deployment-related utilities
│   ├── hooks/           # Hook implementation utilities
│   └── oracle/          # Oracle-related utilities
└── stylus/                 # Stylus implementation
```

## Technical Implementation Details

### System Architecture

VolatiFee operates across two Ethereum networks simultaneously:

1. **Ethereum Mainnet** - Used for data collection and volatility calculations
   - The SwapDataCollector monitors the WETH/USDT Uniswap V3 pool
   - Price data and volatility metrics are calculated from real swap events
2. **Sepolia Testnet** - Where the Uniswap V4 hook and contracts are deployed
   - The DynamicFeeHook adjusts trading fees based on volatility data
   - The VolatilityOracle bridges data between networks
   - The FeeCalculator determines appropriate fee levels

### Core Components

#### 1. SwapDataCollector

- Monitors Uniswap V3 liquidity pools on Ethereum mainnet
- Calculates volatility by analyzing price movements over different time horizons
- Provides volatility metrics for short-term (1h), medium-term (1d), and long-term (1w) periods
- Uses statistical methods to derive annualized volatility percentages

#### 2. OracleUpdater

- Bridges data between Ethereum mainnet and Sepolia testnet
- Periodically fetches volatility metrics from the SwapDataCollector
- Transmits volatility data to the VolatilityOracle contract on Sepolia
- Implements monitoring logic for automated and event-based updates

#### 3. VolatilityOracle

- Securely stores volatility data on-chain
- Provides an authenticated interface for authorized updaters
- Forwards volatility data to the DynamicFeeHook contract
- Implements safety features like update frequency limiting

#### 4. DynamicFeeHook

- Hooks into Uniswap V4 swap operations via beforeSwap callback
- Dynamically adjusts trading fees based on current market volatility
- Ensures fees stay within configured minimum and maximum bounds
- Uses the FeeCalculator to determine appropriate fee levels

#### 5. FeeCalculator

- Implements sophisticated fee calculation logic
- Supports both linear and quadratic volatility response curves
- Allows parameter tuning to optimize LP yields under different market conditions
- Provides governance functions for authorized updates to calculation parameters

### Data Flow

1. SwapDataCollector monitors WETH/USDT Uniswap V3 pools on Ethereum mainnet
2. OracleUpdater fetches volatility metrics and relays them to Sepolia
3. VolatilityOracle stores and forwards the data to DynamicFeeHook
4. DynamicFeeHook uses FeeCalculator to determine appropriate fee levels
5. Uniswap V4 swaps execute with the dynamically adjusted fees

### Fee Calculation Methodology

The project implements a sophisticated approach to fee calculation:

1. Base fee serves as the starting point (e.g., 0.3%)
2. Volatility metrics influence fee adjustments
3. Response curves (linear or quadratic) determine how aggressively fees change
4. Configurable parameters allow for optimization and governance

During periods of high volatility, fees increase to:

- Compensate LPs for increased impermanent loss risk
- Capture more value from arbitrage trades
- Discourage speculative trading

During periods of low volatility, fees decrease to:

- Attract more trading volume
- Increase capital efficiency
- Remain competitive with other DEXs

## Smart Contracts

- `DynamicFeeHook.sol`: The main hook contract that implements dynamic fee adjustment
- `FeeCalculator.sol`: Handles fee calculation logic based on volatility
- `VolatilityOracle.sol`: Provides market volatility data
- `MockBaseHook.sol`: Base hook implementation for testing

#### Note on MockBaseHook Implementation

For Uniswap v4 Hook deployment, the contract must be deployed to a specific address to enable the required hook flags. In testing (e.g., Foundry), we can directly deploy to any address, but on real networks, we use **CREATE2** to control the deployment address.

The correct way to implement `BaseHook` is by inheriting from [Uniswap's BaseHook](https://github.com/Uniswap/v4-periphery/blob/main/src/utils/BaseHook.sol). This implementation requires mining an address, which can take time as we need to iterate on `CREATE2` to correctly mine the appropriate hook address for usage.

To achieve this, we utilize `HookMiner.sol`, which iterates over different salt values to find an address that meets the criteria. Due to time constraints during the Hookathon, we created `MockBaseHook` without address validation logic. This allowed us to move fast and iterate quickly without being blocked by address validation. However, in a production system, this will be properly implemented with address validation to ensure robustness and correctness.

For more details, refer to:

- [Uniswap's BaseHook](https://github.com/Uniswap/v4-periphery/blob/main/src/utils/BaseHook.sol)
- [HookMiner.sol](https://github.com/uniswapfoundation/v4-template/blob/main/test/utils/HookMiner.sol)
- [Sample deployment on Sepolia](https://github.com/haardikk21/v4-sepolia-deploy/tree/main)

## Development

### Compile Contracts

```bash
npx hardhat compile
```

### Deploy Contracts

```bash
npx hardhat deploy --network <network-name>
```

## Scripts and Utilities

### Oracle Updater

To run and update the volatility oracle data:

```bash
npx ts-node scripts/run-oracle-updater.ts
```

### Fee Comparison Generator

To generate a comparison between dynamic fee hook and fixed fee performance:

```bash
npx ts-node scripts/generate-comparison.ts
```

## Source Files

### Deployment Scripts

- `scripts/deploy.ts`: Main deployment script for deploying all contracts
- `scripts/run-oracle-updater.ts`: Updates the volatility oracle with latest market and swap data
- `scripts/generate-comparison.ts`: Generates comparison data between dynamic and fixed fees

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Uniswap V4 team for the base implementation
- Mentors from Uniswap Hook Incubator and Atrium Team for their guidance and support
