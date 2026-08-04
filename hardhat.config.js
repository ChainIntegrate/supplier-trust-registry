require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.27",
    settings: {
      // runs basso deliberatamente: questo contratto e' vicino al limite
      // EIP-170 (~18,7 KB su ~24,5 KB) con piu' funzioni di quanto sembri
      // a prima vista — vedi nota nel README. Con runs alto si rischia di
      // tornare sopra soglia e non essere deployabile.
      optimizer: { enabled: true, runs: 1 },
    },
  },
  networks: {
    luksoTestnet: {
      url: process.env.LUKSO_TESTNET_RPC_URL || "https://rpc.testnet.lukso.network",
      chainId: 4201,
      accounts,
    },
    luksoMainnet: {
      url: process.env.LUKSO_MAINNET_RPC_URL || "https://rpc.mainnet.lukso.network",
      chainId: 42,
      accounts,
    },
  },
};
