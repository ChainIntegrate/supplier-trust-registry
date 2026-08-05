// =======================================================================
// scripts/deploy.js
//
// Deploya SupplierRegistry e, se MEMBERSHIP_CONTRACT_ADDRESS e' impostato
// nell'ambiente, collega subito il contratto ChainIntegrate Membership
// esistente con i limiti per tier gia' decisi in fase di progettazione.
//
// Se MEMBERSHIP_CONTRACT_ADDRESS non e' impostato (es. primo test locale
// senza un vero Membership a disposizione), lo step di configurazione
// viene saltato con un avviso — il Registro resta deployato ma nessuno
// potra' mintare finche' non si collega almeno un Membership accettato.
// =======================================================================

const hre = require("hardhat");

// Numeri concordati in fase di progettazione (vedi README, sezione
// "Principi architetturali"). Tier numerici coerenti col vero contratto
// ChainIntegrate Membership: BRONZE=1, SILVER=2, GOLD=3.
const TIER_LIMITS = [
  { tier: 1, label: "Bronze", maxSuppliers: 5, maxParams: 4, canDiscloseSelectively: false },
  { tier: 2, label: "Silver", maxSuppliers: 25, maxParams: 8, canDiscloseSelectively: false },
  { tier: 3, label: "Gold", maxSuppliers: 100, maxParams: 1000, canDiscloseSelectively: true },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Rete:", hre.network.name);

  const ownerAddress = process.env.CHAININTEGRATE_OWNER_ADDRESS || deployer.address;
  if (!process.env.CHAININTEGRATE_OWNER_ADDRESS) {
    console.warn(
      "ATTENZIONE: CHAININTEGRATE_OWNER_ADDRESS non impostato, la UP ChainIntegrate " +
      "non ricevera' l'ownership finale — restera' al deployer."
    );
  }

  // -----------------------------------------------------------------
  // Owner TEMPORANEO = deployer, non la UP ChainIntegrate. Il contratto
  // usa Ownable di OpenZeppelin (one-step, niente acceptOwnership): se
  // l'owner fosse gia' la UP fin dal costruttore, nessuna chiamata
  // onlyOwner successiva (addMembershipContract, setTierLimits) potrebbe
  // essere firmata da una semplice chiave privata di deploy — servirebbe
  // una transazione firmata dalla UP stessa via Key Manager, cosa che
  // uno script di deploy non puo' fare da solo. Si configura tutto come
  // deployer, poi si trasferisce l'ownership alla UP come ULTIMO passo.
  // -----------------------------------------------------------------
  const SupplierRegistry = await hre.ethers.getContractFactory("SupplierRegistry");
  const registry = await SupplierRegistry.deploy(
    "ChainIntegrate Supplier Trust Registry",
    "SUPTRUST",
    deployer.address
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("\nSupplierRegistry deployato a:", registryAddress);
  console.log("Owner temporaneo (deployer):", deployer.address);

  const membershipAddress = process.env.MEMBERSHIP_CONTRACT_ADDRESS;
  if (!membershipAddress) {
    console.warn(
      "\nMEMBERSHIP_CONTRACT_ADDRESS non impostato — salto la configurazione dei tier.\n" +
      "Il contratto e' deployato ma nessuno potra' mintare un Registro finche' non\n" +
      "viene chiamato addMembershipContract() + setTierLimits() per almeno un tier."
    );
  } else {
    console.log("\nCollego il contratto Membership:", membershipAddress);
    const tx1 = await registry.addMembershipContract(membershipAddress);
    await tx1.wait();
    console.log("addMembershipContract confermato.");

    for (const t of TIER_LIMITS) {
      const tx = await registry.setTierLimits(
        membershipAddress,
        t.tier,
        t.maxSuppliers,
        t.maxParams,
        t.canDiscloseSelectively
      );
      await tx.wait();
      console.log(
        `Tier ${t.tier} (${t.label}) configurato: ` +
        `${t.maxSuppliers} fornitori, ${t.maxParams} parametri, ` +
        `disclosure selettiva ${t.canDiscloseSelectively ? "si" : "no"}`
      );
    }
  }

  // -----------------------------------------------------------------
  // ULTIMO passo, sempre: trasferisco l'ownership dal deployer alla UP
  // ChainIntegrate. Dopo questa chiamata il deployer NON puo' piu'
  // chiamare funzioni onlyOwner su questo contratto — solo la UP potra'
  // farlo da qui in avanti (tramite il proprio Key Manager).
  // -----------------------------------------------------------------
  if (ownerAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\nTrasferisco l'ownership a ${ownerAddress}...`);
    const txOwnership = await registry.transferOwnership(ownerAddress);
    await txOwnership.wait();
    console.log("Ownership trasferita. Il deployer non ha piu' privilegi onlyOwner su questo contratto.");
  } else {
    console.warn("\nOwnership NON trasferita: nessun CHAININTEGRATE_OWNER_ADDRESS valido fornito.");
  }

  printSummary(registryAddress, membershipAddress);
}

function printSummary(registryAddress, membershipAddress) {
  console.log("\n===================== RIEPILOGO =====================");
  console.log("SupplierRegistry:", registryAddress);
  console.log("Membership collegato:", membershipAddress || "NESSUNO — mint bloccato finche' non configurato");
  console.log("\nProssimi passi manuali:");
  console.log("1. Verificare il contratto su Blockscout");
  console.log("2. Aggiornare CONFIG.REGISTRY_CONTRACT in frontend/index.html");
  console.log("3. Aggiornare REGISTRY_CONTRACT_ADDRESS in backend/.env");
  console.log("=======================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});