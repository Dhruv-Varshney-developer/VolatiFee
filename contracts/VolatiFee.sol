// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";

import {Oracle} from "./Oracle.sol";

contract VolatilityBasedFeesHook is BaseHook {
    using LPFeeLibrary for uint24;

    // Base fee that will be adjusted based on volatility (0.3%)
    uint24 public constant BASE_FEE = 3000;

    // Maximum fee to prevent extreme values (1%)
    uint24 public constant MAX_FEE = 10000;

    // Volatility multiplier for fee calculation
    uint24 public constant VOLATILITY_MULTIPLIER = 20;

    // Oracle contract to handle price history and volatility calculation
    Oracle public oracle;

    // Maps pool IDs to their last recorded price
    mapping(bytes32 => uint160) public lastPrices;

    // The constructor initializes the BaseHook parent with the pool manager
    // and sets the Oracle contract address.
    constructor(
        IPoolManager _poolManager,
        address _oracle
    ) BaseHook(_poolManager) {
        oracle = Oracle(_oracle);
    }

    // This function tells the pool manager which hooks are implemented.
    // Here we enable beforeInitialize, afterInitialize, beforeSwap, and afterSwap.
    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: true,
                beforeAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterAddLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    // -------------------- Initialization Hooks --------------------

    // _beforeInitialize is called before a pool is initialized.
    // Parameters:
    //   - address: the caller (unused here)
    //   - PoolKey key: structure containing pool parameters (tokens, fee settings, etc.)
    //   - uint160: initial price parameter (unused)
    //   - bytes: extra data (unused)
    // The function requires that the pool’s fee flag is set for dynamic fee.
    function _beforeInitialize(
        address,
        PoolKey calldata key,
        uint160,
        bytes calldata
    ) internal pure returns (bytes4) {
        require(key.fee.isDynamicFee(), "Pool must use dynamic fee");
        return this.beforeInitialize.selector;
    }

    // _afterInitialize is called after the pool is initialized.
    // It stores the initial pool price for use in volatility calculations.
    // Parameters:
    //   - address: the caller (unused)
    //   - PoolKey key: structure containing pool parameters
    //   - uint160 sqrtPriceX96: the initial square root price (in X96 fixed-point format)
    //   - int24: the initial tick (unused)
    //   - bytes: extra data (unused)
    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24,
        bytes calldata
    ) internal returns (bytes4) {
        // Create a unique pool ID from the pool key parameters.
        bytes32 poolId = keccak256(abi.encode(key));
        // Store the initial price in the lastPrices mapping.
        lastPrices[poolId] = sqrtPriceX96;
        return this.afterInitialize.selector;
    }

    // -------------------- Swap Hooks --------------------

    // _beforeSwap is called before a swap is executed.
    // It calculates the fee based on volatility and applies it for the swap.
    // Parameters:
    //   - address: the caller (unused)
    //   - PoolKey key: pool parameters for the swap
    //   - IPoolManager.SwapParams: parameters of the swap (unused here)
    //   - bytes: extra data (unused)
    // It returns:
    //   - the function selector for beforeSwap,
    //   - a zero delta (no adjustment to balances pre-swap),
    //   - and the fee (with an override flag).
    function _beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        bytes32 poolId = keccak256(abi.encode(key));

        // Calculate the fee based on the current volatility.
        uint24 fee = calculateFee(poolId);

        // Use LPFeeLibrary.OVERRIDE_FEE_FLAG to indicate that this fee should be used for this swap.
        uint24 feeWithFlag = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        return (
            this.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            feeWithFlag
        );
    }

    // _afterSwap is called after a swap has been executed.
    // Its primary role is to update the oracle with the new pool price,
    // ensuring that future fee calculations reflect the latest market state.
    // Parameters:
    //   - address: the caller (unused)
    //   - PoolKey key: pool parameters for the swap
    //   - IPoolManager.SwapParams: parameters of the swap (unused here)
    //   - BalanceDelta: change in pool balance (unused)
    //   - bytes: extra data (unused)
    function _afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        bytes32 poolId = keccak256(abi.encode(key));

        // Get the current pool price (sqrtPriceX96) from the pool manager.
        uint160 sqrtPriceX96 = poolManager.getSlot0(key.toId()).sqrtPriceX96;

        // Update the oracle with the latest price sample.
        oracle.addPriceSample(poolId, sqrtPriceX96);

        // Also update our record of the last price.
        lastPrices[poolId] = sqrtPriceX96;

        return (this.afterSwap.selector, 0);
    }

    // -------------------- Fee Calculation --------------------

    // calculateFee computes the dynamic fee based on the volatility data from the oracle.
    // It returns a fee which is the base fee plus an adjustment based on current volatility,
    // capped at the maximum fee.
    function calculateFee(bytes32 poolId) public view returns (uint24) {
        // Retrieve the current volatility for the pool.
        uint256 volatility = oracle.getVolatility(poolId);

        // Calculate the fee adjustment using the volatility multiplier.
        // Here the volatility is assumed to be normalized on a scale where 10000 represents 1%.
        uint24 volatilityAdjustment = uint24(
            (volatility * VOLATILITY_MULTIPLIER) / 10000
        );

        // Add the adjustment to the base fee.
        uint24 calculatedFee = BASE_FEE + volatilityAdjustment;
        // Cap the fee at MAX_FEE.
        return calculatedFee > MAX_FEE ? MAX_FEE : calculatedFee;
    }
}
