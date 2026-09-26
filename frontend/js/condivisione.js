// =======================================================================
// CONDIVISIONE RISERVATA — pagina di chi riceve il link (audit U13).
// Non serve estensione ne' account: legge tutto tramite il proxy RPC del
// sito e il gateway IPFS, decifra nel browser con la chiave che sta dopo
// il "#" nel link (parte dell'URL che il browser non invia mai al server).
//
// Cosa verifica prima di mostrare qualcosa:
// 1. il file condiviso corrisponde all'impronta registrata al momento
//    della condivisione (EvaluationDisclosed.disclosureHash);
// 2. il testo della valutazione corrisponde all'impronta registrata
//    quando la valutazione e' stata salvata (EvaluationAdded.contentHash):
//    nessuno l'ha modificata dopo, nemmeno il proprietario;
// 3. idem per il nome del fornitore (SupplierAdded.nameHash) e per
//    l'allegato (impronta contenuta nel testo della valutazione).
// =======================================================================
import { ethers } from "/shared/ethers/6.13.4/ethers.min.js";

const CONFIG = {
  CHAIN_ID: 42,
  RPC_URL: window.location.origin + "/api/rpc",
  REGISTRY_CONTRACT: "0xFa143308D85b81Ed57547049F4A7718c3117A064",
  DEPLOY_BLOCK: 8268392,
  IPFS_GATEWAY: "https://ipfs.chainintegrate.it",
  IPFS_FALLBACK_GATEWAY: "https://api.universalprofile.cloud",
};
const MAX_BLOCK_RANGE = 9000;   // sotto il limite di 10.000 del proxy RPC
const SCAN_CONCURRENCY = 4;
const IPFS_TIMEOUT_MS = 8000;
const IPFS_RETRY_DELAYS_MS = [500, 1000, 2000];
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;

const iface = new ethers.Interface([
  "event SupplierAdded(bytes32 indexed tokenId, uint256 indexed supplierId, bytes32 nameHash, string nameUri, bool isNamePublic)",
  "event EvaluationAdded(bytes32 indexed tokenId, uint256 indexed supplierId, uint256 evaluationId, uint256 schemaVersion, bytes32 contentHash, string uri, bool isPublic, uint256 supersedes)",
  "event EvaluationDisclosed(bytes32 indexed tokenId, uint256 indexed supplierId, uint256 indexed evaluationId, uint256 disclosureId, string disclosureUri, bytes32 disclosureHash)",
  "function getSchema(bytes32 tokenId, uint256 version) view returns (string[] paramNames, int256 minValue, int256 maxValue, uint256 createdAt)",
]);

