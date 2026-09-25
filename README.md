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
│   ├── SupplierRegistry-v3.sol   — contratto live su mainnet (LSP8, soulbound)
│   ├── SupplierRegistry-v2.sol   — versione precedente (testnet)
│   ├── SupplierRegistry.sol      — prima versione (testnet)
│   └── mocks/
│       └── MockMembership.sol    — SOLO per test locali, mai deployare su LUKSO vera
├── frontend/
│   ├── index.html                — SPA vanilla JS, mini-app per il Grid
│   ├── admin.html                — pannello owner del contratto (tier, metadata)
│   ├── how-it-works.html         — guida utente IT/EN
│   └── abi.subset.json           — ABI curata usata da index.html (estratta
│                                    dalla compilazione reale, non scritta a mano)
├── backend/
│   ├── server.js                 — Express, wiring delle rotte
│   ├── auth.js                   — challenge/verify stile SIWE su Universal Profile
│   ├── ipfs.js                   — upload/pin verso il nodo IPFS proprio (Kubo)
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

## Deploy attuale — Mainnet (LUKSO chain 42)

- **SupplierRegistry V3**: [`0xFa143308D85b81Ed57547049F4A7718c3117A064`](https://explorer.execution.mainnet.lukso.network/address/0xFa143308D85b81Ed57547049F4A7718c3117A064)
  (block 8268392) — deployato, configurato, ownership trasferita alla UP
  ChainIntegrate mainnet, **sorgente verificato pubblicamente**, live in
  produzione con dati reali
- **Membership collegata (mainnet)**: `0x18BaFeD9B151Fb29b3cFEa35A3197F4830072a3e`
  (ChainIntegrateMembershipCorporate)
- **Owner del contratto (UP ChainIntegrate, mainnet)**: `0x4a2605796e0d91A9667d6E30365aEEC384C48c27`

## Deploy attuale — Testnet (LUKSO chain 4201)

- **SupplierRegistry**: [`0x325f6f9790409DB689cf976BcEEa621DE0606C7C`](https://explorer.execution.testnet.lukso.network/address/0x325f6f9790409DB689cf976BcEEa621DE0606C7C)
  — deployato, configurato (3 tier collegati alla Membership testnet), ownership
  trasferita alla UP ChainIntegrate testnet, **sorgente verificato pubblicamente**
- **Membership collegata (testnet)**: `0x01D0930B375d037FA988b02871812D291cC0131D`
- **Owner del contratto (UP ChainIntegrate, testnet)**: `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C`
  (diversa dalla UP ChainIntegrate **mainnet**, `0x4a2605796e0d91A9667d6E30365aEEC384C48c27`
  — non confonderle)

---

## Stato attuale

**Contratto** (`contracts/SupplierRegistry.sol`) — deployato su mainnet e
testnet (vedi sopra), compila pulito contro `@lukso/lsp8-contracts@0.18.1` /
`@lukso/lsp4-contracts@0.17.3`, sotto il limite EIP-170 con optimizer
`runs: 1` (~18,7 KB). Verificato end-to-end contro un nodo Hardhat locale
reale prima del deploy (mint, gating per tier, doppio mint rifiutato,
transfer ownership) e ora anche **in produzione con dati reali**. Copre:

- mint self-service del Registro, gated da Membership (multi-contratto,
  limiti configurabili per `(contratto, tier)` senza bisogno di redeploy)
- schema di valutazione versionato per registro (parametri custom, scala
  numerica personalizzabile)
- fornitori e valutazioni come eventi + contatori minimi (niente array in
  storage — stesso pattern `eth_getLogs` già in uso in MatchPredictor)
- privacy **per singola valutazione** (hash on-chain sempre, contenuto dietro
  un puntatore IPFS che risolve a cifrato o in chiaro) e **per nome fornitore**
  (stesso meccanismo)
- correzione errori via `supersedes` (append-only, storico mai perso)
- disclosure selettiva (feature Gold) con prova on-chain, cifratura re-key
  interamente client-side
- continuità di reputazione tra registri in caso di successione aziendale,
  a doppia conferma (vecchio propone, nuovo accetta)

**Frontend** (`frontend/index.html`) — palette "blueprint" (bianco/blu,
ancorata al mondo dei disegni tecnici), IBM Plex Sans/Mono. **Non usa
`up-provider`**: pagina standalone, connessione via `window.lukso`
(iniettato dalla UP Browser Extension su qualunque pagina, come
`window.ethereum` di MetaMask) — `up-provider` richiede l'incorporamento
in un iframe dentro il Grid di universaleverything.io, incompatibile con
l'uso come sito normale. Il registro da visualizzare viene da `?tokenId=`
nell'URL, o dalla lista dei propri registri per default — permette anche di
condividere un link diretto a un registro pubblico altrui.

Flusso completo testato dal vivo, con dati reali, su più dispositivi:
mint → definizione schema → fornitore (pubblico e privato) → valutazione
(pubblica e privata) → lettura e decifratura confermata **indipendentemente**
(un file cifrato scaricato da IPFS decifrato con successo in uno script
Node separato, stessa logica PBKDF2+AES-GCM del browser). Cifratura
client-side confermata **coerente tra dispositivi diversi** (stesso PIN,
stessa chiave, ovunque — proprio l'obiettivo per cui si era scartata la
derivazione da firma wallet in fase di progettazione).

**Backend** (`backend/`) — Express minimale, deployato su VPS con PM2
(`supplier-trust-registry-backend`, porta 3011) dietro Nginx
(`supplier-trust-registry.chainintegrate.it`, proxy su `/api/`, certificato
Let's Encrypt). Due sole responsabilità: autenticazione "prova che controlli
questa UP" via `isValidSignature` on-chain (stesso principio del SIWE
documentato da LUKSO), e inoltro verso Pinata Files API v3. Non cifra mai
nulla, non vede mai un PIN. Multer fissato a 2.x deliberatamente (la 1.x
ha vulnerabilità note).

### Lezioni dal primo test dal vivo

Problemi reali trovati e corretti portando tutto in produzione — vale la
pena non riscoprirli:

- **`up-provider` richiede il Grid**: "No UP found" aprendo l'URL
  direttamente non è un bug, è il comportamento corretto per una libreria
  pensata per girare in iframe dentro universaleverything.io. Per un sito
  standalone serve `window.lukso` (EIP-1193 standard), non `up-provider`.
- **Express dietro Nginx senza `trust proxy`**: `express-rate-limit`
  rifiuta silenziosamente le richieste quando rileva `X-Forwarded-For` ma
  Express non si fida del proxy — la richiesta resta appesa finché Nginx
  non va in timeout e risponde 502. Serve `app.set("trust proxy", 1)`
  per qualunque Express dietro reverse proxy locale.
- **`gateway.pinata.cloud` non esiste più** come dominio pubblico
  condiviso — Pinata è passata a gateway dedicati per-account
  (`<nome>.mypinata.cloud`, visibile nella dashboard Pinata → Gateways).
- **Chain id testnet è 4201, non 42** — 42 è mainnet. Facile confondersi
  copiando configurazioni pensate per mainnet (es. URL RPC thirdweb).
- **Il codice segreto va richiesto solo quando serve davvero** — non ad
  ogni apertura di un modale, solo al momento di cifrare qualcosa di
  privato. Un fornitore/valutazione pubblica non deve mai chiederlo.
- **Contenuto utente in `innerHTML` va sempre passato da `escapeHtml()`**
  — con `?address=` che permette a chiunque di visitare un registro
  pubblico altrui, un nome criterio o una nota non innocua scritta dal
  proprietario diventerebbe eseguibile nel browser di un visitatore
  ignaro. Non è un rischio teorico una volta che il contenuto può essere
  letto da chi non l'ha scritto.

### Chiusi

- ~~Decisione finale KDF~~ — restiamo con PBKDF2 nativo + AES-256-GCM,
  confermato in produzione con dati reali: stesso PIN → stessa chiave
  derivata su dispositivi diversi. Argon2id/scrypt mai implementati,
  nessun bisogno emerso di aggiungere quella dipendenza
- ~~Rivedere `express-rate-limit` con `trust proxy` attivo~~ — `app.set("trust
  proxy", 1)` aggiunto (i 502 in produzione erano causati proprio dalla sua
  assenza), limite RPC alzato da 600 a 3000 richieste/5min per il traffico
  mainnet reale
- ~~Verificare l'URL Blockscout mainnet per `hardhat verify`~~ — confermato:
  verifica sorgente riuscita sul contratto mainnet (vedi sezione deploy sopra)

**Test automatici**: nessuna suite pianificata (niente `test/`, niente
script `test` in `package.json` — `contracts/mocks/MockMembership.sol`
resta comunque pronto se in futuro servisse). Approccio scelto: manutenzione
reattiva su richieste e utilizzo reale, non copertura automatica preventiva.

---

## Audit 2026-09

Revisione completa di contratto, backend e frontend (settembre 2026). Qui si
tiene traccia di ogni punto emerso e del suo stato. Il repo è pubblico: i
punti ancora aperti sono descritti in modo generico finché non vengono
corretti; il dettaglio tecnico viene aggiunto con la correzione.

Legenda: ✅ corretto · ⏳ aperto · 📌 non correggibile (contratto già
deployato o dato già scritto on-chain), solo documentato

### Privacy

- ✅ **P1 — Hash on-chain di dati privati ricostruibile per tentativi.**
  `nameHash` (fornitore privato) e `contentHash` (valutazione privata) erano
  il keccak256 del JSON **in chiaro**, senza nessun elemento segreto. Il file
  su IPFS era (ed è) cifrato, ma chi indovinava il contenuto esatto poteva
  confermarlo confrontando l'hash: verificato su dati reali per un nome
  fornitore; per una valutazione senza note il costo dipende dalla
  dimensione dello schema (pubblico). Corretto in `encryptJSON`: ogni JSON
  privato riceve un `salt` casuale di 32 byte dentro il blob cifrato, quindi
  l'hash non è più indovinabile, resta verificabile da chi decifra e la
  lettura dei dati vecchi (senza `salt`) è invariata. Rimossa anche la
  visualizzazione di `nameHash` nell'interfaccia.
- 📌 **P1-bis — Dati privati scritti prima della correzione.** Restano con
  l'hash senza sale, per sempre (on-chain). Al momento della correzione il
  registro era usato da una sola azienda, già informata
  direttamente: nessuna nota pubblica necessaria. Mitigazione possibile per
  casi sensibili: registrare di nuovo il fornitore/la valutazione con la
  versione corretta.
- ✅ **P2 — "Come funziona" prometteva più privacy del reale.** Riscritta la
  sezione dati/fiducia; aggiunto l'elenco dei metadati sempre visibili anche
  per i dati privati (esistenza, numero, date, etichetta, criteri).
- ✅ **P3 — Robustezza del codice segreto.** Nessun vincolo tecnico imposto
  (scelta deliberata); il testo di creazione del codice e "Come funziona"
  suggeriscono una frase di qualche parola invece di una parola sola.
- ⏳ **P4 — Risorse di terze parti caricate dal browser** (font, librerie,
  gateway di lettura): trasferimento di dati dei visitatori a terzi.
- ✅ **P5 — Metadati sempre visibili anche per i dati privati** (esistenza,
  numero e date di fornitori/valutazioni, etichetta del registro, criteri):
  inevitabili per rendere lo storico verificabile, spiegati in "Come funziona".
- ✅ **P6 — Pubblicazione di immagine/etichetta di un registro come metadata
  standard dal pannello admin.** Procedura: l'admin pubblica solo dopo
  consenso del proprietario del registro via email, con allegata l'immagine
  da pubblicare. Promemoria aggiunto nel pannello admin.

### Sicurezza

- ⏳ **S1** — gestione degli allegati lato visitatore (priorità alta).
- ⏳ **S2** — controllo di autorizzazione sull'upload da rafforzare.
- ⏳ **S3** — configurazione infrastrutturale da spostare in `.env` e da
  cifrare in transito.
- ⏳ **S4** — proxy RPC da restringere ai soli contratti del progetto.
- ⏳ **S5** — gestione delle challenge di autenticazione (robustezza).
- ⏳ **S6** — integrità delle librerie caricate da CDN (SRI/CSP).
- 📌 **S7** — vincoli applicati solo lato interfaccia perché il contratto V3
  non li impone (già noto per `addEvaluation`); da riprendere solo in
  un'eventuale V4.

### Interfaccia

- ✅ **L1 — Linguaggio troppo tecnico/blockchain** (IT/EN): "Minta",
  "transazione", "on-chain", "wallet", "tier", "IPFS", "UP", "disclosure
  selettiva" sostituiti con termini d'uso comune (crea registro,
  salvataggio, app Universal Profile, piano, file, condivisione riservata).
  Identificativi tecnici (tokenId, hash) tolti dalla vista principale;
  l'identificativo del registro resta in "Dettagli tecnici". "Come
  funziona" riscritta con un solo riquadro finale per i lettori tecnici.
- ⏳ **U1–U17** — bug dell'interfaccia individuati (messaggio errato senza
  Membership, stato "Connessione in corso…" iniziale, controllo di rete
  mancante, criteri con parentesi nel nome, campi del modale valutazione
  non azzerati, data UTC, gestione errori, prestazioni della lettura
  eventi, correzioni/condivisione riservata non disponibili in UI, HTML
  malformato in `admin.html`).
