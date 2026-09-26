// =======================================================================
// ipfs.js — upload/pin verso il nodo IPFS proprio (Kubo), non piu' Pinata.
//
// L'API di scrittura del nodo (porta 5001) NON e' esposta pubblicamente
// via Nginx/dominio — accetta connessioni solo dall'IP del VPS del
// backend, tramite una regola firewall sul nodo IPFS stesso. Nessun
// segreto nell'URL da proteggere: il controllo e' a livello di rete, non
// applicativo. L'indirizzo arriva da IPFS_API_URL (.env), come in
// traceability-registry: nessun indirizzo di infrastruttura nel codice.
//
// Questo modulo, come il precedente, non sa e non deve sapere se i byte
// che riceve sono cifrati o in chiaro — inoltra soltanto.
// =======================================================================

function ipfsAddUrl() {
  const base = (process.env.IPFS_API_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("IPFS_API_URL non configurato (vedi .env.example)");
  return `${base}/api/v0/add?pin=true`;
}

async function uploadBufferToIPFS(buffer, filename, mimeType) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  formData.append("file", blob, filename);

  const res = await fetch(ipfsAddUrl(), {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload al nodo IPFS fallito (HTTP ${res.status}): ${text}`);
  }

  const text = await res.text();
  const data = JSON.parse(text.trim());
  return data.Hash; // CID — stesso formato gia' usato dal frontend come ipfs://<cid>
}

module.exports = { uploadBufferToIPFS };
