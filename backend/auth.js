// =======================================================================
// auth.js — autenticazione "prova che controlli questa UP", senza wallet
// custody, senza password. Stesso principio del flusso SIWE documentato
// da LUKSO (docs.lukso.tech/learn/universal-profile/connect-profile/siwe),
// nella variante "raw message" invece della libreria SIWE completa, per
// restare senza dipendenze extra.
//
// Perche' serve: senza questo, l'endpoint di upload sarebbe un relay
// aperto — chiunque potrebbe caricare e far pinnare byte a piacere sul
// nodo IPFS proprio. Chi PUO' caricare (registro o owner del contratto)
// lo decide poi server.js (audit S2); qui si prova solo CHI e'.
//
// Flusso:
//   1. Il frontend chiede una "challenge" per il proprio indirizzo e riceve
//      messaggio + challengeToken (vedi sotto, nessuno stato lato server)
//   2. Firma il messaggio con la UP (via UP browser extension) e rimanda
//      firma, messaggio e challengeToken
//   3. Il backend verifica la firma direttamente on-chain via isValidSignature
//      (ERC1271 / LSP6 — funziona sia con controller EOA singolo sia con
//      Key Manager, la UP la valida secondo la propria logica di permessi)
//   4. Se valida, emette un JWT di sessione breve (30 minuti) da usare per
//      gli upload successivi — cosi' non serve rifirmare ad ogni singolo file
// =======================================================================

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { ethers } = require("ethers");

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minuti
const SESSION_TTL = "30m";

// -----------------------------------------------------------------------
// Challenge SENZA stato per indirizzo (audit S5). Prima il server teneva
// UNA challenge per indirizzo, sovrascritta da ogni nuova richiesta:
// chiunque poteva chiedere di continuo una challenge per l'indirizzo di un
// altro e far fallire il suo accesso, e le challenge mai usate restavano in
// memoria per sempre.
//
// Ora il server non si segna nulla alla creazione: consegna al client, insieme
// al messaggio, un "biglietto" (challengeToken) firmato con HMAC che lega
// indirizzo, nonce, scadenza e impronta del messaggio. Alla verifica il
// client rimanda messaggio + biglietto: il server controlla l'HMAC (nessuno
// puo' fabbricarne uno senza il segreto), la scadenza, che il messaggio sia
// esattamente quello emesso e che il nonce non sia gia' stato usato. Una
// challenge chiesta da un disturbatore non tocca in alcun modo le altre.
//
// Unico stato: i nonce GIA' USATI (uso singolo), tenuti solo fino alla loro
// scadenza e ripuliti periodicamente. Cresce solo con verifiche riuscite,
// che richiedono una firma valida: un estraneo non puo' gonfiarlo.
// NOTA: resta in memoria di processo — va bene per una singola istanza PM2.
// -----------------------------------------------------------------------
const usedNonces = new Map(); // nonce -> expiresAt

function pruneUsedNonces(now = Date.now()) {
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
}
setInterval(pruneUsedNonces, 60 * 1000).unref();

function randomNonce() {
  return ethers.hexlify(ethers.randomBytes(12)).slice(2); // 24 caratteri esadecimali
}

function hmac(secret, data) {
  return crypto.createHmac("sha256", "challenge:" + secret).update(data).digest("base64url");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("base64url");
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

function createChallenge(address, domain, lang, secret) {
  const nonce = randomNonce();
  const message = buildChallengeMessage({ address, domain, nonce, lang });
  const payload = Buffer.from(JSON.stringify({
    a: address.toLowerCase(),
    n: nonce,
    e: Date.now() + CHALLENGE_TTL_MS,
    h: sha256(message),
  })).toString("base64url");
  const challengeToken = `${payload}.${hmac(secret, payload)}`;
  return { message, nonce, challengeToken };
}

const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const ISVALIDSIGNATURE_ABI = [
  "function isValidSignature(bytes32 dataHash, bytes signature) view returns (bytes4)",
];

// Verifica on-chain via isValidSignature (ERC1271 / LSP6) della UP stessa.
async function isValidUpSignature({ address, hashedMessage, signature, rpcProvider }) {
  const upContract = new ethers.Contract(address, ISVALIDSIGNATURE_ABI, rpcProvider);
  const result = await upContract.isValidSignature(hashedMessage, signature);
  return String(result).toLowerCase() === ERC1271_MAGIC_VALUE;
}

async function verifyChallenge({ address, signature, message, challengeToken, secret, rpcProvider, checkSignature = isValidUpSignature }) {
  if (typeof message !== "string" || typeof challengeToken !== "string") {
    return { ok: false, reason: "missing_challenge" }; // pagina vecchia in cache: va ricaricata
  }
  const [payload, mac] = challengeToken.split(".");
  if (!payload || !mac) return { ok: false, reason: "invalid_challenge" };
  const expected = hmac(secret, payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return { ok: false, reason: "invalid_challenge" };
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_challenge" };
  }
  const now = Date.now();
  if (data.a !== address.toLowerCase()) return { ok: false, reason: "invalid_challenge" };
  if (!(data.e > now)) return { ok: false, reason: "challenge_expired" };
  if (data.h !== sha256(message)) return { ok: false, reason: "invalid_challenge" };
  if (usedNonces.has(data.n)) return { ok: false, reason: "challenge_already_used" };

  try {
    const valid = await checkSignature({ address, hashedMessage: ethers.hashMessage(message), signature, rpcProvider });
    if (!valid) return { ok: false, reason: "invalid_signature" };
  } catch (e) {
    // indirizzo senza codice (EOA nudo, non una vera UP) o RPC irraggiungibile
    return { ok: false, reason: "verification_failed", detail: e.message };
  }

  // uso singolo: una challenge verificata non e' piu' riutilizzabile
  usedNonces.set(data.n, data.e);
  return { ok: true };
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