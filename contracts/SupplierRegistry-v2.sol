// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

// ---------------------------------------------------------------------
// SupplierRegistry — ChainIntegrate — V2
//
// V2 rispetto al contratto gia' live su testnet (vedi SupplierRegistry-v1.sol):
// supporta PIU' Registri per stesso indirizzo, gated per numero da tier
// Membership (es. Bronze 1, Silver 2, Gold 5) — pensato per chi ha
// esigenze di valutazione diverse (es. fornitori di servizi vs fornitori
// di materiali), ognuna col proprio schema di criteri.
//
// Architettura concordata:
// - LSP8 (soulbound), PIU' registri per utente = tokenId non piu'
//   derivato dal solo indirizzo, ma da keccak256(indirizzo, indice
//   progressivo) — cambio non retrocompatibile col V1, richiede nuovo
//   deploy e nuovo indirizzo di contratto
// - Fornitori e Valutazioni NON sono NFT separati: vivono come eventi +
//   contatori minimi in storage (stesso pattern eth_getLogs gia' in uso
//   per MatchPredictor: la UI ricostruisce le liste dai log, gas basso)
// - Cifratura/privacy del contenuto (contentHash + uri) e' interamente
//   client-side: il contratto non sa e non deve sapere se "uri" punta a
//   un blob cifrato o a un JSON in chiaro. Sa solo l'hash per la prova
//   di integrita' e il flag isPublic per la UI.
// - Owner del contratto (ERC725Y onlyOwner) = ChainIntegrate, ma SOLO
//   per configurazione di collezione/tier: MAI per i dati degli utenti.
// - Owner del singolo Registro (holder del token) = unico soggetto che
//   puo' scrivere fornitori/valutazioni/schema del proprio registro
//   (modifier custom, non onlyOwner ERC725Y — cosi' non si ripete il
//   problema gia' avuto con Supplier Quality Manager, dove solo la UP
//   ChainIntegrate poteva scrivere metadata).
// - Membership: PIU' contratti accettati contemporaneamente (non uno
//   sostituibile), limiti per tier configurabili senza redeploy, per
//   reggere un futuro tier/contratto Diamond senza toccare questo file.
// ---------------------------------------------------------------------

import {
    LSP8IdentifiableDigitalAsset
} from "@lukso/lsp8-contracts/contracts/LSP8IdentifiableDigitalAsset.sol";

import {
    _LSP8_TOKENID_FORMAT_UNIQUE_ID
} from "@lukso/lsp8-contracts/contracts/LSP8Constants.sol";

import {
    _LSP4_TOKEN_TYPE_NFT
} from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";

/// @dev Interfaccia minima che qualunque contratto Membership (Bronze/
///      Silver/Gold di oggi, un ipotetico Diamond domani, o qualunque
///      altro futuro contratto) deve esporre per essere riconosciuto qui.
///      Non importa cosa succede dentro: il Registro guarda solo questo.
interface IMembershipTier {
    function tierOf(address account) external view returns (uint8);
}

