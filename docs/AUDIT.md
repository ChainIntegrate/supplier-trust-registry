# Audit 2026-09 — Supplier Trust Registry

Revisione completa di contratto, backend, frontend e infrastruttura
(settembre 2026). Ogni punto emerso è tracciato qui con il suo stato; il
riepilogo è nel [README](../README.md#stato-dellaudit).

Il repository è pubblico: i punti di sicurezza ancora aperti sono descritti
in modo generico finché non vengono corretti; il dettaglio tecnico viene
aggiunto insieme alla correzione.

Legenda: ✅ corretto · ⏳ aperto · 📌 non correggibile (contratto già
deployato o dato già scritto on-chain), solo documentato · ➖ segnalazione
non confermata

## Metodo

- Lettura completa del codice (contratto V3, backend, `index.html`,
  `admin.html`, `how-it-works.html`, script di deploy).
- Ogni correzione è stata verificata con test end-to-end in Chromium e/o
  con il backend reale avviato contro catena, nodo IPFS e gateway simulati,
  confrontando dove possibile la versione precedente (problema riprodotto)
  con quella corretta.
- Le correzioni sono state rilasciate tramite pull request dedicate e
  verificate dal vivo in produzione dove l'ambiente lo consentiva.

## Privacy

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
- ✅ **P1-bis — Dati privati scritti prima della correzione.** Restano con
  l'hash senza sale, per sempre (on-chain): non correggibile. Al momento
  della correzione il registro era usato da una sola azienda, il titolare
  dei dati, che è stata informata, ha valutato il rischio in autonomia e lo
  ha accettato. Chiuso come rischio accettato. Mitigazione disponibile per
  eventuali casi sensibili: registrare di nuovo il fornitore o la
  valutazione con la versione corretta.
- ✅ **P2 — "Come funziona" prometteva più privacy del reale.** Riscritta la
  sezione dati/fiducia; aggiunto l'elenco dei metadati sempre visibili anche
  per i dati privati (esistenza, numero, date, etichetta, criteri).
- ✅ **P3 — Robustezza del codice segreto.** Nessun vincolo tecnico imposto
  (scelta deliberata); il testo di creazione del codice e "Come funziona"
  suggeriscono una frase di qualche parola invece di una parola sola.
- ✅ **P4 — Risorse di terze parti caricate dal browser.** Font (Google
  Fonts) e librerie (esm.sh) ora serviti dal nostro dominio tramite
  `shared-assets`; lettura dei file dal nodo proprio invece che dal gateway
  Pinata. Resta solo il fallback LUKSO, usato unicamente per i file non
  presenti sul nodo (vecchi upload Pinata): ripinnarli sul nodo lo
  renderebbe superfluo. Il pannello admin ha lo strumento "Files to re-pin
  on the IPFS node": elenca tutti i file referenziati dal contratto, verifica
  quali mancano sul nodo e prepara i comandi `ipfs pin add` da eseguire sul
  nodo (per gli allegati di valutazioni private serve il codice segreto del
  registro, usato solo nella pagina). Il controllo interroga sempre il
  gateway senza cache del browser e, per ogni file mancante, mostra la
  risposta del nodo e del gateway LUKSO (codice HTTP, timeout, errore di
  rete). I file dei tempi di Pinata sono stati ripinnati sul nodo: il
  fallback LUKSO resta solo come rete di sicurezza.

  Il gateway `ipfs.chainintegrate.it` ha un limite di richieste per IP
  (Nginx `limit_req`, 10 r/s): oltre il limite risponde 429 (503 con la
  configurazione precedente). Frontend e pannello admin non lo trattano
  come "file mancante": aspettano e riprovano fino a 3 volte (0,5/1/2 s)
  prima di passare al gateway LUKSO. Consigliato sul gateway:
  `limit_req zone=ipfs_gateway burst=100 nodelay;` e `limit_req_status 429;`
  (la pagina di un registro può caricare decine di file in pochi istanti).

  Procedura sul nodo (utente `ubuntu`, demone IPFS eseguito come `ipfs`):
  incollare i comandi copiati dal pannello in `~/repin.sh`, poi dentro una
  sessione `tmux` eseguire `sudo -u ipfs -H bash < ~/repin.sh`. Verifica:
  `sudo -u ipfs -H ipfs pin ls --type=recursive <cid>` e nuovo Scan dal
  pannello.
- ✅ **P5 — Metadati sempre visibili anche per i dati privati** (esistenza,
  numero e date di fornitori/valutazioni, etichetta del registro, criteri):
  inevitabili per rendere lo storico verificabile, spiegati in "Come funziona".
- ✅ **P6 — Pubblicazione di immagine/etichetta di un registro come metadata
  standard dal pannello admin.** Procedura: l'admin pubblica solo dopo
  consenso del proprietario del registro via email, con allegata l'immagine
  da pubblicare. Promemoria aggiunto nel pannello admin.

## Sicurezza

- ✅ **S1 — Allegati aperti come pagine del sito.** Il tipo dell'allegato
  lo dichiara chi lo carica e un `blob:` URL appartiene al dominio del sito:
  un allegato HTML/SVG di una valutazione pubblica, aperto da un visitatore,
  eseguiva codice come una pagina nostra, con accesso alla pagina d'origine
  (verificato: il titolo della pagina del registro veniva modificato).
  Corretto in `openAttachmentSafely`: il tipo si ricava dai byte del file,
  mai dal JSON; si aprono (in scheda isolata, `noopener`) solo PDF e
  immagini PNG/JPEG/GIF/WebP riconosciuti, tutto il resto si scarica come
  `application/octet-stream` con nome ripulito. Vale anche per gli allegati
  già caricati.
- ✅ **S2 — Upload consentito a qualunque Universal Profile.** Bastava
  firmare con una UP qualsiasi (gratuita da creare) per caricare e far
  pinnare file sul nodo, anche via script. Ora `/api/ipfs/upload` accetta
  solo chi ha almeno un Registro su questo contratto o è l'owner del
  contratto (pannello admin), verificato on-chain (cache 5 min), e il
  controllo avviene prima di ricevere il file.
- ✅ **S3 (parte 1)** — indirizzo dell'API IPFS spostato da codice a `.env`
  (`IPFS_API_URL`, come in traceability-registry). Resta nella cronologia
  git: la protezione vera è il firewall del nodo.
- ⏳ **S3 (parte 2)** — tratto VPS → nodo IPFS in chiaro: da valutare
  TLS/tunnel (vale anche per traceability-registry). Non urgente: i
  contenuti privati viaggiano già cifrati.
- ✅ **S4 — Proxy RPC aperto a qualunque contratto.** `/api/rpc` ora
  accetta `eth_call` ed `eth_getLogs` solo verso il contratto del registro
  (più `RPC_EXTRA_ALLOWED_ADDRESSES` da `.env`, vuoto di default), e
  `eth_getLogs` solo con indirizzo esplicito e al massimo 10.000 blocchi.
- ✅ **S5 — Challenge di accesso sovrascrivibili.** Il server teneva una
  sola challenge per indirizzo: chiunque poteva chiederne di continuo per
  l'indirizzo di un altro e far fallire il suo accesso, e quelle mai usate
  restavano in memoria. Ora le challenge non hanno stato per indirizzo: il
  server consegna un `challengeToken` firmato (HMAC) che lega indirizzo,
  nonce, scadenza (5 min) e impronta del messaggio; alla verifica il client
  lo rimanda. Uso singolo tramite l'elenco dei nonce già usati, ripulito
  alla scadenza.
- ✅ **S6 (parte 1)** — nessuna libreria da CDN: ethers ed erc725.js da
  `shared-assets`, versioni fissate e impronte in `SHA256SUMS`.
- ⏳ **S6 (parte 2)** — Content-Security-Policy da aggiungere in Nginx.
- 📌 **S7** — vincoli applicati solo lato interfaccia perché il contratto V3
  non li impone (già noto per `addEvaluation`); da riprendere solo in
  un'eventuale V4.

## Interfaccia

- ✅ **L1 — Linguaggio troppo tecnico/blockchain** (IT/EN): "Minta",
  "transazione", "on-chain", "wallet", "tier", "IPFS", "UP", "disclosure
  selettiva" sostituiti con termini d'uso comune (crea registro,
  salvataggio, app Universal Profile, piano, file, condivisione riservata).
  Identificativi tecnici (tokenId, hash) tolti dalla vista principale;
  l'identificativo del registro resta in "Dettagli tecnici". "Come
  funziona" riscritta con un solo riquadro finale per i lettori tecnici.
