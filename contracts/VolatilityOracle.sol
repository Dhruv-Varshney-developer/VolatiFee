// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IDynamicFeeHook
 * @notice Interface for the dynamic fee hook's volatility update function
 */
interface IDynamicFeeHook {
    function updateVolatility(bytes32 poolId, uint32 volatility) external;
}

/**
 * @title VolatilityOracle
 * @notice Oracle that bridges off-chain volatility data with the dynamic fee hook
 */
contract VolatilityOracle {
    // Owner and authorized updaters
    address public owner;
    mapping(address => bool) public authorizedUpdaters;

    // Dynamic fee hook contract
    IDynamicFeeHook public feeHook;

    // Mapping of pool ID to last reported volatility
    mapping(bytes32 => uint32) public lastVolatility;
    mapping(bytes32 => uint256) public lastUpdateTime;

    // Update frequency limit
    uint256 public constant MIN_UPDATE_INTERVAL = 5 minutes;

    // Events
    event VolatilityUpdated(bytes32 indexed poolId, uint32 volatility);
    event UpdaterAdded(address indexed updater);
    event UpdaterRemoved(address indexed updater);
    event FeeHookUpdated(address indexed newFeeHook);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner || authorizedUpdaters[msg.sender],
            "Not authorized"
        );
        _;
    }

    constructor(address _feeHook) {
        owner = msg.sender;
        feeHook = IDynamicFeeHook(_feeHook);
    }

    /**
     * @notice Update the fee hook address
     * @param _feeHook New fee hook address
     */
    function setFeeHook(address _feeHook) external onlyOwner {
        feeHook = IDynamicFeeHook(_feeHook);
        emit FeeHookUpdated(_feeHook);
    }

    /**
     * @notice Add an authorized updater
     * @param updater Address to authorize
     */
    function addUpdater(address updater) external onlyOwner {
        authorizedUpdaters[updater] = true;
        emit UpdaterAdded(updater);
    }

    /**
     * @notice Remove an authorized updater
     * @param updater Address to remove
     */
    function removeUpdater(address updater) external onlyOwner {
        authorizedUpdaters[updater] = false;
        emit UpdaterRemoved(updater);
    }

    /**
     * @notice Update volatility for a pool
     * @param poolId Pool identifier
     * @param volatility Volatility value (as percentage * 100, e.g. 500 = 5%)
     * @return True if update was successful
     */
    function updateVolatility(
        bytes32 poolId,
        uint32 volatility
    ) external onlyAuthorized returns (bool) {
        // Enforce minimum update interval
        require(
            block.timestamp >= lastUpdateTime[poolId] + MIN_UPDATE_INTERVAL,
            "Update too frequent"
        );

        // Store the volatility
        lastVolatility[poolId] = volatility;
        lastUpdateTime[poolId] = block.timestamp;

        // Forward to the fee hook
        feeHook.updateVolatility(poolId, volatility);

        emit VolatilityUpdated(poolId, volatility);
        return true;
    }

    /**
     * @notice Emergency volatility update (bypass timing constraints)
     * @param poolId Pool identifier
     * @param volatility Volatility value
     */
    function emergencyUpdate(
        bytes32 poolId,
        uint32 volatility
    ) external onlyOwner {
        // Store the volatility
        lastVolatility[poolId] = volatility;
        lastUpdateTime[poolId] = block.timestamp;

        // Forward to the fee hook
        feeHook.updateVolatility(poolId, volatility);

        emit VolatilityUpdated(poolId, volatility);
    }

    /**
     * @notice Get the last reported volatility for a pool
     * @param poolId Pool identifier
     * @return Volatility value and timestamp
     */
    function getVolatility(
        bytes32 poolId
    ) external view returns (uint32, uint256) {
        return (lastVolatility[poolId], lastUpdateTime[poolId]);
    }
}
