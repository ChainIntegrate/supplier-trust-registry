// =======================================================================
// server.js — Supplier Trust Registry backend
//
// Due sole responsabilita', deliberatamente minime:
//   1. Verificare che chi chiama controlli davvero una certa Universal
//      Profile (via firma + isValidSignature on-chain), emettendo un
//      token di sessione breve.
//   2. Inoltrare byte gia' pronti (cifrati o pubblici, non importa quale)
//      al nodo IPFS proprio, la cui API di scrittura non e' mai esposta
//      direttamente al frontend (raggiungibile solo da questa VPS).
//
// Non fa MAI cifratura, non vede MAI un PIN, non decide MAI cosa e'
// pubblico o privato — quelle decisioni sono gia' prese lato client
// prima che i byte arrivino qui.
// =======================================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { ethers } = require("ethers");

const { createChallenge, verifyChallenge, issueSessionToken, requireAuth } = require("./auth");
const { uploadBufferToIPFS } = require("./ipfs");

const PORT = process.env.PORT || 3010;
const JWT_SECRET = process.env.JWT_SECRET;
const LUKSO_RPC_URL = process.env.LUKSO_RPC_URL;
const REGISTRY_CONTRACT_ADDRESS = process.env.REGISTRY_CONTRACT_ADDRESS;
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || "10485760", 10); // 10 MB
// Sotto questa soglia, qualunque tier puo' caricare (JSON di criteri/note,
// piccoli per natura). Sopra, serve Gold — verificato qui sul server, non
// solo nascosto/mostrato lato interfaccia: senza questo controllo, chiunque
// sapesse chiamare l'endpoint direttamente potrebbe aggirare il limite
// mostrato nella UI.
const FREE_UPLOAD_BYTES = parseInt(process.env.FREE_UPLOAD_BYTES || "307200", 10); // 300 KB
const CHALLENGE_DOMAIN = (() => {
  try {
    return new URL(process.env.FRONTEND_URL).host;
  } catch {
    return "supplier-trust-registry.chainintegrate.it";
  }
})();

for (const [name, value] of Object.entries({ JWT_SECRET, LUKSO_RPC_URL, REGISTRY_CONTRACT_ADDRESS })) {
  if (!value) {
    console.error(`Variabile ambiente mancante: ${name}. Controlla .env (vedi .env.example).`);
    process.exit(1);
  }
}

// batchMaxCount: 1 — impostazione lato client, innocua qualunque sia
// l'RPC dietro: disattiva l'aggregazione di piu' chiamate in un'unica
// richiesta (utile soprattutto con Blockscout, che la rifiuta per
// dimensione; con un nodo proprio non serve ma non fa danno lasciarla).
const rpcProvider = new ethers.JsonRpcProvider(LUKSO_RPC_URL, undefined, { batchMaxCount: 1 });

// Conferma all'avvio quale RPC sta usando davvero il backend — senza
// esporre il token per intero nei log. Il posto giusto per verificare
// che il nodo proprio sia davvero in uso e' qui (log del server), MAI
// la console del browser: il frontend non tocca mai questo URL, per
// design (il token non deve mai finire lato client).
try {
  const rpcHost = new URL(LUKSO_RPC_URL).host;
  const rpcPathMasked = LUKSO_RPC_URL.includes("/rpc/")
    ? "/rpc/" + LUKSO_RPC_URL.split("/rpc/")[1].slice(0, 6) + "…" // solo i primi caratteri del token
    : new URL(LUKSO_RPC_URL).pathname;
  console.log(`RPC configurato: ${rpcHost}${rpcPathMasked}`);
} catch {
  console.log("RPC configurato: (URL non valido? controllare LUKSO_RPC_URL)");
}

// Solo la funzione di lettura che serve qui — niente ABI completa da
// mantenere sincronizzata col contratto, un frammento minimo e stabile.
const REGISTRY_LIMITS_ABI = [
  "function getEffectiveLimits(address account) view returns (uint256 maxSuppliers, uint256 maxParams, bool canDiscloseSelectively, uint256 maxRegistries, bool canCustomizeImage)",
];
const registryContract = new ethers.Contract(REGISTRY_CONTRACT_ADDRESS, REGISTRY_LIMITS_ABI, rpcProvider);

