// =======================================================================
// server.js — Supplier Trust Registry backend
//
// Due sole responsabilita', deliberatamente minime:
//   1. Verificare che chi chiama controlli davvero una certa Universal
//      Profile (via firma + isValidSignature on-chain), emettendo un
//      token di sessione breve.
//   2. Inoltrare byte gia' pronti (cifrati o pubblici, non importa quale)
//      a Pinata, tenendo la JWT Pinata lontana dal frontend.
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
const { uploadBufferToPinata } = require("./pinata");

const PORT = process.env.PORT || 3010;
const JWT_SECRET = process.env.JWT_SECRET;
const PINATA_JWT = process.env.PINATA_JWT;
const LUKSO_RPC_URL = process.env.LUKSO_RPC_URL;
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || "2097152", 10);
const CHALLENGE_DOMAIN = (() => {
  try {
    return new URL(process.env.FRONTEND_URL).host;
  } catch {
    return "supplier-trust-registry.chainintegrate.it";
  }
})();

for (const [name, value] of Object.entries({ JWT_SECRET, PINATA_JWT, LUKSO_RPC_URL })) {
  if (!value) {
    console.error(`Variabile ambiente mancante: ${name}. Controlla .env (vedi .env.example).`);
    process.exit(1);
  }
}

const rpcProvider = new ethers.JsonRpcProvider(LUKSO_RPC_URL);

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
// POST /api/auth/challenge   { address }
// =======================================================================
app.post("/api/auth/challenge", authLimiter, (req, res) => {
  const { address } = req.body || {};
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "invalid_address" });
  }
  const { message, nonce } = createChallenge(address, CHALLENGE_DOMAIN);
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
    try {
      const filename = `${req.upAddress}-${Date.now()}`;
      const cid = await uploadBufferToPinata(
        req.file.buffer,
        filename,
        req.file.mimetype,
        PINATA_JWT
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

app.listen(PORT, () => {
  console.log(`Supplier Trust Registry backend in ascolto sulla porta ${PORT}`);
});