contract SupplierRegistryV2 is LSP8IdentifiableDigitalAsset {
    // -----------------------------------------------------------------
    // Errori
    // -----------------------------------------------------------------
    error RegistryLimitReached(address account, uint256 limit);
    error RegistryDoesNotExist(bytes32 tokenId);
    error NotRegistryOwner(bytes32 tokenId, address caller);
    error SupplierLimitReached(bytes32 tokenId, uint256 limit);
    error ParamLimitReached(bytes32 tokenId, uint256 limit);
    error SchemaVersionDoesNotExist(bytes32 tokenId, uint256 version);
    error SupplierDoesNotExist(bytes32 tokenId, uint256 supplierId);
    error RegistryNotTransferable();
    error SelectiveDisclosureNotAllowed(address account);
    error EvaluationDoesNotExist(bytes32 tokenId, uint256 supplierId, uint256 evaluationId);
    error NoPendingSuccessionProposal(bytes32 oldTokenId);
    error SuccessorAlreadySet(bytes32 newTokenId);

    // -----------------------------------------------------------------
    // Membership — piu' contratti accettati, limiti per (contratto, tier)
    // -----------------------------------------------------------------

    struct TierLimits {
        uint256 maxSuppliers;
        uint256 maxParams;
        bool canDiscloseSelectively; // feature Gold: disclosure selettiva di una valutazione
        uint256 maxRegistries; // quanti Registri puo' mintare lo stesso indirizzo su questo tier
        bool configured; // distingue "limite 0 esplicito" da "non configurato"
    }

    address[] private _membershipContracts;
    mapping(address => bool) public isAcceptedMembershipContract;

    // membershipContract => tier => limiti
    mapping(address => mapping(uint8 => TierLimits)) public tierLimits;

    event MembershipContractAdded(address indexed membershipContract);
    event MembershipContractRemoved(address indexed membershipContract);
    event TierLimitsSet(
        address indexed membershipContract,
        uint8 indexed tier,
        uint256 maxSuppliers,
        uint256 maxParams,
        bool canDiscloseSelectively,
        uint256 maxRegistries
    );

    function addMembershipContract(address membershipContract) external onlyOwner {
        require(membershipContract != address(0), "zero address");
        if (!isAcceptedMembershipContract[membershipContract]) {
            isAcceptedMembershipContract[membershipContract] = true;
            _membershipContracts.push(membershipContract);
            emit MembershipContractAdded(membershipContract);
        }
    }

    function removeMembershipContract(address membershipContract) external onlyOwner {
        if (isAcceptedMembershipContract[membershipContract]) {
            isAcceptedMembershipContract[membershipContract] = false;
            uint256 len = _membershipContracts.length;
            for (uint256 i = 0; i < len; i++) {
                if (_membershipContracts[i] == membershipContract) {
                    _membershipContracts[i] = _membershipContracts[len - 1];
                    _membershipContracts.pop();
                    break;
                }
            }
            emit MembershipContractRemoved(membershipContract);
        }
    }

    function setTierLimits(
        address membershipContract,
        uint8 tier,
        uint256 maxSuppliers,
        uint256 maxParams,
        bool canDiscloseSelectively,
        uint256 maxRegistries
    ) external onlyOwner {
        tierLimits[membershipContract][tier] = TierLimits({
            maxSuppliers: maxSuppliers,
            maxParams: maxParams,
            canDiscloseSelectively: canDiscloseSelectively,
            maxRegistries: maxRegistries,
            configured: true
        });
        emit TierLimitsSet(membershipContract, tier, maxSuppliers, maxParams, canDiscloseSelectively, maxRegistries);
    }

    /// @notice Limiti effettivi per un utente: il MASSIMO tra tutti i
    ///         contratti Membership accettati su cui l'utente ha un tier
    ///         riconosciuto. Chi possiede sia il vecchio Membership Gold
    ///         sia un domani Diamond ottiene automaticamente il migliore,
    ///         senza dover scegliere o migrare nulla. La disclosure
    ///         selettiva e' sbloccata se ALMENO UNO dei tier riconosciuti
    ///         la concede.
    function getEffectiveLimits(address account)
        public
        view
        returns (uint256 maxSuppliers, uint256 maxParams, bool canDiscloseSelectively, uint256 maxRegistries)
    {
        uint256 len = _membershipContracts.length;
        for (uint256 i = 0; i < len; i++) {
            address membershipContract = _membershipContracts[i];
            // try/catch: un contratto Membership rimosso male o rotto
            // non deve mai bloccare la lettura degli altri
            try IMembershipTier(membershipContract).tierOf(account) returns (uint8 tier) {
                TierLimits memory limits = tierLimits[membershipContract][tier];
                if (limits.configured) {
                    if (limits.maxSuppliers > maxSuppliers) {
                        maxSuppliers = limits.maxSuppliers;
                    }
                    if (limits.maxParams > maxParams) {
                        maxParams = limits.maxParams;
                    }
                    if (limits.canDiscloseSelectively) {
                        canDiscloseSelectively = true;
                    }
                    if (limits.maxRegistries > maxRegistries) {
                        maxRegistries = limits.maxRegistries;
                    }
                }
            } catch {
                continue;
            }
        }
    }

    // -----------------------------------------------------------------
    // Registro — LSP8 soulbound, PIU' di uno per utente (V2). tokenId =
    // keccak256(owner, indice progressivo) invece che derivato dal solo
    // indirizzo — cambio non retrocompatibile col V1, richiede nuovo
    // deploy (vedi SupplierRegistry-v1.sol per il contratto gia' live
    // su testnet).
    // -----------------------------------------------------------------

    event RegistryMinted(bytes32 indexed tokenId, address indexed owner, uint256 index, string label);

    // Quanti Registri ha gia' mintato un indirizzo — usato sia per il
    // gating per tier sia per calcolare il prossimo tokenId.
    mapping(address => uint256) public registryCountOf;

    modifier onlyRegistryOwner(bytes32 tokenId) {
        if (!_exists(tokenId)) revert RegistryDoesNotExist(tokenId);
        if (tokenOwnerOf(tokenId) != msg.sender) {
            revert NotRegistryOwner(tokenId, msg.sender);
        }
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address chainIntegrateOwner_
    )
        LSP8IdentifiableDigitalAsset(
            name_,
            symbol_,
            chainIntegrateOwner_,
            _LSP4_TOKEN_TYPE_NFT,
            _LSP8_TOKENID_FORMAT_UNIQUE_ID
        )
    {}

    /// @notice Chiunque puo' mintare un nuovo Registro, a patto di non aver
    ///         gia' raggiunto il numero massimo consentito dal proprio tier
    ///         (Bronze/Silver/Gold — vedi setTierLimits). "label" e' solo
    ///         descrittivo (es. "Fornitori di materiali"), serve alla UI
    ///         per distinguere i registri di uno stesso proprietario, non
    ///         ha alcun effetto sulla logica del contratto.
    function mintRegistry(string calldata label) external {
        (, , , uint256 maxRegistries) = getEffectiveLimits(msg.sender);
        uint256 currentCount = registryCountOf[msg.sender];
        if (currentCount >= maxRegistries) {
            revert RegistryLimitReached(msg.sender, maxRegistries);
        }

        uint256 index = currentCount;
        bytes32 tokenId = keccak256(abi.encodePacked(msg.sender, index));
        registryCountOf[msg.sender] = currentCount + 1;

        _mint(msg.sender, tokenId, true, "");
        emit RegistryMinted(tokenId, msg.sender, index, label);
    }

    /// @dev Soulbound: nessun transfer, solo mint (from == 0) e burn (to == 0).
    /// TODO(decisione): valutare in futuro un meccanismo di "re-key"
    /// amministrativo per successione aziendale, senza rendere il token
    /// trasferibile nel senso standard (vedi discussione privacy/chiave).
    function _beforeTokenTransfer(
        address from,
        address to,
        bytes32 /* tokenId */,
        bool /* force */,
        bytes memory /* data */
    ) internal virtual override {
        if (from != address(0) && to != address(0)) {
            revert RegistryNotTransferable();
        }
    }

    // -----------------------------------------------------------------
    // Schema di valutazione — per registro, versionato, append-only
    // -----------------------------------------------------------------

    struct Schema {
        string[] paramNames;
        int256 minValue;
        int256 maxValue;
        uint256 createdAt;
    }

    mapping(bytes32 => Schema[]) private _schemas;

    event SchemaDefined(
        bytes32 indexed tokenId,
        uint256 indexed version,
        string[] paramNames,
        int256 minValue,
        int256 maxValue
    );

    function defineSchema(
        bytes32 tokenId,
        string[] calldata paramNames,
        int256 minValue,
        int256 maxValue
    ) external onlyRegistryOwner(tokenId) returns (uint256 version) {
        (, uint256 maxParams, , ) = getEffectiveLimits(msg.sender);
        if (paramNames.length > maxParams) {
            revert ParamLimitReached(tokenId, maxParams);
        }
        require(minValue < maxValue, "invalid range");

        _schemas[tokenId].push(
            Schema({
                paramNames: paramNames,
                minValue: minValue,
                maxValue: maxValue,
                createdAt: block.timestamp
            })
        );
        version = _schemas[tokenId].length - 1;
        emit SchemaDefined(tokenId, version, paramNames, minValue, maxValue);
    }

    function schemaVersionsCount(bytes32 tokenId) external view returns (uint256) {
        return _schemas[tokenId].length;
    }

    function getSchema(bytes32 tokenId, uint256 version)
        external
        view
        returns (string[] memory paramNames, int256 minValue, int256 maxValue, uint256 createdAt)
    {
        if (version >= _schemas[tokenId].length) {
            revert SchemaVersionDoesNotExist(tokenId, version);
        }
        Schema storage s = _schemas[tokenId][version];
        return (s.paramNames, s.minValue, s.maxValue, s.createdAt);
    }

    // -----------------------------------------------------------------
    // Fornitori — entry interna (niente NFT per fornitore), solo eventi
    // + contatore per il gating tier
    // -----------------------------------------------------------------

    mapping(bytes32 => uint256) public supplierCount; // tokenId => numero fornitori

    event SupplierAdded(
        bytes32 indexed tokenId,
        uint256 indexed supplierId,
        bytes32 nameHash,     // prova di integrita' del nome (reale o pseudonimo)
        string nameUri,       // IPFS: dietro puo' esserci un blob cifrato o JSON in chiaro
        bool isNamePublic     // indica alla UI cosa aspettarsi dietro nameUri, nient'altro
    );

    function addSupplier(
        bytes32 tokenId,
        bytes32 nameHash,
        string calldata nameUri,
        bool isNamePublic
    ) external onlyRegistryOwner(tokenId) returns (uint256 supplierId) {
        (uint256 maxSuppliers, , , ) = getEffectiveLimits(msg.sender);
        if (supplierCount[tokenId] >= maxSuppliers) {
            revert SupplierLimitReached(tokenId, maxSuppliers);
        }

        supplierId = supplierCount[tokenId];
        supplierCount[tokenId] = supplierId + 1;
        emit SupplierAdded(tokenId, supplierId, nameHash, nameUri, isNamePublic);
    }

    // -----------------------------------------------------------------
    // Valutazioni — append-only, con possibilita' di "supersedere" una
    // valutazione precedente (correzione errori, storico sempre intatto,
    // utile anche in ottica audit ISO 9001: si vede che l'errore e' stato
    // corretto, non che e' sparito)
    // -----------------------------------------------------------------

    // tokenId => supplierId => numero di valutazioni
    mapping(bytes32 => mapping(uint256 => uint256)) public evaluationCount;

    event EvaluationAdded(
        bytes32 indexed tokenId,
        uint256 indexed supplierId,
        uint256 evaluationId,
        uint256 schemaVersion,
        bytes32 contentHash,   // hash del contenuto (parametri+punteggi+note), sempre presente
        string uri,            // IPFS: dietro puo' esserci un blob cifrato o JSON in chiaro
        bool isPublic,          // indica alla UI cosa aspettarsi dietro uri, nient'altro
        uint256 supersedes      // 0 = nessuna correzione, altrimenti id della valutazione corretta
    );

    function addEvaluation(
        bytes32 tokenId,
        uint256 supplierId,
        uint256 schemaVersion,
        bytes32 contentHash,
        string calldata uri,
        bool isPublic,
        uint256 supersedes
    ) external onlyRegistryOwner(tokenId) returns (uint256 evaluationId) {
        if (supplierId >= supplierCount[tokenId]) {
            revert SupplierDoesNotExist(tokenId, supplierId);
        }
        if (schemaVersion >= _schemas[tokenId].length) {
            revert SchemaVersionDoesNotExist(tokenId, schemaVersion);
        }
        if (supersedes > 0) {
            require(
                supersedes <= evaluationCount[tokenId][supplierId],
                "supersedes: valutazione inesistente"
            );
        }

        evaluationId = evaluationCount[tokenId][supplierId] + 1; // 1-based: 0 = "nessuna"
        evaluationCount[tokenId][supplierId] = evaluationId;

        emit EvaluationAdded(
            tokenId,
            supplierId,
            evaluationId,
            schemaVersion,
            contentHash,
            uri,
            isPublic,
            supersedes
        );
    }

    // -----------------------------------------------------------------
    // Disclosure selettiva (feature Gold) — il contratto NON gestisce la
    // crittografia (resta client-side: si decifra localmente, si
    // ri-cifra con una chiave usa-e-getta, si carica il blob su IPFS, si
    // condivide un link con la chiave nel frammento URL, mai in una
    // request HTTP). Qui si registra solo la PROVA che la disclosure e'
    // avvenuta, con hash di integrita' per il destinatario.
    //
    // Non e' revoca in senso DRM: chi ha gia' scaricato il contenuto
    // disclosed lo tiene per sempre. "Revocare" significa smettere di
    // condividere il link e non emetterne di nuovi, non invalidare quello
    // vecchio.
    // -----------------------------------------------------------------

    // tokenId => supplierId => evaluationId => numero di disclosure emesse
    mapping(bytes32 => mapping(uint256 => mapping(uint256 => uint256))) public disclosureCount;

    event EvaluationDisclosed(
        bytes32 indexed tokenId,
        uint256 indexed supplierId,
        uint256 indexed evaluationId,
        uint256 disclosureId,
        string disclosureUri,   // blob ri-cifrato con chiave usa-e-getta, la chiave NON e' qui
        bytes32 disclosureHash  // hash del contenuto in chiaro, per verifica lato destinatario
    );

    function discloseEvaluation(
        bytes32 tokenId,
        uint256 supplierId,
        uint256 evaluationId,
        string calldata disclosureUri,
        bytes32 disclosureHash
    ) external onlyRegistryOwner(tokenId) returns (uint256 disclosureId) {
        (, , bool canDiscloseSelectively, ) = getEffectiveLimits(msg.sender);
        if (!canDiscloseSelectively) revert SelectiveDisclosureNotAllowed(msg.sender);
        if (evaluationId == 0 || evaluationId > evaluationCount[tokenId][supplierId]) {
            revert EvaluationDoesNotExist(tokenId, supplierId, evaluationId);
        }

        disclosureId = disclosureCount[tokenId][supplierId][evaluationId] + 1;
        disclosureCount[tokenId][supplierId][evaluationId] = disclosureId;

        emit EvaluationDisclosed(
            tokenId,
            supplierId,
            evaluationId,
            disclosureId,
            disclosureUri,
            disclosureHash
        );
    }

    // -----------------------------------------------------------------
    // Successione aziendale — il Registro resta soulbound: "successione"
    // non e' un transfer, e' un NUOVO Registro sotto il nuovo titolare.
    // Qui si collegano pubblicamente i due, a scopo di continuita' dello
    // storico/reputazione, con conferma RECIPROCA (il vecchio propone, il
    // nuovo accetta) per evitare che un registro clami falsamente di
    // essere successore di uno con buona reputazione altrui.
    //
    // Questo NON risolve l'accesso ai dati privati storici: se il nuovo
    // titolare non conosce il PIN del vecchio, la ri-cifratura resta una
    // migrazione manuale fuori protocollo. I dati gia' pubblici restano
    // invece leggibili by design, nessuna migrazione necessaria.
    // -----------------------------------------------------------------

    mapping(bytes32 => bytes32) public predecessorOf;      // newTokenId => oldTokenId (confermato)
    mapping(bytes32 => bytes32) private _pendingSuccessor;  // oldTokenId => newTokenId proposto

    event SuccessionProposed(bytes32 indexed oldTokenId, bytes32 indexed newTokenId);
    event SuccessionConfirmed(bytes32 indexed oldTokenId, bytes32 indexed newTokenId);

    function proposeSuccessor(bytes32 oldTokenId, bytes32 newTokenId)
        external
        onlyRegistryOwner(oldTokenId)
    {
        if (!_exists(newTokenId)) revert RegistryDoesNotExist(newTokenId);
        _pendingSuccessor[oldTokenId] = newTokenId;
        emit SuccessionProposed(oldTokenId, newTokenId);
    }

    function confirmSuccessor(bytes32 newTokenId, bytes32 oldTokenId)
        external
        onlyRegistryOwner(newTokenId)
    {
        if (_pendingSuccessor[oldTokenId] != newTokenId) {
            revert NoPendingSuccessionProposal(oldTokenId);
        }
        if (predecessorOf[newTokenId] != bytes32(0)) {
            revert SuccessorAlreadySet(newTokenId);
        }
        predecessorOf[newTokenId] = oldTokenId;
        delete _pendingSuccessor[oldTokenId];
        emit SuccessionConfirmed(oldTokenId, newTokenId);
    }

    // -----------------------------------------------------------------
    // Nota non bloccante: la metadata di collezione (icona/nome per UP
    // Store) resta gestita da ChainIntegrate via setData() ereditato da
    // ERC725Y, invariata rispetto agli altri progetti — non riguarda i
    // dati utente trattati qui.
    // -----------------------------------------------------------------
}