const app = express();
// Il backend gira sempre dietro Nginx (reverse proxy sulla stessa VPS).
// Senza questa riga, Express non si fida dell'header X-Forwarded-For che
// Nginx inoltra correttamente, ed express-rate-limit rifiuta la richiesta
// con un'eccezione non gestita — la richiesta resta appesa finche' Nginx
// non va in timeout e risponde 502 al client, invece di un errore chiaro.
app.set("trust proxy", 1);
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// Limite generoso ma reale: protegge da abuso senza intralciare l'uso normale.
// Il vero limite di "chi puo' caricare" e' l'autenticazione, questo e' solo
// un secondo strato contro flood accidentali o scriptati.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
// Una sola pagina puo' generare facilmente 10-30 chiamate RPC (finestre di
// lettura eventi + varie letture view) — limite generoso apposta, serve
// solo a scoraggiare un uso improprio, non il traffico normale del sito.
// Il limite originale (600/5min) era tarato osservando la testnet, dove
// la distanza dal blocco di deploy era ~41.000 blocchi (5 finestre da
// 9.000 per ogni lettura). Sulla mainnet la stessa distanza e' quasi 3
// volte tanto (14 finestre) — e con piu' fornitori/valutazioni, il
// caricamento di una sola pagina puo' facilmente sommare centinaia di
// richieste in pochi secondi. E' il nostro nodo, non un servizio a
// pagamento con costi per chiamata — meglio essere generosi qui: il
// limite serve a scoraggiare un abuso vero, non a strozzare l'uso normale.
const rpcProxyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// =======================================================================
// GET /api/health
// =======================================================================
app.get("/api/health", (req, res) => res.json({ ok: true }));

// =======================================================================
// POST /api/rpc — proxy verso il nodo RPC proprio (LUKSO_RPC_URL, mai
// esposto al frontend). Stesso schema gia' in uso su MatchPredictor v3:
// il browser chiama solo il PROPRIO dominio, mai il nodo direttamente —
// chi ispeziona il codice o la console non vede mai ne' l'URL del nodo
// ne' tantomeno il token di accesso, entrambi restano solo qui, lato server.
//
// Lista chiusa di metodi inoltrabili: non e' un proxy RPC generico aperto
// a qualunque chiamata, solo quelle che il frontend usa davvero. Meno
// superficie per un uso improprio del nodo.
// =======================================================================
const RPC_METHOD_ALLOWLIST = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getBlockByHash", // usato da ev.getBlock() sugli eventi, per leggere il timestamp del blocco
  "net_version",
]);

app.post("/api/rpc", rpcProxyLimiter, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.method !== "string") {
    return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  }
  if (!RPC_METHOD_ALLOWLIST.has(body.method)) {
    return res.status(403).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: "Method not allowed through this proxy" } });
  }
  try {
    const upstream = await fetch(LUKSO_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    console.error("Proxy RPC fallito:", e.message);
    res.status(502).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32000, message: "Upstream RPC error" } });
  }
});

// =======================================================================
// POST /api/auth/challenge   { address }
// =======================================================================
app.post("/api/auth/challenge", authLimiter, (req, res) => {
  const { address, lang } = req.body || {};
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "invalid_address" });
  }
  const { message, nonce } = createChallenge(address, CHALLENGE_DOMAIN, lang);
  res.json({ message, nonce });
});

// =======================================================================
// POST /api/auth/verify   { address, signature }
// =======================================================================
app.post("/api/auth/verify", authLimiter, async (req, res) => {
  const { address, signature } = req.body || {};
  if (!address || !ethers.isAddress(address) || !signature) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const result = await verifyChallenge({ address, signature, rpcProvider });
  if (!result.ok) {
    console.warn(
      `[auth/verify] rifiutato per ${address}: ${result.reason}` +
      (result.detail ? ` (${result.detail})` : "")
    );
    return res.status(401).json({ error: result.reason });
  }

  const token = issueSessionToken(address, JWT_SECRET);
  res.json({ token });
});

// =======================================================================
// POST /api/ipfs/upload   (multipart/form-data, campo "file")
// Richiede header: Authorization: Bearer <token da /api/auth/verify>
// =======================================================================
app.post(
  "/api/ipfs/upload",
  uploadLimiter,
  requireAuth(JWT_SECRET),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "missing_file" });
    }

    if (req.file.size > FREE_UPLOAD_BYTES) {
      try {
        // Sopra la soglia gratuita, basta AVERE una qualunque capacita'
        // avanzata che giustifichi un upload piu' grande — documenti
        // allegati alle valutazioni (Gold, canDiscloseSelectively) o
        // immagine personalizzata del registro (Silver+, canCustomizeImage).
        // Non distinguiamo QUALE dei due sta caricando: il backend non sa
        // (ne' deve sapere) il contenuto semantico del file, solo che chi
        // lo carica ha un tier che lo giustifica.
        const [, , canDiscloseSelectively, , canCustomizeImage] = await registryContract.getEffectiveLimits(req.upAddress);
        if (!canDiscloseSelectively && !canCustomizeImage) {
          return res.status(403).json({ error: "higher_tier_required_for_large_upload" });
        }
      } catch (e) {
        console.error("Verifica tier fallita:", e.message);
        return res.status(502).json({ error: "tier_check_failed" });
      }
    }

    try {
      const filename = `${req.upAddress}-${Date.now()}`;
      const cid = await uploadBufferToIPFS(
        req.file.buffer,
        filename,
        req.file.mimetype
      );
      res.json({ cid });
    } catch (e) {
      console.error("Upload IPFS fallito:", e.message);
      res.status(502).json({ error: "ipfs_upload_failed" });
    }
  }
);

// Gestione errori multer (es. file troppo grande) in un formato coerente col resto dell'API
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large", maxBytes: MAX_UPLOAD_BYTES });
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Supplier Trust Registry backend in ascolto sulla porta ${PORT}`);
});