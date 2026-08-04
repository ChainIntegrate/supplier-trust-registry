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
├── backend/
│   ├── server.js                 — Express, wiring delle rotte
│   ├── auth.js                   — challenge/verify stile SIWE su Universal Profile
│   ├── pinata.js                 — upload verso Pinata Files API v3
│   ├── package.json
│   └── .env.example              — template variabili ambiente (nessun segreto reale)
├── LICENSE                       — tutti i diritti riservati, contatto per permessi
├── .gitignore
└── README.md                     — questo file
```

Non ancora presenti nel repo: `hardhat.config.js` e script di deploy — arrivano
nella fase Codespace (vedi "Ordine di lavoro" più sotto).

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
**Non ancora collegato al nuovo flusso di autenticazione del backend** (vedi
sotto) — `uploadToIPFS()` chiama ancora `/api/ipfs/upload` senza passare da
`/api/auth/challenge` → firma → `/api/auth/verify` → token. Va sistemato
nella fase VPS (vedi "Ordine di lavoro").

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

### Da completare prima di un deploy reale

- `hardhat.config.js` + script di deploy — **fase Codespace**, prossimo passo
- `CONFIG.REGISTRY_CONTRACT` e `CONFIG.RPC_URL` in `index.html` — dopo il deploy
- Collegare `index.html` al flusso di autenticazione del backend — **fase VPS**
- `PINATA_JWT`, `LUKSO_RPC_URL`, `JWT_SECRET` veri in `backend/.env` (mai committato)
- Verifica empirica dell'import di `@lukso/up-provider` via esm.sh in un
  browser reale con estensione UP collegata
- Test automatici (non ancora scritti)
- Decisione finale KDF (PBKDF2 nativo usato per zero dipendenze esterne;
  Argon2id/scrypt restano opzioni se si accetta di aggiungere una libreria)

---

## Ordine di lavoro deciso

1. **Repo** (qui) — struttura, contratto, frontend, backend, README aggiornato ✅
2. **Codespace** — `hardhat.config.js`, script di deploy, deploy su **testnet**
   (mai direttamente mainnet per un primo test), configurazione Membership
   (contratti accettati + limiti per tier) sul contratto appena deployato
3. **VPS** — collegare `index.html` al backend (auth + upload reale),
   deploy del backend con PM2, test end-to-end mint → schema → fornitore →
   valutazione

Non saltare l'ordine senza motivo: il deploy (punto 2) è testabile solo
in parte senza il punto 3 (mint e definizione schema sì, aggiungere
fornitori/valutazioni no, perché serve l'upload IPFS funzionante).

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
