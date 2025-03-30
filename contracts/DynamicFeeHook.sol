// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {MockBaseHook} from "./MockBaseHook.sol";

/**
 * @title IDynamicFeeCalculator
 * @notice Interface for the Arbitrum Stylus dynamic fee calculator
 */
interface IDynamicFeeCalculator {
    function calculateFee(uint32 volatility) external view returns (uint32 fee);
}

/**
 * @title DynamicFeeHook
 * @notice Uniswap V4 hook that adjusts fees based on market volatility
 */
contract DynamicFeeHook is MockBaseHook {
    using LPFeeLibrary for uint24;

    // Arbitrum Stylus fee calculator
    IDynamicFeeCalculator public feeCalculator;

    // Default fee parameters (in hundredths of a bip, 100 = 0.01%)
    uint24 public constant DEFAULT_FEE = 3000; // 0.3%
    uint24 public constant MAX_FEE = 10000; // 1%
    uint24 public constant MIN_FEE = 100; // 0.01%

    // Owner address
    address public owner;

    // Volatility oracle
    address public volatilityOracle;

    // Maps pool IDs to their current volatility
    mapping(bytes32 => uint32) public poolVolatility;

    // Store the last updated fees for each pool
    mapping(bytes32 => uint24) public lastFees;
    mapping(bytes32 => uint256) public lastFeeUpdate;

    // Fee update cooldown period
    uint256 public constant FEE_UPDATE_COOLDOWN = 1 seconds;

    // Events
    event FeeUpdated(bytes32 indexed poolId, uint24 oldFee, uint24 newFee);
    event VolatilityUpdated(bytes32 indexed poolId, uint32 volatility);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == volatilityOracle, "Only oracle");
        _;
    }

    constructor(
        IPoolManager _poolManager,
        address _feeCalculator
    ) MockBaseHook(_poolManager) {
        feeCalculator = IDynamicFeeCalculator(_feeCalculator);
        owner = msg.sender;
    }

    /**
     * @notice Update the fee calculator address
     * @param _feeCalculator New calculator address
     */
    function setFeeCalculator(address _feeCalculator) external onlyOwner {
        feeCalculator = IDynamicFeeCalculator(_feeCalculator);
    }

    /**
     * @notice Set the volatility oracle address
     * @param _volatilityOracle New oracle address
     */
    function setVolatilityOracle(address _volatilityOracle) external onlyOwner {
        volatilityOracle = _volatilityOracle;
    }

    /**
     * @notice Update volatility for a pool (called by the oracle)
     * @param poolId Pool identifier
     * @param volatility New volatility value
     */
    function updateVolatility(
        bytes32 poolId,
        uint32 volatility
    ) external onlyOracle {
        poolVolatility[poolId] = volatility;
        emit VolatilityUpdated(poolId, volatility);
    }

    /**
     * @notice Calculate the dynamic fee for a pool
     * @param poolId Pool identifier
     * @return Dynamic fee based on current volatility
     */
    function calculateDynamicFee(bytes32 poolId) public view returns (uint24) {
        uint32 volatility = poolVolatility[poolId];

        // If no volatility data or calculator, use default fee
        if (volatility == 0 || address(feeCalculator) == address(0)) {
            return DEFAULT_FEE;
        }

        // Calculate fee using Stylus calculator
        uint32 calculatedFee = feeCalculator.calculateFee(volatility);

        // Ensure fee is within bounds
        if (calculatedFee < MIN_FEE) {
            return MIN_FEE;
        } else if (calculatedFee > MAX_FEE) {
            return MAX_FEE;
        }

        return uint24(calculatedFee);
    }

    /**
     * @notice Force update the fee for a pool
     * @param key Pool key
     */
    function forceUpdateFee(PoolKey calldata key) external onlyOwner {
        bytes32 poolId = keccak256(abi.encode(key));
        uint24 oldFee = lastFees[poolId];
        uint24 newFee = calculateDynamicFee(poolId);

        lastFees[poolId] = newFee;
        lastFeeUpdate[poolId] = block.timestamp;

        emit FeeUpdated(poolId, oldFee, newFee);
    }

    /**
     * @notice Returns the hook's permissions
     */
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
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    // -------------------- Hook Implementation --------------------

    /**
     * @notice Called before pool initialization
     */
    function _beforeInitialize(
        address,
        PoolKey calldata key,
        uint160,
        bytes calldata
    ) internal pure returns (bytes4) {
        require(key.fee.isDynamicFee(), "Pool must use dynamic fee");
        return MockBaseHook.beforeInitialize.selector;
    }

    /**
     * @notice Called after pool initialization
     */
    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24,
        bytes calldata
    ) internal returns (bytes4) {
        bytes32 poolId = keccak256(abi.encode(key));

        // Set initial fee to default
        lastFees[poolId] = DEFAULT_FEE;
        lastFeeUpdate[poolId] = block.timestamp;

        emit FeeUpdated(poolId, 0, DEFAULT_FEE);

        return MockBaseHook.afterInitialize.selector;
    }

    /**
     * @notice Called before each swap
     */
    function _beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        bytes32 poolId = keccak256(abi.encode(key));

        uint24 dynamicFee;

        // Check if it's time to update the fee
        if (block.timestamp >= lastFeeUpdate[poolId] + FEE_UPDATE_COOLDOWN) {
            uint24 oldFee = lastFees[poolId];
            dynamicFee = calculateDynamicFee(poolId);

            // Update last fee and timestamp
            lastFees[poolId] = dynamicFee;
            lastFeeUpdate[poolId] = block.timestamp;

            emit FeeUpdated(poolId, oldFee, dynamicFee);
        } else {
            // Use the last calculated fee
            dynamicFee = lastFees[poolId];
        }

        // Apply the dynamic fee with override flag
        uint24 feeWithFlag = dynamicFee | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        return (
            MockBaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            feeWithFlag
        );
    }
}