- ✅ **U1** — Senza Membership la schermata dei registri diceva "hai
  raggiunto il massimo (0)" invece di "Nessuna Membership attiva": il
  contratto restituisce un BigInt e `0n === 0` è falso. Corretto
  convertendo il valore prima dei confronti.
- ✅ **U2** — All'apertura la pagina restava su "Connessione in corso…"
  finché non si cliccava. Ora: senza estensione, schermata di benvenuto
  con le istruzioni; con estensione non ancora autorizzata, benvenuto con
  il pulsante "Accedi"; con sito già autorizzato, accesso automatico.
- ✅ **U3** — Nessun controllo della rete dell'estensione. Ora, se
  l'estensione non è su LUKSO mainnet, la pagina si ferma con un messaggio
  chiaro e un pulsante che chiede all'estensione di cambiare rete (la
  pagina si ricarica da sola al cambio).
- ✅ **U4** — I nomi dei criteri venivano ricavati tagliando l'etichetta a
  `" ("`: "Tempi (consegna)" e "Tempi (risposta)" diventavano un unico
  criterio "Tempi" e un punteggio andava perso (verificato). Ora i nomi
  arrivano direttamente dallo schema.
- ✅ **U5** — Nota, interruttore pubblico/privato e allegato restavano
  impostati passando da un fornitore all'altro. Ora il modale si apre
  sempre pulito.
