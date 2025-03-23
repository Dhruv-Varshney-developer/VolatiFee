// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

contract Oracle {
    // Number of samples to keep in the price history
    uint8 public constant HISTORY_SIZE = 10;
    
    // Struct to store price history for each pool
    struct PriceHistory {
        uint160[] prices;           // Circular buffer of recorded prices
        uint256 currentIndex;       // Next index to write a new price
        uint256 sampleCount;        // Number of samples collected (max HISTORY_SIZE)
        uint256 lastUpdateTimestamp;// Timestamp of the last update
    }
    
    // Maps pool IDs (a unique identifier for each pool) to their price histories
    mapping(bytes32 => PriceHistory) public priceHistories;
    
    // Owner address (for potential upgrades or adjustments)
    address public owner;
    
    // Eigenlayer operator that can update external price data
    address public eigenLayerOperator;
    
    // Event emitted when a new price sample is added for a pool
    event PriceSampleAdded(bytes32 indexed poolId, uint160 price);
    
    // Constructor sets the deployer as both the owner and initial eigenLayerOperator.
    constructor() {
        owner = msg.sender;
        eigenLayerOperator = msg.sender; // Initially set to owner, can be changed later
    }
    
    // Modifier to restrict access to only the owner.
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    // Modifier to restrict access to only the EigenLayer operator.
    modifier onlyEigenLayerOperator() {
        require(msg.sender == eigenLayerOperator, "Only EigenLayer operator can call this function");
        _;
    }
    
    // Function for the owner to update the eigenLayerOperator address.
    function setEigenLayerOperator(address _operator) external onlyOwner {
        eigenLayerOperator = _operator;
    }
    
    // Adds a price sample to the price history for a given pool.
    // NOTE: Changed from external to public so it can be called internally.
    function addPriceSample(bytes32 poolId, uint160 price) public {
        // Initialize the price history storage if it hasn't been set up yet.
        if (priceHistories[poolId].prices.length == 0) {
            priceHistories[poolId].prices = new uint160[](HISTORY_SIZE);
        }
        
        PriceHistory storage history = priceHistories[poolId];
        
        // Store the new price at the current index (circular buffer behavior).
        history.prices[history.currentIndex] = price;
        
        // Update the current index, wrapping around using modulus.
        history.currentIndex = (history.currentIndex + 1) % HISTORY_SIZE;
        
        // Increase sample count until the history is full.
        if (history.sampleCount < HISTORY_SIZE) {
            history.sampleCount++;
        }
        
        // Record the timestamp when this price was added.
        history.lastUpdateTimestamp = block.timestamp;
        
        emit PriceSampleAdded(poolId, price);
    }
    
    // Allows the EigenLayer operator to add an external price sample.
    // This function calls addPriceSample internally.
    function addExternalPriceSample(bytes32 poolId, uint160 price) external onlyEigenLayerOperator {
        addPriceSample(poolId, price);
    }
    
    // Returns the current volatility for a pool.
    // Volatility is calculated using a simplified standard deviation formula.
    // The returned value is scaled such that 10000 represents 1% volatility.
    function getVolatility(bytes32 poolId) public view returns (uint256) {
        PriceHistory storage history = priceHistories[poolId];
        
        // Not enough samples to calculate volatility? Return 0.
        if (history.sampleCount < 2) {
            return 0;
        }
        
        // Calculate the average price from the collected samples.
        uint256 sum = 0;
        for (uint256 i = 0; i < history.sampleCount; i++) {
            sum += history.prices[i];
        }
        uint256 avgPrice = sum / history.sampleCount;
        
        // Calculate the sum of squared differences from the average.
        uint256 sumSquaredDiff = 0;
        for (uint256 i = 0; i < history.sampleCount; i++) {
            uint256 diff;
            // Use absolute difference to avoid negative values.
            if (history.prices[i] > avgPrice) {
                diff = history.prices[i] - avgPrice;
            } else {
                diff = avgPrice - history.prices[i];
            }
            
            // Square the difference and normalize by the average price.
            sumSquaredDiff += (diff * diff) / avgPrice;
        }
        
        // Use FullMath.mulDiv for precise multiplication/division to calculate volatility.
        uint256 volatility = FullMath.mulDiv(
            sumSquaredDiff, 
            1000000, // Scale factor for normalization
            history.sampleCount * avgPrice
        );
        
        return volatility;
    }
    
    // Returns the current number of price samples for a given pool.
    function getSampleCount(bytes32 poolId) external view returns (uint256) {
        return priceHistories[poolId].sampleCount;
    }
    
    // Returns the complete price history array for a given pool.
    function getPriceHistory(bytes32 poolId) external view returns (uint160[] memory) {
        PriceHistory storage history = priceHistories[poolId];
        uint160[] memory result = new uint160[](history.sampleCount);
        
        for (uint256 i = 0; i < history.sampleCount; i++) {
            result[i] = history.prices[i];
        }
        
        return result;
    }
}
