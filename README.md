# Supplier Trust Registry — ChainIntegrate

**Valutazione fornitori con storico verificabile e dati riservati sotto il
tuo controllo.**

Il Supplier Trust Registry permette a un'azienda di valutare i propri
fornitori secondo criteri propri e di conservarne uno storico **permanente e
non alterabile**. Ogni valutazione ha un'impronta digitale registrata su
blockchain, così chiunque sia autorizzato a leggerla può verificarne
l'integrità. Ogni nome e ogni valutazione possono restare **privati**: vengono
cifrati nel browser, prima di lasciare il dispositivo, e solo chi conosce il
codice segreto del registro può rileggerli.

Pensato per chi gestisce qualifica e monitoraggio dei fornitori, a supporto
dei processi qualità (ad esempio ISO 9001, controllo dei processi e dei
prodotti forniti dall'esterno).

**In produzione** su LUKSO mainnet. Primo utilizzo reale, con dati reali:
**La Meccanica di Precisione Srl**.

> 🇬🇧 **International clients** — The Supplier Trust Registry is available in
> Italian and English, and ChainIntegrate provides consulting, onboarding and
> support in English for international companies. See [Contacts](#contatti).

---

## Cosa offre

| Funzione | Dettaglio |
|---|---|
| **Criteri personalizzati** | Ogni registro definisce i propri criteri (es. Puntualità, Qualità, Documentazione) e la propria scala numerica; i criteri sono versionati, lo storico resta confrontabile |
| **Storico non alterabile** | Nessuna voce può essere modificata o cancellata dopo il salvataggio, nemmeno da ChainIntegrate |
| **Data di riferimento** | Ogni valutazione ha la data a cui si riferisce, non solo quella di inserimento: si possono importare storici |
| **Pubblico o privato, voce per voce** | Nome del fornitore e singola valutazione, ciascuno pubblico o cifrato, indipendentemente |
| **Grafici** | Andamento di ogni criterio nel tempo e punteggio medio di ogni valutazione |
| **Documenti allegati** (Gold) | Certificati, rapporti, non conformità: seguono la stessa scelta pubblico/privato della valutazione |
| **Più registri** (Silver, Gold) | Registri separati per categorie di fornitori, ognuno con i propri criteri e un'immagine personalizzata |
| **Continuità aziendale** | Il contratto supporta il collegamento tra registri in caso di successione aziendale, con doppia conferma |
| **Link condivisibile** | Ogni registro ha un link diretto: chi lo apre ne consulta i contenuti pubblici anche senza estensione e senza accedere |
| **Interfaccia bilingue** | Italiano e inglese, secondo la lingua del browser |

In arrivo nell'interfaccia (già supportati dal contratto): correzioni
tracciate di una valutazione e **condivisione riservata** di una singola
valutazione con un destinatario esterno (Gold).

## Piani

L'accesso richiede una **ChainIntegrate Membership** attiva.

| | Bronze | Silver | Gold |
|---|---|---|---|
| Registri | 1 | 2 | 5 |
| Fornitori per registro | 5 | 25 | 100 |
| Criteri | 4 | 8 | fino a 1000 |
| Immagine del registro | — | ✅ | ✅ |
| Documenti allegati (fino a 10 MB) | — | — | ✅ |
| Condivisione riservata | — | — | ✅ (in arrivo nell'interfaccia) |

I limiti sono configurati sul contratto e si possono adeguare senza
rilasciare un nuovo contratto.

## Privacy e sicurezza

- **Cifratura nel browser.** I dati privati sono cifrati con AES-256-GCM
  prima di lasciare il dispositivo; la chiave deriva dal codice segreto del
  registro (PBKDF2-SHA256, 600.000 iterazioni) e non viene mai inviata o
  salvata. ChainIntegrate non vede e non può recuperare i dati privati.
- **Impronte non ricostruibili.** L'impronta pubblica di un dato privato
  include un valore casuale nascosto nel contenuto cifrato: non può essere
  usata per indovinare nomi o punteggi.
- **Nessun servizio di terze parti nel browser.** Font, librerie e file sono
  serviti dall'infrastruttura ChainIntegrate (nodo IPFS e nodo LUKSO propri).
- **Accessi controllati.** Solo il proprietario di un registro può scriverci;
  il caricamento di file è riservato a chi possiede un registro; l'accesso
  avviene con firma del proprio Universal Profile, senza password.
- **Allegati sicuri.** Si aprono nel browser solo PDF e immagini riconosciuti
  dal contenuto reale; tutti gli altri formati vengono scaricati.
- **Trasparenza sui limiti.** Restano sempre visibili l'esistenza di
  fornitori e valutazioni, il loro numero e le date, l'etichetta del registro
  e i criteri. I contenuti pubblicati o caricati non possono essere
  cancellati in modo definitivo: la pagina "Come funziona" dell'app lo
  spiega agli utenti.

Stato completo delle verifiche: [Stato dell'audit](#stato-dellaudit).

---

## Architettura

```
Browser (index.html / admin.html)
  │  cifratura e decifratura solo qui
  ├── /shared/…  ───────────────► shared-assets (librerie e font, stesso dominio)
  ├── /api/rpc   ─► Backend ────► nodo RPC LUKSO (solo letture sul contratto del registro)
  ├── /api/auth, /api/ipfs/upload ─► Backend ─► API scrittura nodo IPFS (porta 5001, IP autorizzato)
  ├── estensione Universal Profile ─► firma delle scritture sul contratto
  └── lettura file ─► ipfs.chainintegrate.it (gateway del nodo, solo file propri)
                      └─ fallback: api.universalprofile.cloud (hash verificato)
```

| Componente | Tecnologia |
|---|---|
| Contratto | Solidity 0.8.27, LUKSO LSP8 (registro non trasferibile), `@lukso/lsp8-contracts` 0.18.1 |
| Frontend | HTML e JavaScript senza build, ethers 6.13.4, IBM Plex |
| Backend | Node.js ≥ 18, Express 4, PM2, dietro Nginx |
| Archiviazione | IPFS (Kubo) proprio; sulla catena solo impronte e riferimenti |

### Principi di progetto (da non riaprire senza motivo)

- **Registro non trasferibile.** La successione aziendale passa da un nuovo
  registro collegato (`proposeSuccessor` / `confirmSuccessor`), mai da un
  trasferimento.
- **Il contratto non gestisce la cifratura.** Conosce solo impronta,
  riferimento al file e flag pubblico/privato.
- **Chiave derivata dal codice segreto + identità del registro** (keccak256
  di tokenId e indirizzo del contratto), letta sempre dalla catena.
- **Ogni JSON privato contiene un `salt` casuale di 32 byte** dentro il
  contenuto cifrato: mai calcolare un'impronta pubblica su contenuto privato
  senza sale.
- **Limiti dei piani sempre configurabili** (`setTierLimits`, più contratti
  Membership accettati insieme), mai scritti nel codice.
- **Il server non vede mai dati in chiaro né codici segreti:** riceve solo
  byte già cifrati (o pubblici).
- **Tutto il contenuto scritto dagli utenti passa da `escapeHtml`** prima di
  finire nella pagina: i registri pubblici sono letti anche da chi non li ha
  scritti.

---

## Deploy attuali

### Mainnet (LUKSO, chain 42)

| | Indirizzo |
|---|---|
| SupplierRegistry V3 | [`0xFa143308D85b81Ed57547049F4A7718c3117A064`](https://explorer.execution.mainnet.lukso.network/address/0xFa143308D85b81Ed57547049F4A7718c3117A064) (blocco 8268392, sorgente verificato) |
| Membership collegata | `0x18BaFeD9B151Fb29b3cFEa35A3197F4830072a3e` (ChainIntegrateMembershipCorporate) |
| Owner del contratto (UP ChainIntegrate) | `0x4a2605796e0d91A9667d6E30365aEEC384C48c27` |

### Testnet (LUKSO, chain 4201)

| | Indirizzo |
|---|---|
| SupplierRegistry | [`0x325f6f9790409DB689cf976BcEEa621DE0606C7C`](https://explorer.execution.testnet.lukso.network/address/0x325f6f9790409DB689cf976BcEEa621DE0606C7C) (sorgente verificato) |
| Membership collegata | `0x01D0930B375d037FA988b02871812D291cC0131D` |
| Owner del contratto (UP ChainIntegrate testnet) | `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C` — diversa da quella mainnet |

---

## Struttura del repository

```
supplier-trust-registry/
├── contracts/
│   ├── SupplierRegistry-v3.sol   contratto live su mainnet
│   ├── SupplierRegistry-v2.sol   versione precedente (testnet)
│   ├── SupplierRegistry.sol      prima versione (testnet)
│   └── mocks/MockMembership.sol  solo per test locali
├── frontend/
│   ├── index.html                applicazione
│   ├── admin.html                pannello owner del contratto (piani, metadata, ripinnatura IPFS)
│   ├── how-it-works.html         guida utente IT/EN
│   └── abi.subset.json           ABI estratta dalla compilazione
├── backend/
│   ├── server.js                 rotte: proxy RPC, accesso, upload
│   ├── auth.js                   accesso con firma del Universal Profile
│   ├── ipfs.js                   upload verso il nodo IPFS
│   └── .env.example              variabili d'ambiente (senza segreti)
├── scripts/                      deploy dei contratti (deploy-v3.js per la V3)
├── docs/
│   ├── AUDIT.md                  dettaglio dell'audit
│   └── OPERATIONS.md             guida operativa (VPS, Nginx, IPFS, controllo mensile)
├── hardhat.config.js             reti LUKSO e verifica su Blockscout
└── LICENSE                       tutti i diritti riservati
```

---

## Sviluppo e deploy

**Contratti** (root):
```bash
npm install
npx hardhat compile
npx hardhat run scripts/deploy-v3.js --network luksoTestnet   # legge .env (vedi .env.example)
npx hardhat run scripts/deploy-v3.js --network luksoMainnet
```
Gli script `npm run deploy:*` puntano ancora a `scripts/deploy.js` (prima
versione): per la V3 usare il comando esplicito sopra.

`@openzeppelin/contracts` è fissato a `4.9.6` perché richiesto dagli LSP:
una versione più recente rompe la risoluzione degli import Solidity.

**Verifica del sorgente** (`hardhat-verify` 2.1.3 su Blockscout):
`etherscan.apiKey` deve essere un oggetto per rete
(`{ luksoTestnet: "...", luksoMainnet: "..." }`), non una stringa. Se
`npx hardhat verify` fallisce, il ripiego affidabile è caricare su
Blockscout l'`input` di `artifacts/build-info/*.json` come Standard JSON
Input.

**Backend**:
```bash
cd backend
npm install
cp .env.example .env      # compilare con i valori reali
npm start
```
Express gira dietro Nginx: `app.set("trust proxy", 1)` è necessario perché
il limite di richieste funzioni (senza, le richieste restano appese e Nginx
risponde 502).

**Frontend**: file statici, nessuna build. Richiede i percorsi `/shared/…`
serviti da Nginx (vedi [docs/OPERATIONS.md](docs/OPERATIONS.md)); aperto
direttamente dal disco non trova librerie e font.

Test: nessuna suite automatica; le modifiche vengono verificate con test
end-to-end mirati (Chromium e backend reale su catena simulata), documentati
nelle pull request.

## Operatività

Configurazione di VPS, Nginx, nodo IPFS, ripinnatura dei file e controllo
mensile: **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

---

## Stato dell'audit

Revisione completa di settembre 2026. Dettaglio di ogni punto, metodo e
verifiche: **[docs/AUDIT.md](docs/AUDIT.md)**.

Legenda: ✅ corretto · ⏳ aperto · 📌 limite noto, solo documentato

| Area | Punto | Stato |
|---|---|---|
| Privacy | P1 Impronte dei dati privati ricostruibili per tentativi | ✅ |
| | P1-bis Dati privati precedenti alla correzione: rischio valutato e accettato dal titolare | ✅ |
| | P2 Descrizione della privacy allineata al reale | ✅ |
| | P3 Suggerimenti per un codice segreto robusto | ✅ |
| | P4 Nessuna risorsa di terze parti; file dal nodo proprio | ✅ |
| | P5 Metadati sempre visibili dichiarati agli utenti | ✅ |
| | P6 Pubblicazione immagini solo con consenso scritto | ✅ |
| Sicurezza | S1 Apertura sicura degli allegati | ✅ |
| | S2 Upload riservato a chi possiede un registro | ✅ |
| | S3 Configurazione IPFS fuori dal codice | ✅ |
| | S3 Cifratura del tratto VPS → nodo IPFS | ⏳ |
| | S4 Proxy RPC limitato ai contratti del progetto | ✅ |
| | S5 Accesso non disturbabile da terzi | ✅ |
| | S6 Librerie servite in locale con impronte | ✅ |
| | S6 Content-Security-Policy | ⏳ |
| | S7 Vincoli imposti solo dall'interfaccia (contratto V3) | 📌 |
| Interfaccia | L1 Linguaggio comprensibile, senza gergo tecnico | ✅ |
| | U1–U3, U10 Primo accesso, rete, messaggi d'errore | ✅ |
| | U4–U9, U15 Criteri, date, punteggi, grafici, visitatori | ✅ |
| | U11 Prestazioni: lettura unica per registro e cache nel browser | ✅ |
| | U14 Consultazione senza estensione, link da condividere | ✅ |
| | U12–U13 Correzioni tracciate e condivisione riservata nell'interfaccia | ⏳ |
| | U17 Testi della guida · U18 Scrittura riservata al proprietario | ✅ |
| Documentazione | D1 Configurazione di esempio del backend | ✅ |

---

## Licenza

Tutti i diritti riservati. Il codice è pubblicato a scopo di consultazione e
valutazione; ogni altro uso richiede un consenso scritto. Vedi
[LICENSE](LICENSE).

## Contatti

**ChainIntegrate** — consulenza in integrazione dati e blockchain.
Assistenza in italiano e in inglese, anche per progetti internazionali.

- Email: [info@chainintegrate.it](mailto:info@chainintegrate.it)
- Telegram: [t.me/Simone_1977_2](https://t.me/Simone_1977_2)
- LinkedIn: [ChainIntegrate](https://www.linkedin.com/company/chainintegrate)
- Applicazione: [supplier-trust-registry.chainintegrate.it](https://supplier-trust-registry.chainintegrate.it)
