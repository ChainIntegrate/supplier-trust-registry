// =======================================================================
// pinata.js — inoltro verso Pinata Files API v3 (endpoint corrente,
// sostituisce il vecchio /pinning/pinFileToIPFS che Pinata mantiene solo
// come legacy). Questo modulo non sa e non deve sapere se i byte che
// riceve sono cifrati o in chiaro — inoltra soltanto.
//
// network: "public" significa "recuperabile pubblicamente via IPFS/gateway",
// NON "contenuto leggibile". Un blob cifrato caricato con network=public
// resta comunque cifrato: chiunque puo' scaricare i byte, nessuno puo'
// leggerli senza la chiave — esattamente il comportamento voluto.
// =======================================================================

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

async function uploadBufferToPinata(buffer, filename, mimeType, pinataJwt) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  const file = new File([blob], filename, { type: mimeType || "application/octet-stream" });

  formData.append("file", file);
  formData.append("network", "public");

  const res = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinata upload fallito (HTTP ${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.data.cid; // usato dal frontend come ipfs://<cid>
}

module.exports = { uploadBufferToPinata };
