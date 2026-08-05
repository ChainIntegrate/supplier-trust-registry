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
  // Verifica del sorgente via Blockscout — configurazione ufficiale LUKSO,
  // vedi github.com/lukso-network/lsp-smart-contracts/blob/develop/DEPLOYMENT.md
  // Nessuna vera API key richiesta, ma il plugin vuole comunque una stringa
  // non vuota PER OGNI network configurato (oggetto, non stringa nuda —
  // con una stringa nuda il plugin non risale al customChain giusto e
  // ripiega sull'endpoint Etherscan V2 di default, che rifiuta chain id
  // che non conosce. Confermato confrontando con MyCarBook, dove questo
  // stesso identico plugin/versione funziona correttamente con l'oggetto).
  etherscan: {
    apiKey: {
      luksoTestnet: "no-api-key-needed",
      luksoMainnet: "no-api-key-needed",
    },
    customChains: [
      {
        network: "luksoTestnet",
        chainId: 4201,
        urls: {
          apiURL: "https://explorer.execution.testnet.lukso.network/api",
          browserURL: "https://explorer.execution.testnet.lukso.network",
        },
      },
      {
        network: "luksoMainnet",
        chainId: 42,
        urls: {
          apiURL: "https://explorer.execution.mainnet.lukso.network/api",
          browserURL: "https://explorer.execution.mainnet.lukso.network",
        },
      },
    ],
  },
};