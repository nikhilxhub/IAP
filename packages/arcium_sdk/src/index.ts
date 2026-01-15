// packages/sdk/src/arcium-client.ts
import * as anchor from "@coral-xyz/anchor";
import { 
    x25519, 
    getMXEPublicKey, 
    RescueCipher, 
    getArciumEnv 
} from "@arcium-hq/client";

export type Tier = "BRONZE_TIER" | "SILVER_TIER" | "GOLD_TIER" | "PLATINUM_TIER";

/**
 * Maps tier string to numeric value for encryption
 * BRONZE = 0, SILVER = 1, GOLD = 2, PLATINUM = 3
 * (Matches Arcium v0.5 standard for BigInt storage)
 */
export function tierToNumber(tier: Tier): number {
    const tierMap: Record<Tier, number> = {
        "BRONZE_TIER": 0,
        "SILVER_TIER": 1,
        "GOLD_TIER": 2,
        "PLATINUM_TIER": 3
    };
    return tierMap[tier];
}

export class ArciumHander {
    private cipher: RescueCipher | null = null;
    private clientPubKey: Uint8Array | null = null;

    constructor(
        private provider: anchor.AnchorProvider,
        private mxeProgramId: anchor.web3.PublicKey
    ) {}

    /**
     * Initializes the "Secret Handshake" with Arcium
     */
    async initializeEncryption() {
        // 1. Generate a one-time private key for this session
        const clientPrivateKey = x25519.utils.randomSecretKey();
        this.clientPubKey = x25519.getPublicKey(clientPrivateKey);

        // 2. Get the "Public Key" of the Arcium Vault (MXE)
        const mxePublicKey = await getMXEPublicKey(this.provider, this.mxeProgramId);
        if (!mxePublicKey) throw new Error("Could not fetch MXE Public Key");

        // 3. Create a Shared Secret (Nobody else can guess this)
        const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);

        // 4. Initialize the Cipher (The machine that scrambles your data)
        this.cipher = new RescueCipher(sharedSecret);
        
        console.log("Arcium Handshake Complete. Vault is ready.");
    }

    /**
     * Scrambles the Tier and prepares it for the vault
     * @param tierValue - Either a numeric tier (0-3) or a Tier string
     */
    encryptTier(tierValue: number | Tier) {
        if (!this.cipher) throw new Error("Encryption not initialized");
        
        // Convert tier string to number if needed
        const numericTier = typeof tierValue === "string" ? tierToNumber(tierValue) : tierValue;
        
        // Nonce is a random 'salt' to make encryption unique every time
        // Arcium v0.5 expects Uint8Array (not Buffer)
        const nonce = crypto.getRandomValues(new Uint8Array(16));
        
        // We encrypt the tier as BigInt (0 for Bronze, 1 for Silver, 2 for Gold, 3 for Platinum)
        const ciphertext = this.cipher.encrypt([BigInt(numericTier)], nonce);
        
        return {
            ciphertext,
            nonce,
            clientPubKey: this.clientPubKey
        };
    }
}