// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

/// @dev Membership fittizia, SOLO per test locali e per verificare lo script
/// di deploy prima di puntare al vero contratto ChainIntegrate Membership
/// (gia' deployato su testnet/mainnet — vedi altri progetti). NON deployare
/// questa su LUKSO vera, serve solo a rete Hardhat locale effimera.
contract MockMembership {
    mapping(address => uint8) public tierOf_;

    function setTier(address account, uint8 tier) external {
        tierOf_[account] = tier;
    }

    function tierOf(address account) external view returns (uint8) {
        return tierOf_[account];
    }
}
