import { createHelius } from "helius-sdk"
import dotenv from "dotenv"
import * as anchor from "@coral-xyz/anchor"
import { ArciumHander, type InterestProfile, type Tier } from "arcium_sdk"
// @ts-ignore - @arcium-hq/client may not have type definitions
import { getArciumProgramId } from "@arcium-hq/client";

dotenv.config()
const mxeProgramId = getArciumProgramId();

const helius = createHelius({ apiKey: process.env.HELIUS_API_KEY! })

/**
 * Get Solana RPC connection URL
 * Defaults to devnet for testing (Arcium is on devnet)
 */
function getRpcUrl(): string {
    // Priority 1: Use explicitly set SOLANA_RPC_URL
    if (process.env.SOLANA_RPC_URL) {
        return process.env.SOLANA_RPC_URL;
    }
    
    // Priority 2: Use Helius RPC for devnet if API key is available
    if (process.env.HELIUS_API_KEY) {
        // Force devnet for Helius (Arcium is on devnet)
        return `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
    }
    
    // Priority 3: Fallback to public devnet
    console.log("Using public devnet RPC. For better performance, set HELIUS_API_KEY or SOLANA_RPC_URL");
    return "https://api.devnet.solana.com";
}

// InterestProfile is now imported from arcium_sdk
// Re-export for convenience
export type { InterestProfile } from "arcium_sdk";

/**
 * Known DeFi program IDs on Solana
 * These are used to identify DeFi interactions
 */
const DEFI_PROGRAMS = new Set([
    // Jupiter Aggregator
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
    // Orca
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    // Raydium
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    // Serum DEX
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    // Solend
    "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo",
    // Marinade
    "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
    // Lido
    "CrX7kMhLC3cSsXJdT7JDgqrRVWGnUpX3gfEfxxU2NVLi",
]);

/**
 * Known DEX program IDs for trading volume calculation
 */
const DEX_PROGRAMS = new Set([
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter V6
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB", // Jupiter V4
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Orca
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpools
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium
]);

/**
 * Calculate trading volume from transaction history
 * Analyzes transactions to DEX programs and estimates USD volume
 */
async function calculateTradingVolume(
    connection: anchor.web3.Connection,
    address: string,
    limit: number = 100 // Reduced from 1000 to avoid rate limits
): Promise<number> {
    try {
        const pubkey = new anchor.web3.PublicKey(address);
        
        // Get recent transaction signatures
        const signatures = await connection.getSignaturesForAddress(pubkey, { limit });
        
        if (signatures.length === 0) {
            return 0;
        }

        // Get parsed transactions
        const transactions = await connection.getParsedTransactions(
            signatures.map(s => s.signature),
            { maxSupportedTransactionVersion: 0 }
        );

        let totalVolumeUSD = 0;

        for (const tx of transactions) {
            if (!tx || !tx.meta || tx.meta.err) continue;

            // Check if transaction involves a DEX
            const accountKeys = tx.transaction.message.accountKeys;
            const hasDexProgram = accountKeys.some(key => 
                DEX_PROGRAMS.has(key.pubkey.toString())
            );

            if (!hasDexProgram) continue;

            // Estimate volume from pre/post token balances
            // This is a simplified approach - in production, you'd parse swap instructions
            const preBalances = tx.meta.preBalances ?? [];
            const postBalances = tx.meta.postBalances ?? [];
            
            // Calculate SOL movement (simplified - assumes SOL is the quote currency)
            for (let i = 0; i < Math.min(preBalances.length, postBalances.length); i++) {
                const pre = preBalances[i] ?? 0;
                const post = postBalances[i] ?? 0;
                const diff = Math.abs(post - pre);
                if (diff > 0) {
                    // Convert lamports to SOL, then estimate USD (simplified: $100/SOL)
                    // In production, use real-time price feeds
                    const solDiff = diff / 1_000_000_000;
                    totalVolumeUSD += solDiff * 100; // Rough estimate
                }
            }
        }

        return totalVolumeUSD;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Check if it's a rate limit error
        if (errorMsg.includes("429") || errorMsg.includes("Too Many Requests")) {
            console.warn(`Rate limit hit while calculating trading volume. Consider using Helius RPC or reducing transaction limit.`);
        } else {
            console.warn(`Error calculating trading volume: ${errorMsg}`);
        }
        return 0;
    }
}

/**
 * Count DeFi interactions from transaction history
 */
async function countDeFiInteractions(
    connection: anchor.web3.Connection,
    address: string,
    limit: number = 100 // Reduced from 1000 to avoid rate limits
): Promise<number> {
    try {
        const pubkey = new anchor.web3.PublicKey(address);
        const signatures = await connection.getSignaturesForAddress(pubkey, { limit });

        if (signatures.length === 0) {
            return 0;
        }

        const transactions = await connection.getParsedTransactions(
            signatures.map(s => s.signature),
            { maxSupportedTransactionVersion: 0 }
        );

        let defiCount = 0;
        const seenPrograms = new Set<string>();

        for (const tx of transactions) {
            if (!tx || !tx.meta || tx.meta.err) continue;

            const accountKeys = tx.transaction?.message?.accountKeys;
            if (!accountKeys) continue;
            
            for (const key of accountKeys) {
                if (!key?.pubkey) continue;
                const programId = key.pubkey.toString();
                if (DEFI_PROGRAMS.has(programId) && !seenPrograms.has(programId)) {
                    seenPrograms.add(programId);
                    defiCount++;
                }
            }
        }

        return defiCount;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Check if it's a rate limit error
        if (errorMsg.includes("429") || errorMsg.includes("Too Many Requests")) {
            console.warn(`Rate limit hit while counting DeFi interactions. Consider using Helius RPC or reducing transaction limit.`);
        } else {
            console.warn(`Error counting DeFi interactions: ${errorMsg}`);
        }
        return 0;
    }
}

/**
 * Build comprehensive interest profile for a wallet
 * Collects all metrics: NFTs, SOL balance, trading volume, token holdings, DeFi activity
 */
export async function categorizeWallet(address: string): Promise<InterestProfile> {
    console.log(`\n=== Building Interest Profile for ${address} ===\n`);

    // 1. Get all assets (NFTs + tokens)
    const assets = await helius.getAssetsByOwner({ 
        ownerAddress: address,
    });
    
    // Separate NFTs from tokens
    const nfts = assets.items.filter((asset: any) => 
        asset.interface === "V1_NFT" || 
        asset.interface === "V1_PRINT" || 
        asset.interface === "V1_NFT_PRINT" ||
        asset.interface === "V1_NFT_SOL" ||
        asset.interface === "V1_NFT_POL" ||
        asset.interface === "V1_NFT_EDITION" ||
        asset.interface === "V1_NFT_EDITION_PRINT"
    );
    
    const tokens = assets.items.filter((asset: any) => 
        asset.interface !== "V1_PRINT" && 
        !nfts.includes(asset) &&
        asset.token_info?.supply !== undefined
    );

    const nftCount = nfts.length;
    const tokenHoldings = new Set(tokens.map((t: any) => t.id)).size; // Unique token holdings
    
    console.log(`NFT Count: ${nftCount}`);
    console.log(`Token Holdings: ${tokenHoldings}`);
    
    // 2. Get SOL balance
    const balanceResponse = await helius.getBalance(address);
    const solBalanceLamports = balanceResponse.value;
    const solBalance = Number(solBalanceLamports) / 1_000_000_000; // Convert lamports to SOL
    console.log(`SOL Balance: ${solBalance} SOL`);
    
    // 3. Create connection for transaction analysis
    const rpcUrl = getRpcUrl();
    console.log(`Using RPC: ${rpcUrl.replace(/api-key=[^&]+/, "api-key=***")}`); // Mask API key in logs
    const connection = new anchor.web3.Connection(rpcUrl, "confirmed");

    // 4. Calculate trading volume from transaction history
    // Note: Using limited transaction history (100 txs) to avoid rate limits
    // For production, consider using Helius enhanced APIs or pagination
    console.log(`Calculating trading volume (analyzing last 100 transactions)...`);
    let tradingVolume = 0;
    try {
        tradingVolume = await calculateTradingVolume(connection, address, 100);
        console.log(`Trading Volume: $${tradingVolume.toFixed(2)} USD`);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("429") || errorMsg.includes("Too Many Requests")) {
            console.warn(`Rate limit exceeded. Trading volume calculation skipped.`);
            console.warn(`Tip: Set HELIUS_API_KEY in .env to use Helius RPC (no rate limits)`);
        } else {
            console.warn(`Could not calculate trading volume: ${errorMsg}`);
        }
        console.log(`Trading Volume: $0.00 USD (calculation failed)`);
    }
    
    // 5. Count DeFi interactions
    // Note: Using limited transaction history (100 txs) to avoid rate limits
    console.log(`Counting DeFi interactions (analyzing last 100 transactions)...`);
    let defiInteractions = 0;
    try {
        defiInteractions = await countDeFiInteractions(connection, address, 100);
        console.log(`DeFi Interactions: ${defiInteractions}`);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("429") || errorMsg.includes("Too Many Requests")) {
            console.warn(`Rate limit exceeded. DeFi interaction count skipped.`);
            console.warn(`Tip: Set HELIUS_API_KEY in .env to use Helius RPC (no rate limits)`);
        } else {
            console.warn(`Could not count DeFi interactions: ${errorMsg}`);
        }
        console.log(`DeFi Interactions: 0 (calculation failed)`);
    }
    
    // 6. Determine tier based on comprehensive metrics
    // PLATINUM: >100 NFTs AND >100 SOL (mega whales)
    // GOLD: >49 NFTs AND >30 SOL (whales)
    // SILVER: >20 NFTs AND >10 SOL (active users)
    // BRONZE: Everyone else (basic users)
    
    let tier: Tier;
    
    if (nftCount > 100 && solBalance > 100) {
        tier = "PLATINUM_TIER";
    } else if (nftCount > 49 && solBalance > 30) {
        tier = "GOLD_TIER";
    } else if (nftCount > 20 && solBalance > 10) {
        tier = "SILVER_TIER";
    } else {
        tier = "BRONZE_TIER";
    }
    
    console.log(`\nTier: ${tier}`);
    console.log(`=== Interest Profile Complete ===\n`);

    return {
        tier,
        nftCount,
        solBalance,
        tradingVolume,
        tokenHoldings,
        defiInteractions,
    };
}

// helius+arcium
// Encrypts full InterestProfile using Arcium MXE

async function categorizeWalletWithArcium(address: string) {
    const profile = await categorizeWallet(address);

    // 1. Create a connection to Solana
    const rpcUrl = getRpcUrl();
    const connection = new anchor.web3.Connection(rpcUrl, "confirmed");

    // 2. Create a wallet/keypair (using a dummy keypair for read-only operations)
    // For production, you should use a real keypair from environment variables
    const wallet = new anchor.Wallet(anchor.web3.Keypair.generate());

    // 3. Create the AnchorProvider
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed"
    });
    
    // Set the provider globally for Anchor
    anchor.setProvider(provider);

    // 4. Initialize Arcium handler and encrypt the full InterestProfile
    const arciumHandler = new ArciumHander(provider, mxeProgramId);
    await arciumHandler.initializeEncryption();

    // Encrypt all 6 fields: tier, nftCount, solBalance, tradingVolume, tokenHoldings, defiInteractions
    const encrypted = arciumHandler.encryptInterestProfile(profile);

    console.log("\n=== Arcium Encryption Complete ===");
    console.log(`Interest Profile (Plaintext):`);
    console.log(`  Tier: ${profile.tier}`);
    console.log(`  NFT Count: ${profile.nftCount}`);
    console.log(`  SOL Balance: ${profile.solBalance} SOL`);
    console.log(`  Trading Volume: $${profile.tradingVolume.toFixed(2)} USD`);
    console.log(`  Token Holdings: ${profile.tokenHoldings}`);
    console.log(`  DeFi Interactions: ${profile.defiInteractions}`);
    console.log(`\nEncrypted Interest Profile (${encrypted.fieldCount} fields):`);
    console.log(`  Ciphertext: ${encrypted.ciphertext}`);
    console.log(`  Nonce: ${Buffer.from(encrypted.nonce).toString('hex')}`);
    if (encrypted.clientPubKey) {
        console.log(`  Client Public Key: ${Buffer.from(encrypted.clientPubKey).toString('hex')}`);
    }
    console.log(`\nNote: This encrypted data is ready for on-chain storage as SharedEncryptedStruct<6>`);
}

// Use a devnet wallet address for testing
// Replace with any devnet wallet address you want to test
categorizeWalletWithArcium("7j27dGwhKfwyg1KDsN6et8g4TMnVfunuXXfiNjZGUuVQ")

// Example devnet addresses you can use:
// - 7j27dGwhKfwyg1KDsN6et8g4TMnVfunuXXfiNjZGUuVQ
// - Or generate your own devnet wallet for testing