// ---------------------------------------------------------------- i18n
const primaryLang = navigator.language || (navigator.languages && navigator.languages[0]) || "en";
const LANG = primaryLang.toLowerCase().startsWith("it") ? "it" : "en";
const I18N = {
  it: {
    title: "Valutazione condivisa",
    intro: "Il proprietario di un registro fornitori ha condiviso con te questa valutazione in modo riservato. Il contenuto viene decifrato solo in questo browser.",
    loading: "Lettura e verifica in corso…",
    scanning: "Lettura dello storico: {p}%",
    registry: "Registro",
    supplier: "Fornitore",
    supplierHidden: "Nome non incluso nella condivisione (fornitore n. {id})",
    evaluation: "Valutazione n. {id}",
    referredTo: "Riferita al",
    recordedOn: "Registrata il",
    scale: "Scala {min}–{max}",
    note: "Note",
    attachment: "Allegato",
    downloading: "Apertura…",
    verified: "✓ Verificata: il contenuto è identico a quello registrato il {date} e non è stato modificato da allora.",
    nameVerified: "Anche il nome del fornitore corrisponde a quello registrato.",
    superseded: "Attenzione: questa valutazione è stata in seguito corretta dal proprietario (valutazione n. {id}). La versione corretta non fa parte di questa condivisione.",
    notRevocable: "Questo link dà accesso solo a questa valutazione. Non inoltrarlo a chi non deve leggerla.",
    errBadLink: "Link non valido o incompleto. Controlla di averlo copiato per intero, compresa la parte dopo il simbolo #.",
    errNotFound: "Questa condivisione non esiste. Controlla il link ricevuto.",
    errWrongKey: "Impossibile leggere il contenuto: la chiave nel link non è corretta. Controlla di averlo copiato per intero, compresa la parte dopo il simbolo #.",
    errTampered: "Il contenuto non corrisponde a quanto registrato: non viene mostrato perché potrebbe essere stato alterato.",
    errRead: "Impossibile leggere i dati in questo momento. Riprova tra qualche minuto.",
    errAttachment: "Allegato non verificato o non leggibile.",
    nameMismatch: "Il nome del fornitore allegato non corrisponde a quello registrato e non viene mostrato.",
    dateLocale: "it-IT",
  },
  en: {
    title: "Shared evaluation",
    intro: "The owner of a supplier registry has confidentially shared this evaluation with you. The content is decrypted only in this browser.",
    loading: "Reading and verifying…",
    scanning: "Reading history: {p}%",
    registry: "Registry",
    supplier: "Supplier",
    supplierHidden: "Name not included in this share (supplier no. {id})",
    evaluation: "Evaluation no. {id}",
    referredTo: "Refers to",
    recordedOn: "Recorded on",
    scale: "Scale {min}–{max}",
    note: "Notes",
    attachment: "Attachment",
    downloading: "Opening…",
    verified: "✓ Verified: the content is identical to what was recorded on {date} and has not been changed since.",
    nameVerified: "The supplier name also matches the recorded one.",
    superseded: "Note: this evaluation was later corrected by the owner (evaluation no. {id}). The corrected version is not part of this share.",
    notRevocable: "This link gives access to this evaluation only. Do not forward it to anyone who shouldn't read it.",
    errBadLink: "Invalid or incomplete link. Make sure you copied all of it, including the part after the # sign.",
    errNotFound: "This share does not exist. Please check the link you received.",
    errWrongKey: "Unable to read the content: the key in the link is not correct. Make sure you copied all of it, including the part after the # sign.",
    errTampered: "The content does not match what was recorded: it is not shown because it may have been altered.",
    errRead: "Unable to read the data right now. Please try again in a few minutes.",
    errAttachment: "Attachment not verified or not readable.",
    nameMismatch: "The attached supplier name does not match the recorded one and is not shown.",
    dateLocale: "en-GB",
  },
};
const t = (key, vars = {}) => (I18N[LANG][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
document.documentElement.lang = LANG;
document.title = `${t("title")} — Supplier Trust Registry`;

const $ = (id) => document.getElementById(id);
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}
function formatDate(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(t("dateLocale"), { year: "numeric", month: "long", day: "numeric" });
}
function formatTimestamp(ms) {
  return new Date(ms).toLocaleDateString(t("dateLocale"), { year: "numeric", month: "long", day: "numeric" });
}

class UserError extends Error {}

// ---------------------------------------------------------------- link
function parseLink() {
  const q = new URLSearchParams(window.location.search);
  const frag = new URLSearchParams(window.location.hash.slice(1));
  const tokenId = q.get("r") || "";
  const ids = ["s", "e", "d"].map(k => q.get(k) || "");
  const key = frag.get("k") || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(tokenId) || ids.some(v => !/^\d{1,30}$/.test(v)) || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    throw new UserError(t("errBadLink"));
  }
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/") + "=";
  const rawKey = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (rawKey.length !== 32) throw new UserError(t("errBadLink"));
  return { tokenId: tokenId.toLowerCase(), supplierId: BigInt(ids[0]), evaluationId: BigInt(ids[1]), disclosureId: BigInt(ids[2]), rawKey };
}

// ---------------------------------------------------------------- lettura
async function fetchGatewayWithRetry(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(IPFS_TIMEOUT_MS) });
    const throttled = res.status === 429 || res.status === 503;
    if (!throttled || attempt >= IPFS_RETRY_DELAYS_MS.length) return res;
    res.body?.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, IPFS_RETRY_DELAYS_MS[attempt]));
  }
}

// Qui ogni contenuto viene comunque verificato con un'impronta registrata,
// quindi il gateway di riserva non richiede fiducia.
async function fetchFromIPFS(uri) {
  const cid = String(uri ?? "").replace(/^ipfs:\/\//, "");
  if (!CID_RE.test(cid)) throw new UserError(t("errRead"));
  for (const base of [CONFIG.IPFS_GATEWAY, CONFIG.IPFS_FALLBACK_GATEWAY]) {
    try {
      const res = await fetchGatewayWithRetry(`${base}/ipfs/${cid}`);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch { /* prova la fonte successiva */ }
  }
  throw new UserError(t("errRead"));
}

async function scanLogs(provider, topics, onProgress) {
  const latest = await provider.getBlockNumber();
  const windows = [];
  for (let from = CONFIG.DEPLOY_BLOCK; from <= latest; from += MAX_BLOCK_RANGE) {
    windows.push([from, Math.min(from + MAX_BLOCK_RANGE - 1, latest)]);
  }
  const results = new Array(windows.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < windows.length) {
      const i = next++;
      const [fromBlock, toBlock] = windows[i];
      results[i] = await provider.getLogs({ address: CONFIG.REGISTRY_CONTRACT, topics, fromBlock, toBlock });
      onProgress(Math.round((++done / windows.length) * 100));
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, windows.length) }, worker));
  return results.flat().map(log => ({ log, ev: iface.parseLog(log) })).filter(x => x.ev);
}

