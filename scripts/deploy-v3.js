// =======================================================================
// scripts/deploy-v3.js
//
// Deploya SupplierRegistryV3 e, se MEMBERSHIP_CONTRACT_ADDRESS e' impostato
// nell'ambiente, collega subito il contratto ChainIntegrate Membership
// esistente con i limiti per tier gia' decisi in fase di progettazione —
// stesso schema della V2, con l'aggiunta di canCustomizeImage (Silver+).
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
// canCustomizeImage: Bronze no, Silver e Gold si.
const TIER_LIMITS = [
  { tier: 1, label: "Bronze", maxSuppliers: 5, maxParams: 4, canDiscloseSelectively: false, maxRegistries: 1, canCustomizeImage: false },
  { tier: 2, label: "Silver", maxSuppliers: 25, maxParams: 8, canDiscloseSelectively: false, maxRegistries: 2, canCustomizeImage: true },
  { tier: 3, label: "Gold", maxSuppliers: 100, maxParams: 1000, canDiscloseSelectively: true, maxRegistries: 5, canCustomizeImage: true },
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
  // Owner TEMPORANEO = deployer, non la UP ChainIntegrate — stesso
  // motivo gia' documentato per V1/V2: Ownable di OpenZeppelin e'
  // one-step, se l'owner fosse gia' la UP fin dal costruttore nessuna
  // chiamata onlyOwner successiva potrebbe essere firmata da una
  // semplice chiave privata di deploy. Configuro tutto come deployer,
  // trasferisco l'ownership come ULTIMO passo.
  // -----------------------------------------------------------------
  const SupplierRegistryV3 = await hre.ethers.getContractFactory("SupplierRegistryV3");
  const registry = await SupplierRegistryV3.deploy(
    "ChainIntegrate Supplier Trust Registry",
    "SUPTRUST",
    deployer.address
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("\nSupplierRegistryV3 deployato a:", registryAddress);
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
        t.canDiscloseSelectively,
        t.maxRegistries,
        t.canCustomizeImage
      );
      await tx.wait();
      console.log(
        `Tier ${t.tier} (${t.label}) configurato: ` +
        `${t.maxSuppliers} fornitori, ${t.maxParams} parametri, ` +
        `disclosure selettiva ${t.canDiscloseSelectively ? "si" : "no"}, ` +
        `max ${t.maxRegistries} registri, ` +
        `immagine personalizzata ${t.canCustomizeImage ? "si" : "no"}`
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
  console.log("SupplierRegistryV3:", registryAddress);
  console.log("Membership collegato:", membershipAddress || "NESSUNO — mint bloccato finche' non configurato");
  console.log("\nProssimi passi manuali:");
  console.log("1. Verificare il contratto su Blockscout");
  console.log("2. Aggiornare CONFIG.REGISTRY_CONTRACT in frontend/index.html");
  console.log("3. Aggiornare REGISTRY_CONTRACT_ADDRESS in backend/.env");
  console.log("4. Aggiornare l'ABI incorporata in index.html (nuove funzioni: setRegistryImage, getRegistryImage)");
  console.log("=======================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
