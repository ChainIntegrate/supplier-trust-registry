// =======================================================================
// ipfs.js — upload/pin verso il nodo IPFS proprio (Kubo), non piu' Pinata.
//
// L'API di scrittura del nodo (porta 5001) NON e' esposta pubblicamente
// via Nginx/dominio — accetta connessioni solo dall'IP di questa stessa
// VPS (Aruba, 31.14.140.170), tramite una regola UFW sul nodo IPFS
// stesso. Nessun segreto nell'URL da proteggere: il controllo e' a
// livello di rete/firewall, non applicativo — diverso dal caso dell'RPC
// (dove il token nell'URL doveva restare nascosto).
//
// Questo modulo, come il precedente, non sa e non deve sapere se i byte
// che riceve sono cifrati o in chiaro — inoltra soltanto.
// =======================================================================

const IPFS_API_URL = "http://161.97.130.81:5001/api/v0/add?pin=true";

async function uploadBufferToIPFS(buffer, filename, mimeType) {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  formData.append("file", blob, filename);

  const res = await fetch(IPFS_API_URL, {
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