async function decryptBytes(bytes, cryptoKey) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, cryptoKey, bytes.slice(12));
  return new Uint8Array(plain);
}

const b64ToBytes = (text) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

// ---------------------------------------------------------------- allegati (stessa logica sicura di index.html, audit S1)
const INLINE_ATTACHMENT_TYPES = [
  { type: "application/pdf", match: b => startsWithBytes(b, [0x25, 0x50, 0x44, 0x46, 0x2D]) },
  { type: "image/png", match: b => startsWithBytes(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) },
  { type: "image/jpeg", match: b => startsWithBytes(b, [0xFF, 0xD8, 0xFF]) },
  { type: "image/gif", match: b => startsWithBytes(b, [0x47, 0x49, 0x46, 0x38]) },
  { type: "image/webp", match: b => startsWithBytes(b, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(b.subarray(8), [0x57, 0x45, 0x42, 0x50]) },
];
function startsWithBytes(bytes, prefix) {
  return bytes.length >= prefix.length && prefix.every((v, i) => bytes[i] === v);
}
function safeAttachmentFileName(name) {
  const clean = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return clean || "allegato";
}
function openAttachmentSafely(bytes, declaredName) {
  const inline = INLINE_ATTACHMENT_TYPES.find(k => k.match(bytes));
  const url = URL.createObjectURL(new Blob([bytes], { type: inline ? inline.type : "application/octet-stream" }));
  if (inline) {
    window.open(url, "_blank", "noopener");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = safeAttachmentFileName(declaredName);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------- flusso principale
async function main() {
  $("page-title").textContent = t("title");
  $("page-intro").textContent = t("intro");
  const content = $("content");
  content.innerHTML = `<p class="muted" id="progress">${t("loading")}</p>`;

  const link = parseLink();

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, CONFIG.CHAIN_ID, { batchMaxCount: 1, staticNetwork: true });
  const topics = [
    [iface.getEvent("SupplierAdded").topicHash, iface.getEvent("EvaluationAdded").topicHash, iface.getEvent("EvaluationDisclosed").topicHash],
    ethers.zeroPadValue(link.tokenId, 32),
    ethers.toBeHex(link.supplierId, 32),
  ];
  let events;
  try {
    events = await scanLogs(provider, topics, p => { const el = $("progress"); if (el) el.textContent = t("scanning", { p }); });
  } catch {
    throw new UserError(t("errRead"));
  }

  const disclosure = events.find(x => x.ev.name === "EvaluationDisclosed"
    && x.ev.args.evaluationId === link.evaluationId && x.ev.args.disclosureId === link.disclosureId);
  const evaluation = events.find(x => x.ev.name === "EvaluationAdded" && x.ev.args.evaluationId === link.evaluationId);
  const supplier = events.find(x => x.ev.name === "SupplierAdded");
  if (!disclosure || !evaluation) throw new UserError(t("errNotFound"));
  const correction = events
    .filter(x => x.ev.name === "EvaluationAdded" && x.ev.args.supersedes === link.evaluationId)
    .map(x => x.ev.args.evaluationId)
    .sort((a, b) => (a < b ? 1 : -1))[0];

  // 1. file condiviso: decifrazione con la chiave del link + impronta della condivisione
  const blob = await fetchFromIPFS(disclosure.ev.args.disclosureUri);
  const oneTimeKey = await crypto.subtle.importKey("raw", link.rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  let payloadBytes;
  try {
    const { data } = JSON.parse(new TextDecoder().decode(blob));
    payloadBytes = await decryptBytes(b64ToBytes(data), oneTimeKey);
  } catch {
    throw new UserError(t("errWrongKey"));
  }
  if (ethers.keccak256(payloadBytes) !== disclosure.ev.args.disclosureHash) throw new UserError(t("errTampered"));
  const shared = JSON.parse(new TextDecoder().decode(payloadBytes));
  if (String(shared.tokenId).toLowerCase() !== link.tokenId
      || String(shared.supplierId) !== String(link.supplierId)
      || String(shared.evaluationId) !== String(link.evaluationId)
      || typeof shared.evaluation !== "string") {
    throw new UserError(t("errTampered"));
  }

  // 2. testo della valutazione == quello registrato in origine
  if (ethers.keccak256(ethers.toUtf8Bytes(shared.evaluation)) !== evaluation.ev.args.contentHash) {
    throw new UserError(t("errTampered"));
  }
  const payload = JSON.parse(shared.evaluation);

  // 3. nome del fornitore (facoltativo)
  let supplierName = null, nameWarning = false;
  if (typeof shared.supplierName === "string" && supplier) {
    if (ethers.keccak256(ethers.toUtf8Bytes(shared.supplierName)) === supplier.ev.args.nameHash) {
      try { supplierName = JSON.parse(shared.supplierName).name; } catch { nameWarning = true; }
    } else {
      nameWarning = true;
    }
  }

  // scala e data di registrazione
  let scale = null;
  try {
    const [, minValue, maxValue] = await new ethers.Contract(CONFIG.REGISTRY_CONTRACT, iface, provider)
      .getSchema(link.tokenId, evaluation.ev.args.schemaVersion);
    scale = { min: minValue, max: maxValue };
  } catch { /* la scala e' un'informazione accessoria */ }
  let recordedMs = null;
  try {
    const block = await provider.getBlock(evaluation.log.blockNumber);
    recordedMs = block.timestamp * 1000;
  } catch { /* idem */ }

  const criteriHtml = Object.entries(payload.criteri || {})
    .map(([k, v]) => `<div class="row-between" style="font-size:14px;"><span class="muted" style="font-size:14px;">${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`)
    .join("");

  content.innerHTML = `
    ${recordedMs ? `<div class="verified">${escapeHtml(t("verified", { date: formatTimestamp(recordedMs) }))}${supplierName ? " " + escapeHtml(t("nameVerified")) : ""}</div>` : ""}
    ${correction ? `<div class="warning-box">${escapeHtml(t("superseded", { id: correction }))}</div>` : ""}
    <div class="card">
      ${shared.registryLabel ? `<div class="muted">${t("registry")}: <strong>${escapeHtml(shared.registryLabel)}</strong></div>` : ""}
      <div style="font-size:18px; font-weight:700; margin:4px 0;">${supplierName ? escapeHtml(supplierName) : escapeHtml(t("supplierHidden", { id: link.supplierId }))}</div>
      ${nameWarning ? `<div class="warning-box">${escapeHtml(t("nameMismatch"))}</div>` : ""}
      <div class="muted" style="font-weight:600;">${escapeHtml(t("evaluation", { id: link.evaluationId }))}</div>
      ${payload.data ? `<div class="muted">${t("referredTo")} ${escapeHtml(formatDate(payload.data))}</div>` : ""}
      ${recordedMs ? `<div class="muted">${t("recordedOn")} ${escapeHtml(formatTimestamp(recordedMs))}</div>` : ""}
      <div style="margin-top:10px;">${criteriHtml}</div>
      ${scale ? `<div class="muted" style="margin-top:4px;">${escapeHtml(t("scale", { min: scale.min, max: scale.max }))}</div>` : ""}
      ${payload.note ? `<div style="margin-top:10px;"><div class="muted">${t("note")}</div><div style="white-space:pre-wrap;">${escapeHtml(payload.note)}</div></div>` : ""}
      ${shared.attachment && payload.document ? `<div style="margin-top:12px;"><button class="btn" id="btn-attachment">📎 ${escapeHtml(payload.document.name)}</button> <span class="muted" id="attachment-status"></span></div>` : ""}
    </div>
    <p class="muted">${escapeHtml(t("notRevocable"))}</p>
  `;

  // 4. allegato: ricifrato con la chiave del link, verificato con l'impronta
  //    contenuta nel testo (gia' verificato) della valutazione
  if (shared.attachment && payload.document) {
    $("btn-attachment").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = t("downloading");
      $("attachment-status").textContent = "";
      try {
        const bytes = await decryptBytes(await fetchFromIPFS(shared.attachment.uri), oneTimeKey);
        if (ethers.keccak256(bytes) !== String(payload.document.hash).toLowerCase()) throw new Error("hash");
        openAttachmentSafely(bytes, payload.document.name);
      } catch {
        $("attachment-status").textContent = t("errAttachment");
      }
      btn.textContent = original;
      btn.disabled = false;
    });
  }
}

main().catch((e) => {
  console.error(e);
  $("page-title").textContent = t("title");
  $("content").innerHTML = `<div class="error-box">${escapeHtml(e instanceof UserError ? e.message : t("errRead"))}</div>`;
});
