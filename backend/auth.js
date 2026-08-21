// =======================================================================
// auth.js — autenticazione "prova che controlli questa UP", senza wallet
// custody, senza password. Stesso principio del flusso SIWE documentato
// da LUKSO (docs.lukso.tech/learn/universal-profile/connect-profile/siwe),
// nella variante "raw message" invece della libreria SIWE completa, per
// restare senza dipendenze extra.
//
// Perche' serve: senza questo, l'endpoint di upload sarebbe un relay
// aperto — chiunque potrebbe caricare byte a piacere sul vostro account
// Pinata, a vostre spese, senza nemmeno possedere un Registro.
//
// Flusso:
//   1. Il frontend chiede una "challenge" per il proprio indirizzo
//   2. Firma il messaggio con la UP (via UP browser extension / up-provider)
//   3. Il backend verifica la firma direttamente on-chain via isValidSignature
//      (ERC1271 / LSP6 — funziona sia con controller EOA singolo sia con
//      Key Manager, la UP la valida secondo la propria logica di permessi)
//   4. Se valida, emette un JWT di sessione breve (30 minuti) da usare per
//      gli upload successivi — cosi' non serve rifirmare ad ogni singolo file
// =======================================================================

const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minuti
const SESSION_TTL = "30m";

// NOTA: store in memoria di processo. Va bene per una singola istanza PM2;
// se in futuro si passa a PM2 cluster mode con piu' processi, questo store
// va spostato su qualcosa di condiviso (es. Redis) perche' ogni processo
// avrebbe la propria mappa isolata e le challenge non combacerebbero.
const pendingChallenges = new Map(); // address (lowercase) -> { nonce, message, expiresAt }

function randomNonce() {
  return ethers.hexlify(ethers.randomBytes(12)).slice(2); // 24 caratteri esadecimali
}

// Solo questa riga del messaggio deve essere leggibile per un umano nella
// sua lingua — tutto il resto (URI, Nonce, Issued At) e' gia' in inglese
// per convenzione SIWE, non tocca l'utente comune. Il frontend passa la
// lingua rilevata nel browser; se manca o non e' supportata, inglese.
const CHALLENGE_DESCRIPTIONS = {
  it: "Autorizzi il caricamento di un file su IPFS per il tuo Supplier Trust Registry.",
  en: "You authorize uploading a file to IPFS for your Supplier Trust Registry.",
};

function buildChallengeMessage({ address, domain, nonce, lang }) {
  const issuedAt = new Date().toISOString();
  const description = CHALLENGE_DESCRIPTIONS[lang] || CHALLENGE_DESCRIPTIONS.en;
  return [
    `${domain} wants you to sign in with your Universal Profile:`,
    ``,
    address,
    ``,
    description,
    ``,
    `URI: https://${domain}`,
    `Version: 1`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

function createChallenge(address, domain, lang) {
  const normalized = address.toLowerCase();
  const nonce = randomNonce();
  const message = buildChallengeMessage({ address, domain, nonce, lang });
  pendingChallenges.set(normalized, {
    nonce,
    message,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return { message, nonce };
}

const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const ISVALIDSIGNATURE_ABI = [
  "function isValidSignature(bytes32 dataHash, bytes signature) view returns (bytes4)",
];

async function verifyChallenge({ address, signature, rpcProvider }) {
  const normalized = address.toLowerCase();
  const pending = pendingChallenges.get(normalized);

  if (!pending) return { ok: false, reason: "no_pending_challenge" };
  if (Date.now() > pending.expiresAt) {
    pendingChallenges.delete(normalized);
    return { ok: false, reason: "challenge_expired" };
  }

  // uso singolo: valida o no, la challenge non e' piu' riutilizzabile
  pendingChallenges.delete(normalized);

  const hashedMessage = ethers.hashMessage(pending.message);
  const upContract = new ethers.Contract(address, ISVALIDSIGNATURE_ABI, rpcProvider);

  try {
    const result = await upContract.isValidSignature(hashedMessage, signature);
    if (result.toLowerCase() === ERC1271_MAGIC_VALUE) {
      return { ok: true };
    }
    return { ok: false, reason: "invalid_signature" };
  } catch (e) {
    // indirizzo senza codice (EOA nudo, non una vera UP) o RPC irraggiungibile
    return { ok: false, reason: "verification_failed", detail: e.message };
  }
}

function issueSessionToken(address, jwtSecret) {
  return jwt.sign({ address: address.toLowerCase() }, jwtSecret, { expiresIn: SESSION_TTL });
}

function requireAuth(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing_token" });

    try {
      const payload = jwt.verify(token, jwtSecret);
      req.upAddress = payload.address;
      next();
    } catch (e) {
      return res.status(401).json({ error: "invalid_or_expired_token" });
    }
  };
}

module.exports = { createChallenge, verifyChallenge, issueSessionToken, requireAuth };