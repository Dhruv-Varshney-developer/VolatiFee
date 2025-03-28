
import { ethers } from 'ethers';

/**
 * Compute the pool ID from a pool key
 * @param token0 Address of token0
 * @param token1 Address of token1
 * @param fee Fee tier
 * @param tickSpacing Tick spacing
 * @param hooks Hook address
 * @returns Pool ID as bytes32
 */
export function computePoolId(
  token0: string,
  token1: string,
  fee: number,
  tickSpacing: number,
  hooks: string
): string {
  // Sort tokens
  if (token0.toLowerCase() > token1.toLowerCase()) {
    const temp = token0;
    token0 = token1;
    token1 = temp;
  }
  
  // Create the pool key struct that gets hashed
  const abiCoder = new ethers.AbiCoder();
  const encodedData = abiCoder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [token0, token1, fee, tickSpacing, hooks]
  );
  
  // Hash the encoded data to get the pool ID
  return ethers.keccak256(encodedData);
}

// Common pool configurations for reference
export const POOL_CONFIGS = {
  'ETH-USDT': {
    token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    fee: 3000, // 0.3%
    tickSpacing: 60,
  },
  'ETH-USDC': {
    token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    fee: 3000, // 0.3%
    tickSpacing: 60,
  }
};