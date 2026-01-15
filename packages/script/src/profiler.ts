import { createHelius } from "helius-sdk"
import dotenv from "dotenv"
import * as anchor from "@coral-xyz/anchor"
import { ArciumHander } from "arcium_sdk"
import type { Tier } from "arcium_sdk"
import { getArciumProgramId } from "@arcium-hq/client";

dotenv.config()
const mxeProgramId = getArciumProgramId();

const helius = createHelius({ apiKey: process.env.HELIUS_API_KEY! })

async function categorizeWallet(address: string): Promise<Tier> {

    // 1. Get all NFTs (non-fungible tokens only)
    const assets = await helius.getAssetsByOwner({ 
        ownerAddress: address,
        
    })
    
    const nftCount = assets.items.length;
    console.log(`NFT Count: ${nftCount}`);
    
    // 2. Get SOL balance
    const balanceResponse = await helius.getBalance(address);
    const solBalanceLamports = balanceResponse.value;
    const solBalance = Number(solBalanceLamports) / 1_000_000_000; // Convert lamports to SOL
    console.log(`SOL Balance: ${solBalance} SOL`);
    
    // 3. Determine tier based on NFT count and SOL balance
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
    
    console.log(`Tier: ${tier}`);

    return tier;
}

// helius+arcium

async function categorizeWalletWithArcium(address: string) {
    const tier = await categorizeWallet(address);

    // 1. Create a connection to Solana
    const connection = new anchor.web3.Connection(
        process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
        "confirmed"
    );

    // 2. Create a wallet/keypair (using a dummy keypair for read-only operations)
    // For production, you should use a real keypair from environment variables
    const wallet = new anchor.Wallet(anchor.web3.Keypair.generate());

    // 3. Create the AnchorProvider
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed"
    });
    
    // Set the provider globally for Anchor
    anchor.setProvider(provider);

    // 4. Get the Arcium MXE Program ID
    // This should be set in your .env file as ARCIUM_MXE_PROGRAM_ID
    // If not provided, you'll need to get it from Arcium documentation
    // if (!process.env.ARCIUM_MXE_PROGRAM_ID) {
    //     throw new Error("ARCIUM_MXE_PROGRAM_ID environment variable is required");
    // }
    // const mxeProgramId = new anchor.web3.PublicKey(process.env.ARCIUM_MXE_PROGRAM_ID);

    // 5. Initialize Arcium handler and encrypt the tier
    const arciumHandler = new ArciumHander(provider, mxeProgramId);
    await arciumHandler.initializeEncryption();

    const { ciphertext, nonce, clientPubKey } = arciumHandler.encryptTier(tier);

    console.log("arcium + helius tier categorization complete");
    console.log(`Tier: ${tier}`);
    console.log(`Ciphertext: ${ciphertext}`);
    console.log(`Nonce: ${Buffer.from(nonce).toString('hex')}`);
    if (clientPubKey) {
        console.log(`Client Public Key: ${Buffer.from(clientPubKey).toString('hex')}`);
    }
}

categorizeWalletWithArcium("5856eDnA3haMp8P8vBj8RoygDQcM3ahF7gmqjq4RckWb")

// 7j27dGwhKfwyg1KDsN6et8g4TMnVfunuXXfiNjZGUuVQ

