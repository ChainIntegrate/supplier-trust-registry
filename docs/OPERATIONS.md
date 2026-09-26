# Operatività — Supplier Trust Registry

Guida operativa per chi gestisce l'installazione in produzione: VPS del
sito, nodo IPFS, manutenzione periodica. Panoramica dell'architettura nel
[README](../README.md#architettura).

## VPS del sito

| Componente | Dettaglio |
|---|---|
| Frontend | file statici in `/var/www/supplier-trust-registry/frontend` |
| Backend | Express, PM2 `supplier-trust-registry-backend`, porta 3011, solo `127.0.0.1` |
| Librerie e font | repo [`shared-assets`](https://github.com/ChainIntegrate/shared-assets) in `/var/www/shared-assets`, servito sotto `/shared/` |
| Dominio | `supplier-trust-registry.chainintegrate.it`, certificato Let's Encrypt (Certbot) |

### Nginx (blocco `server` HTTPS del sito)

```nginx
root /var/www/supplier-trust-registry/frontend;
index index.html;

location /api/ {
    client_max_body_size 11M;          # il backend accetta file fino a 10 MB
    proxy_pass http://127.0.0.1:3011;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

# Librerie e font condivisi (repo ChainIntegrate/shared-assets)
include /var/www/shared-assets/nginx/shared-assets.conf;

location / {
    try_files $uri $uri/ /index.html;
}
```

Dopo ogni modifica: `sudo nginx -t && sudo systemctl reload nginx` (il solo
`nginx -t` verifica la sintassi ma non applica nulla).

Verifica di `/shared/`:
```bash
curl -I https://supplier-trust-registry.chainintegrate.it/shared/ethers/6.13.4/ethers.min.js
# atteso: 200, Content-Type: application/javascript, Cache-Control: ... immutable
```

### Backend (`backend/.env`)

| Variabile | Uso |
|---|---|
| `PORT` | 3011 |
| `FRONTEND_URL` | dominio del sito (CORS e dominio delle challenge di accesso) |
| `LUKSO_RPC_URL` | nodo RPC LUKSO mainnet con token: resta solo nel backend |
| `REGISTRY_CONTRACT_ADDRESS` | contratto V3 mainnet |
| `IPFS_API_URL` | API di scrittura del nodo IPFS, es. `http://<ip-nodo>:5001` |
| `JWT_SECRET` | 64 byte hex: firma sessioni e challenge |
| `MAX_UPLOAD_BYTES` / `FREE_UPLOAD_BYTES` | 10 MB / 300 KB (oltre la soglia serve Gold o Silver+) |
| `RPC_EXTRA_ALLOWED_ADDRESSES` | facoltativo, vuoto: contratti extra leggibili dal proxy `/api/rpc` |

Se manca una variabile obbligatoria il backend si ferma all'avvio con un
messaggio esplicito nei log PM2.

### Aggiornamento

```bash
cd /var/www/supplier-trust-registry && git pull
pm2 restart supplier-trust-registry-backend   # solo se cambia backend/
```
Poi ricaricare le pagine con Ctrl+Shift+R.

## Nodo IPFS

| Funzione | Accesso |
|---|---|
| Lettura | gateway pubblico `https://ipfs.chainintegrate.it`, serve **solo** i file pinnati dal nodo |
| Scrittura | API Kubo porta 5001, raggiungibile solo dall'IP del VPS (firewall) |

Il frontend legge dal gateway del nodo; solo per i file che il nodo non ha
ripiega sul gateway LUKSO `https://api.universalprofile.cloud`, accettando i
contenuti pubblici solo se corrispondono all'hash on-chain.

### Limite di richieste del gateway (Nginx del nodo)

In `/etc/nginx/nginx.conf`:
```nginx
limit_req_zone $binary_remote_addr zone=ipfs_gateway:10m rate=10r/s;
```
In `/etc/nginx/sites-available/ipfs-gateway`:
```nginx
limit_req zone=ipfs_gateway burst=100 nodelay;
limit_req_status 429;
```
Il limite medio (10 r/s) frena i bot; la riserva (100) permette a una
pagina di caricare decine di file di colpo. Frontend e pannello admin, su
429/503, aspettano e riprovano prima di ripiegare su LUKSO.

### Ripinnare file sul nodo

1. Pannello admin → "Files to re-pin on the IPFS node" → **Scan** (per gli
   allegati di valutazioni private: codice segreto del registro → **Include**).
2. **Copy commands** e incollarli sul nodo in `~/repin.sh`.
3. Sul nodo (utente `ubuntu`, demone IPFS eseguito come `ipfs`), dentro tmux:
   ```bash
   tmux new -s repin            # oppure: tmux attach -t repin
   sudo -u ipfs -H ipfs id | head -3          # verifica accesso al repo
   sudo -u ipfs -H bash < ~/repin.sh
   ```
4. Verifica e pulizia:
   ```bash
   grep -o 'baf[a-z0-9]*' ~/repin.sh | sort -u | while read c; do
     sudo -u ipfs -H ipfs pin ls --type=recursive "$c" >/dev/null 2>&1 && echo "OK $c" || echo "MANCA $c"
   done
   rm ~/repin.sh
   ```
5. Nuovo **Scan** nel pannello: atteso "0 to re-pin". Per ogni file ancora
   segnalato, "Details" mostra la risposta del nodo (HTTP, timeout, rete).

## Controllo mensile (circa 10 minuti)

**Librerie del backend** (VPS del sito, e allo stesso modo per
traceability-registry):
```bash
cd /var/www/supplier-trust-registry/backend && npm audit --omit=dev
```
"high" o "critical" → valutare e aggiornare con una PR testata. Mai
`npm audit fix --force` direttamente in produzione.

**Richieste respinte** (VPS del sito):
```bash
sudo grep -E '" (401|403|413|429) ' /var/log/nginx/access.log | awk '{print $1, $7, $9}' | sort | uniq -c | sort -rn | head -20
```
Qualche 401/403 sparso è normale; centinaia dallo stesso IP su
`/api/ipfs/upload` o `/api/rpc` indicano tentativi di uso dall'esterno.

**Limite del gateway** (nodo IPFS):
```bash
sudo grep -c '" 429 ' /var/log/nginx/access.log
```

**Servizi e spazio**:
```bash
pm2 status                                               # colonna ↺ stabile
pm2 logs supplier-trust-registry-backend --lines 50 --nostream   # cercare "fallito"/"failed"
df -h /                                                  # sul nodo IPFS: >20% libero
sudo certbot renew --dry-run                             # rinnovo certificati
```
