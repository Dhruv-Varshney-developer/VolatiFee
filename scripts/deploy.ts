import { ethers } from "hardhat";
import fs from "fs";

async function main() {
  console.log("Deploying contracts to Sepolia...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying from address: ${deployer.address}`);

  // Define deployment parameters
  const POOL_MANAGER_ADDRESS = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";

  // Fee calculator parameters
  const BASE_FEE = 3000; // 0.3%
  const MAX_FEE = 10000; // 1%
  const MIN_FEE = 100; // 0.01%
  const VOLATILITY_MULTIPLIER = 500;
  const VOLATILITY_EXPONENT = 10;

  // 1. Deploy DynamicFeeCalculator
  console.log("\nDeploying DynamicFeeCalculator...");
  const FeeCalculatorFactory = await ethers.getContractFactory(
    "DynamicFeeCalculator"
  );
  const feeCalculator = await FeeCalculatorFactory.deploy(
    BASE_FEE,
    MAX_FEE,
    MIN_FEE,
    VOLATILITY_MULTIPLIER,
    VOLATILITY_EXPONENT
  );
  await feeCalculator.waitForDeployment();

  // Get the target address for the deployed contract
  const feeCalculatorAddress = await feeCalculator.getAddress();
  console.log(`DynamicFeeCalculator deployed to: ${feeCalculatorAddress}`);

  // 2. Deploy DynamicFeeHook
  console.log("\nDeploying DynamicFeeHook...");
  const DynamicFeeHookFactory = await ethers.getContractFactory(
    "DynamicFeeHook"
  );
  const feeHook = await DynamicFeeHookFactory.deploy(
    POOL_MANAGER_ADDRESS,
    feeCalculatorAddress
  );
  await feeHook.waitForDeployment();
  const feeHookAddress = await feeHook.getAddress();
  console.log(`DynamicFeeHook deployed to: ${feeHookAddress}`);

  // 3. Deploy VolatilityOracle
  console.log("\nDeploying VolatilityOracle...");
  const VolatilityOracleFactory = await ethers.getContractFactory(
    "VolatilityOracle"
  );
  const volatilityOracle = await VolatilityOracleFactory.deploy(feeHookAddress);
  await volatilityOracle.waitForDeployment();
  const volatilityOracleAddress = await volatilityOracle.getAddress();
  console.log(`VolatilityOracle deployed to: ${volatilityOracleAddress}`);

  // 4. Set the oracle address in the hook
  console.log("\nConfiguring hook to use the oracle...");
  const setOracleTx = await feeHook.setVolatilityOracle(
    volatilityOracleAddress
  );
  await setOracleTx.wait();
  console.log("Hook configured successfully");

  // 5. Add deployer as an authorized updater in the oracle
  console.log("\nAdding deployer as oracle updater...");
  const addUpdaterTx = await volatilityOracle.addUpdater(deployer.address);
  await addUpdaterTx.wait();
  console.log("Deployer added as updater");

  // 6. Save deployment info to a file
  const deploymentInfo = {
    network: "sepolia",
    poolManager: POOL_MANAGER_ADDRESS,
    feeCalculator: feeCalculatorAddress,
    dynamicFeeHook: feeHookAddress,
    volatilityOracle: volatilityOracleAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    parameters: {
      baseFee: BASE_FEE,
      maxFee: MAX_FEE,
      minFee: MIN_FEE,
      volatilityMultiplier: VOLATILITY_MULTIPLIER,
      volatilityExponent: VOLATILITY_EXPONENT,
    },
  };

  fs.writeFileSync(
    "./deployment-info-sepolia.json",
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(
    "\nDeployment complete! Info saved to deployment-info-sepolia.json"
  );
  console.log("\nDeployment Summary:");
  console.log(`- DynamicFeeCalculator: ${feeCalculatorAddress}`);
  console.log(`- DynamicFeeHook: ${feeHookAddress}`);
  console.log(`- VolatilityOracle: ${volatilityOracleAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
