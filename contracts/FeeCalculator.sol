// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title DynamicFeeCalculator
 * @notice Calculates dynamic fees based on volatility metrics
 */
contract DynamicFeeCalculator {
    // Owner address
    address public owner;

    // Base fee parameters (in 0.01% units, 100 = 1%)
    uint32 public baseFee;
    uint32 public maxFee;
    uint32 public minFee;

    // Volatility response curve parameters
    uint32 public volatilityMultiplier;
    uint32 public volatilityExponent;

    // Events
    event ParametersUpdated(
        uint32 baseFee,
        uint32 maxFee,
        uint32 minFee,
        uint32 volatilityMultiplier,
        uint32 volatilityExponent
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(
        uint32 _baseFee,
        uint32 _maxFee,
        uint32 _minFee,
        uint32 _volatilityMultiplier,
        uint32 _volatilityExponent
    ) {
        owner = msg.sender;
        baseFee = _baseFee;
        maxFee = _maxFee;
        minFee = _minFee;
        volatilityMultiplier = _volatilityMultiplier;
        volatilityExponent = _volatilityExponent;
    }

    /**
     * @notice Calculate fee based on volatility
     * @param volatility Volatility value (as percentage * 100, e.g. 500 = 5%)
     * @return Dynamic fee in hundredths of a basis point (e.g. 3000 = 0.3%)
     */
    function calculateFee(uint32 volatility) external view returns (uint32) {
        // Apply exponent to volatility (linear or quadratic)
        uint32 volatilityFactor;
        if (volatilityExponent == 10) {
            // Linear: volatility * 1
            volatilityFactor = volatility;
        } else if (volatilityExponent == 20) {
            // Quadratic: volatility^2 / 100 (to keep in reasonable range)
            volatilityFactor = uint32(
                (uint256(volatility) * uint256(volatility)) / 100
            );
        } else {
            // Default to linear
            volatilityFactor = volatility;
        }

        // Calculate fee adjustment
        uint256 adjustment = (uint256(volatilityFactor) *
            uint256(volatilityMultiplier)) / 1000;

        // Add adjustment to base fee
        uint256 finalFee = baseFee;
        if (adjustment > 0) {
            finalFee = baseFee + adjustment;
        }

        // Ensure fee is within bounds
        if (finalFee < minFee) {
            finalFee = minFee;
        } else if (finalFee > maxFee) {
            finalFee = maxFee;
        }

        return uint32(finalFee);
    }

    /**
     * @notice Update fee calculation parameters
     * @param _baseFee Base fee value
     * @param _maxFee Maximum allowed fee
     * @param _minFee Minimum allowed fee
     * @param _volatilityMultiplier Multiplier for volatility sensitivity
     * @param _volatilityExponent Exponent for volatility response curve (10=linear, 20=quadratic)
     */
    function updateParameters(
        uint32 _baseFee,
        uint32 _maxFee,
        uint32 _minFee,
        uint32 _volatilityMultiplier,
        uint32 _volatilityExponent
    ) external onlyOwner {
        baseFee = _baseFee;
        maxFee = _maxFee;
        minFee = _minFee;
        volatilityMultiplier = _volatilityMultiplier;
        volatilityExponent = _volatilityExponent;

        emit ParametersUpdated(
            _baseFee,
            _maxFee,
            _minFee,
            _volatilityMultiplier,
            _volatilityExponent
        );
    }

    /**
     * @notice Transfer ownership of the contract
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is the zero address");
        owner = newOwner;
    }
}
