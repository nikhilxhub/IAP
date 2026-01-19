use anchor_lang::prelude::*;

use arcium_anchor::prelude::*;
use arcis::*;

declare_id!("9tNsfwyCDBFZRmjuYty4AHpWXziRa26nGjtJAd6qmiR1");


mod iap_vault {
    use super::*; // Inherit imports from parent (anchor, arcis, etc.)

    // 1. Define the Storage (The "Database")
    // We store the user's tier. 
    // Mxe<u8> means: "An encrypted number that only the Vault can see."
    #[account] // Use standard Anchor macro
    pub struct UserProfile {
        pub tier: Mxe, // Mxe is not generic in arcis 0.6.2
    }

    // 2. The Logic (The "Functions")
    // #[instruction] // Removed unrecognized attribute
    pub fn store_tier(
        ctx: Context<StoreTier>, 
        encrypted_tier: Enc<Shared, u8>
    ) -> anchor_lang::Result<()> {
        // 'encrypted_tier' is what your Helius script sends (Shared Secret)
        // We convert it to 'Mxe' (Vault Secret) so we can compute on it later.
        
        // let vault_tier = encrypted_tier.to_mxe(); // Method not found
        // Stubbing for compilation check
        let vault_tier: Mxe = todo!("Implement conversion from Enc<Shared, u8> to Mxe"); 
        
        // Save to the state
        ctx.accounts.state.tier = vault_tier;
        
        Ok(())
    }
}

use iap_vault::UserProfile;

// 3. The Context (Who can call this?)
#[derive(Accounts)]
pub struct StoreTier<'info> {
    #[account(mut)]
    pub state: Account<'info, UserProfile>,
}
