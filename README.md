# Supplier Trust Registry — ChainIntegrate

Registro di valutazione fornitori on-chain su LUKSO. Ogni utente minta il proprio
Registro (LSP8 soulbound), definisce i propri criteri di valutazione e giudica i
fornitori con visibilità pubblica o privata decisa **valutazione per valutazione**.

Evoluzione multi-tenant del Supplier Quality Manager già in uso presso La Meccanica
di Precisione (mono-tenant, mainnet). Feature-gated per tier via ChainIntegrate
Membership (Bronze/Silver/Gold, multi-contratto per non richiedere redeploy quando
arriverà un eventuale tier/contratto Diamond).

---

## Struttura del repo

```
supplier-trust-registry/
├── contracts/
│   └── SupplierRegistry.sol      — contratto principale (LSP8, soulbound)
├── frontend/
│   ├── index.html                — SPA vanilla JS, mini-app per il Grid
│   └── abi.subset.json           — ABI curata usata da index.html (estratta
│                                    dalla compilazione reale, non scritta a mano)
├── LICENSE                       — tutti i diritti riservati, contatto per permessi
├── .gitignore
└── README.md                     — questo file
```

Non ancora presenti nel repo (da aggiungere quando si passa al deploy vero):
`hardhat.config.js`, `package.json`, script di deploy, eventuali test.

---

## Stato attuale

**Contratto** (`contracts/SupplierRegistry.sol`) — scheletro completo, compila
pulito contro `@lukso/lsp8-contracts@0.18.1` / `@lukso/lsp4-contracts@0.17.3`,
sotto il limite EIP-170 con optimizer `runs: 1` (~18,7 KB). Non ancora deployato
né testato con test automatici. Copre:

- mint self-service del Registro, gated da Membership (multi-contratto,
  limiti configurabili per `(contratto, tier)` senza bisogno di redeploy)
- schema di valutazione versionato per registro (parametri custom, scala
  numerica personalizzabile)
- fornitori e valutazioni come eventi + contatori minimi (niente array in
  storage — stesso pattern `eth_getLogs` già in uso in MatchPredictor)
- privacy **per singola valutazione** (hash on-chain sempre, contenuto dietro
  un puntatore IPFS che risolve a cifrato o in chiaro) e **per nome fornitore**
  (stesso meccanismo, corretto rispetto alla prima bozza che scriveva il nome
  in chiaro nell'evento)
- correzione errori via `supersedes` (append-only, storico mai perso)
- disclosure selettiva (feature Gold) con prova on-chain, cifratura re-key
  interamente client-side
- continuità di reputazione tra registri in caso di successione aziendale,
  a doppia conferma (vecchio propone, nuovo accetta)

**Frontend** (`frontend/index.html`) — prima bozza funzionante, sintassi
verificata (non ancora testata in browser con wallet reale). Palette
"blueprint" (bianco/blu, ancorata al mondo dei disegni tecnici), IBM Plex
Sans/Mono, connessione UP via `up-provider`, flusso di mint/schema/fornitori/
valutazioni, cifratura client-side (PBKDF2 600.000 iterazioni + AES-256-GCM).

### Da completare prima di un deploy reale

- `CONFIG.REGISTRY_CONTRACT` in `index.html` — indirizzo del contratto dopo il deploy
- `CONFIG.RPC_URL` — client ID thirdweb (stesso provider di MatchPredictor)
- Endpoint backend `/api/ipfs/upload` — proxy verso Pinata (JWT lato server,
  mai nel frontend, stesso pattern di FidelityHub) — **non ancora scritto**
- Verifica empirica dell'import di `@lukso/up-provider` via esm.sh in un
  browser reale con estensione UP collegata (non testabile in sandbox)
- `hardhat.config.js` + script di deploy (non ancora presenti nel repo)
- Test automatici (non ancora scritti)
- Decisione finale KDF (PBKDF2 nativo usato per zero dipendenze esterne;
  Argon2id/scrypt restano opzioni se si accetta di aggiungere una libreria)

---

## Principi architetturali da tenere presente

Per il contesto completo delle decisioni prese, vedi la cronologia della chat
di progetto ("Registro Fornitori"). In sintesi, i punti che **non vanno
riaperti senza motivo** perché già discussi a fondo:

- Registro **soulbound**, non trasferibile — la successione aziendale passa
  da un nuovo registro collegato via `proposeSuccessor`/`confirmSuccessor`,
  non da un transfer del token
- Il contratto **non gestisce mai la cifratura** — sa solo hash + puntatore
  IPFS + flag pubblico/privato. Cifratura/decifratura sempre client-side
- Chiave di cifratura derivata da PIN utente + sale (indirizzo UP che ha
  mintato + indirizzo contratto), **letto sempre dalla catena**, mai dalla
  sessione corrente — ChainIntegrate non salva né può recuperare nulla
- Limiti per tier configurabili via `setTierLimits`, **mai** scolpiti nel
  codice — un futuro tier/contratto Diamond è una pura operazione admin
- LICENSE del repo: "tutti i diritti riservati" deliberato (non un
  dimenticanza) — il vantaggio competitivo è nel frontend/UX con la
  Membership, non nel contratto in sé

---

## Comandi utili (ambiente Hardhat, da ricreare)

```bash
npm install --save @lukso/lsp4-contracts @lukso/lsp8-contracts
npm install --save-exact @openzeppelin/contracts@4.9.6   # versione richiesta dagli LSP, non l'ultima
npm install --save-dev hardhat@2 @nomicfoundation/hardhat-toolbox@hh2
npx hardhat compile
```

Nota su un conflitto già incontrato: se nel repo finisce anche una versione
più recente di `@openzeppelin/contracts` per altri motivi, la risoluzione
delle import Solidity va in conflitto con quanto richiesto dagli LSP
(`^4.9.6`) — va installata esplicitamente quella versione a livello di
progetto.
