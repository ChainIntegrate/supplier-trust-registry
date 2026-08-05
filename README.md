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
│   ├── SupplierRegistry.sol      — contratto principale (LSP8, soulbound)
│   └── mocks/
│       └── MockMembership.sol    — SOLO per test locali, mai deployare su LUKSO vera
├── frontend/
│   ├── index.html                — SPA vanilla JS, mini-app per il Grid
│   └── abi.subset.json           — ABI curata usata da index.html (estratta
│                                    dalla compilazione reale, non scritta a mano)
├── backend/
│   ├── server.js                 — Express, wiring delle rotte
│   ├── auth.js                   — challenge/verify stile SIWE su Universal Profile
│   ├── pinata.js                 — upload verso Pinata Files API v3
│   ├── package.json
│   └── .env.example              — template variabili ambiente (nessun segreto reale)
├── scripts/
│   └── deploy.js                 — deploy + configurazione Membership/tier
├── hardhat.config.js             — reti LUKSO testnet/mainnet + verifica Blockscout
├── package.json                  — progetto Hardhat (separato da backend/package.json)
├── .env.example                  — template variabili per il deploy (root)
├── LICENSE                       — tutti i diritti riservati, contatto per permessi
├── .gitignore
└── README.md                     — questo file
```

---

## Deploy attuale — Testnet (LUKSO chain 4201)

- **SupplierRegistry**: [`0x325f6f9790409DB689cf976BcEEa621DE0606C7C`](https://explorer.execution.testnet.lukso.network/address/0x325f6f9790409DB689cf976BcEEa621DE0606C7C)
  — deployato, configurato (3 tier collegati alla Membership testnet), ownership
  trasferita alla UP ChainIntegrate testnet, **sorgente verificato pubblicamente**
- **Membership collegata (testnet)**: `0x01D0930B375d037FA988b02871812D291cC0131D`
- **Owner del contratto (UP ChainIntegrate, testnet)**: `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C`
  (diversa dalla UP ChainIntegrate **mainnet**, `0x4a2605796e0d91A9667d6E30365aEEC384C48c27`
  — non confonderle)

Non ancora deployato su mainnet.

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

**Frontend** (`frontend/index.html`) — palette "blueprint" (bianco/blu,
ancorata al mondo dei disegni tecnici), IBM Plex Sans/Mono, connessione UP
via `up-provider`, flusso di mint/schema/fornitori/valutazioni, cifratura
client-side (PBKDF2 600.000 iterazioni + AES-256-GCM). **Collegato al
flusso di autenticazione del backend**: `uploadToIPFS()` passa sempre da
`ensureSession()` (challenge → firma UP → verify → token JWT 30 minuti,
riusato tra upload finché valido). `CONFIG.REGISTRY_CONTRACT` punta già
all'indirizzo testnet deployato. Sintassi verificata, **non ancora testato
in un browser reale con estensione UP collegata** — primo test vero da
fare in fase VPS.

**Backend** (`backend/`) — Express minimale, due sole responsabilità:
autenticazione "prova che controlli questa UP" via `isValidSignature`
on-chain (stesso principio del SIWE documentato da LUKSO), e inoltro verso
Pinata Files API v3 (l'endpoint attuale, non il legacy `/pinning/pinFileToIPFS`
che si trova ancora in molti tutorial vecchi). Non cifra mai nulla, non vede
mai un PIN. Verificato in locale: il server parte, tutte le rotte rispondono,
il flusso challenge→firma→verifica testato end-to-end con un wallet vero
(manca solo il test del percorso di successo, che richiede una UP reale con
permesso SIGN e un RPC vero — non testabile in sandbox). Multer fissato a
2.x deliberatamente: la 1.x ha vulnerabilità note segnalate da `npm audit`.

**Contratto e deploy** — vedi sezione "Deploy attuale" sopra. Verificato
end-to-end (non solo sintatticamente) contro un nodo Hardhat locale reale
prima del deploy: mint, gating per tier, doppio mint rifiutato, transfer
ownership. Un bug reale scoperto e corretto durante il deploy: l'ordine
delle operazioni conta — il contratto va deployato con owner temporaneo
il deployer, configurato (Membership, tier), e **solo alla fine** trasferito
alla UP ChainIntegrate. Farlo nell'ordine sbagliato (owner = UP fin dal
costruttore) rende impossibile configurare qualunque cosa dopo, perché
nessuna chiave privata di deploy può firmare per conto di una UP.

### Da completare prima del deploy mainnet

- Test reale in browser con estensione UP collegata (fase VPS)
- `PINATA_JWT`, `LUKSO_RPC_URL` reali (già presente `JWT_SECRET`, `REGISTRY_CONTRACT_ADDRESS`
  va aggiornato) in `backend/.env` (mai committato)
- Deploy del backend su VPS con PM2, Nginx che proxy `/api/` verso la porta locale
- Test automatici (non ancora scritti — `contracts/mocks/MockMembership.sol`
  già pronto per quello)
- Decisione finale KDF (PBKDF2 nativo usato per zero dipendenze esterne;
  Argon2id/scrypt restano opzioni se si accetta di aggiungere una libreria)
- Verificare l'URL Blockscout mainnet per `hardhat verify` prima di fidarsene
  (dedotto per analogia col pattern testnet, non confermato da fonte ufficiale
  come invece lo è quello testnet)

---

## Ordine di lavoro deciso

1. **Repo** — struttura, contratto, frontend, backend, README ✅
2. **Codespace** — `hardhat.config.js`, script di deploy, deploy su **testnet**,
   configurazione Membership, verifica del sorgente su Blockscout ✅
3. **VPS** (in corso) — collegare `index.html` al backend (fatto, da testare
   dal vivo), deploy del backend con PM2, test end-to-end mint → schema →
   fornitore → valutazione con un'estensione UP reale

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
- `@nomicfoundation/hardhat-verify@2.1.3`: l'opzione `etherscan.apiKey` per
  reti Blockscout **deve** essere un oggetto per-network
  (`{ luksoTestnet: "..." }`), non una stringa nuda — con una stringa nuda
  il plugin non risale al `customChains` giusto e prova comunque l'endpoint
  Etherscan V2 diretto, fallendo con "Missing or unsupported chainid
  parameter". Scoperto confrontando con la config funzionante di MyCarBook.
  Se `npx hardhat verify` fallisce di nuovo nonostante questo, il percorso
  di riserva affidabile è: estrarre `input` da
  `artifacts/build-info/*.json` e caricarlo manualmente su Blockscout
  come Standard JSON Input (metodo già usato con successo per il deploy
  testnet attuale).

---

## Comandi utili

Ambiente Hardhat (root):
```bash
npm install
npx hardhat compile
npm run deploy:testnet    # legge .env (root) — vedi .env.example
npm run deploy:mainnet
```

Backend (`backend/`):
```bash
cd backend
npm install
cp .env.example .env      # poi compilare con i valori reali
npm start
```

Nota su un conflitto già incontrato durante l'installazione: se nel repo
finisce anche una versione più recente di `@openzeppelin/contracts` per
altri motivi, la risoluzione delle import Solidity va in conflitto con
quanto richiesto dagli LSP (`^4.9.6`) — il `package.json` di root la fissa
già esplicitamente a `4.9.6`, non toccarla senza motivo.
