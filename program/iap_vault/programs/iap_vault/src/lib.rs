use anchor_lang::prelude::*;
use arcium_anchor::prelude::*; // This brings in the Arcium macros
use arcis::*; // This brings in the .to_mxe() function

declare_id!("9tNsfwyCDBFZRmjuYty4AHpWXziRa26nGjtJAd6qmiR1");

#[program] // <--- 1. CRITICAL MISSING PIECE
pub mod iap_vault {
    use super::*;

    // The function to store the data
    pub fn store_tier(
        ctx: Context<StoreTier>, 
        encrypted_tier: Enc<Shared, u8> // Input: Data encrypted by the user (Helius script)
    ) -> Result<()> {
        
        // 2. CONVERSION: Lift from "Shared" (User) to "Mxe" (Vault)
        // This function exists in the 'arcis' crate traits
        let vault_tier = encrypted_tier.to_mxe(); 
        
        // 3. STORAGE: Save it to the account
        ctx.accounts.state.tier = vault_tier;
        
        Ok(())
    }
}

// 4. THE STORAGE STRUCTURE
#[account]
pub struct UserProfile {
    // We use Enc<Mxe, u8> instead of just Mxe
    // This says: "An encrypted u8 integer stored on the MXE"
    pub tier: Enc<Mxe, u8>, 
}

// 5. THE CONTEXT (Your Logic was correct here!)
#[derive(Accounts)]
pub struct StoreTier<'info> {
    #[account(
        init_if_needed, 
        payer = user, 
        space = 8 + 32, // Discriminator + Encrypted Pointer Size
        seeds = [b"user_profile", user.key().as_ref()], 
        bump
    )]
    pub state: Account<'info, UserProfile>,

    #[account(mut)]
    pub user: Signer<'info>, 
    
    pub system_program: Program<'info, System>,
}