- ✅ **U17** — "Come funziona" parlava di "media per criterio": il grafico
  mostra la media di ciascuna valutazione. Testo corretto.
- ⏳ **D1** — `backend/.env.example` non allineato (riferimenti Pinata, RPC,
  porta).

---

## Ordine di lavoro deciso

1. **Repo** — struttura, contratto, frontend, backend, README ✅
2. **Codespace** — `hardhat.config.js`, script di deploy, deploy su **testnet**,
   configurazione Membership, verifica del sorgente su Blockscout ✅
3. **VPS** — backend deployato con PM2 + Nginx, frontend collegato,
   flusso completo testato dal vivo con dati reali (mint → schema →
   fornitore → valutazione → decifratura) ✅
4. **Mainnet** — deploy `0xFa143308D85b81Ed57547049F4A7718c3117A064`,
   configurazione Membership Corporate mainnet, ownership trasferita alla UP
   ChainIntegrate mainnet, sorgente verificato, VPS aggiornato ✅

Prossimo: manutenzione su richieste e utilizzo reale, pubblicazione sullo
UP! Store (PR aperta).

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
- Chiave di cifratura derivata da PIN utente + sale (keccak256 di tokenId
  del registro + indirizzo contratto), **letto sempre dalla catena**, mai
  dalla sessione corrente — ChainIntegrate non salva né può recuperare nulla
- Ogni JSON privato contiene un campo `salt` casuale (32 byte) **dentro** il
  blob cifrato: l'hash pubblicato on-chain non si può ricostruire per
  tentativi (vedi Audit 2026-09, P1). Mai calcolare un hash on-chain su
  contenuto privato senza questo sale
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