- ✅ **U6** — La data proposta era calcolata in UTC (alle 00:30 del 27/09
  italiane proponeva il 26/09, verificato). Ora usa l'ora locale.
- ✅ **U7** — La data vuota veniva accettata e un punteggio vuoto valeva 0
  (salvato davvero quando lo 0 rientrava nella scala). Ora data e punteggi
  sono obbligatori.
- ✅ **U8** — Un punteggio non numerico in un dato salvato mandava in errore
  il grafico e con lui l'intera lista delle valutazioni del fornitore
  (verificato). Ora i valori non numerici vengono ignorati nei grafici.
- ✅ **U9** — Il "valore precedente" mostrato nel modale non passava da
  `escapeHtml`: HTML presente in una valutazione veniva eseguito nella
  pagina del proprietario (verificato). Ora è mostrato come testo.
- ✅ **U10** — Errori di rete e rifiuto nel wallet lasciavano la pagina
  ferma senza messaggio. Ora accesso e caricamenti mostrano "Accesso
  annullato" o "Caricamento non riuscito" con un pulsante "Riprova", che
  ricrea la connessione e torna al registro aperto. Il provider di lettura
  usa una rete fissa (`staticNetwork`), così un guasto momentaneo del nodo
  non blocca anche i tentativi successivi.
- ✅ **U11** — Ogni fornitore rileggeva l'intero storico eventi dal blocco
  di deploy e faceva una richiesta per ogni valutazione: il numero di
  richieste cresceva con fornitori, valutazioni ed età della catena. Ora
  una sola lettura per registro (fornitori e valutazioni insieme), finestre
  lette in parallelo, risultati e timestamp dei blocchi ricordati nel
  browser (`localStorage`, solo dati già pubblici sulla catena): alle
  visite successive si leggono solo i blocchi nuovi. Misurato su un
  registro di prova con 8 fornitori, 32 valutazioni e 150.000 blocchi di
  storia: da 244 a 73 richieste alla prima visita, a 9 alle successive.
- ⏳ **U12** — Le correzioni tracciate (`supersedes`), supportate dal
  contratto, non sono utilizzabili dall'interfaccia; le valutazioni
  corrette restano nei grafici.
- ⏳ **U13** — La condivisione riservata (Gold), supportata dal contratto,
  non è ancora disponibile nell'interfaccia.
- ⏳ **U14** — Per consultare un registro pubblico serve comunque
  l'estensione; manca un pulsante "condividi link".
- ✅ **U15** — I visitatori vedevano "Sblocca per vedere" su contenuti
  privati. Ora vedono "Contenuto riservato" con un pulsante secondario "Ho
  il codice del registro": la chiave dipende dal codice e dal registro, non
  da chi è collegato, quindi un collaboratore con un altro Universal
  Profile che conosce il codice può comunque leggere i dati privati.
- ➖ **U16** — Non confermato: il tag in `admin.html` è chiuso
  correttamente. La segnalazione nasceva da un output troncato durante la
  revisione.
- ✅ **U18** — Il pulsante "+ Valutazione" era visibile anche ai visitatori
  (segnalato in produzione dal titolare): compilato il modale, il
  salvataggio veniva rifiutato dal server alla firma (la sessione di
  upload è a nome del proprietario) — nessun dato scritto, nessun rischio,
  ma un'esperienza sbagliata. Ora è visibile solo al proprietario, come
  "+ Nuovo fornitore" e "Cambia immagine": il codice del registro serve a
  leggere, per scrivere bisogna essere il proprietario.
- ✅ **U17** — "Come funziona" parlava di "media per criterio": il grafico
  mostra la media di ciascuna valutazione. Testo corretto.
- ✅ **D1** — `backend/.env.example` allineato: via Pinata, porta 3011,
  contratto V3 mainnet, nuova variabile `IPFS_API_URL`.
