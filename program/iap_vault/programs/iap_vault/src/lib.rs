use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::{SharedEncryptedStruct, MXEEncryptedStruct};
use arcis::{Enc, Shared, Mxe, ArcisType, ArcisX25519Pubkey, EncData, ArcisCiphertext, EvalValue, Cipher};

declare_id!("9tNsfwyCDBFZRmjuYty4AHpWXziRa26nGjtJAd6qmiR1");

// Interest Profile structure matching TypeScript InterestProfile
// Fields: tier (u8), nftCount (u32), solBalanceLamports (u64), tradingVolumeCents (u64), tokenHoldings (u32), defiInteractions (u32)
// Represented as a tuple for Arcium encryption
type InterestProfileTuple = (u8, u32, u64, u64, u32, u32);

#[program]
pub mod iap_vault {
    use super::*;

    // Store the full Interest Profile (6 fields) encrypted in Arcium MXE
    pub fn store_interest_profile(
        ctx: Context<StoreInterestProfile>, 
        encrypted_profile: SharedEncryptedStruct<6> // Input: 6 fields encrypted by the user (Helius script)
    ) -> Result<()> {
        
        // 1. Reconstruct Enc<Shared, InterestProfileTuple> manually from the input struct
        // We need to convert bytes back to ArcisFields for the EncData
        let mut enc_data_values = Vec::new();
        for cipher_bytes in encrypted_profile.ciphertexts.iter() {
           enc_data_values.push(EvalValue::Base(bytes_to_field(cipher_bytes)));
        }
        
        // EncData::from_values for tuple type (u8, u32, u64, u64, u32, u32)
        // The tuple will be serialized as 6 separate fields
        let enc_data = EncData::<InterestProfileTuple>::from_values(&enc_data_values);

        // Reconstruct pubkey
        let pubkey = ArcisX25519Pubkey::from_uint8(&encrypted_profile.encryption_key);

        // 2. Decrypt (Convert to Arcis/Plaintext inside circuit)
        // This decrypts the Shared encryption to get the InterestProfileTuple
        let profile: InterestProfileTuple = enc_data.to_arcis_with_pubkey_and_nonce(pubkey, encrypted_profile.nonce);

        // 3. Encrypt for MXE (Vault)
        // This generates a new random nonce for the MXE
        let mxe_enc: Enc<Mxe, InterestProfileTuple> = Mxe::get().from_arcis(profile);

        // 4. Serialize Enc<Mxe, InterestProfileTuple> manually to MXEEncryptedStruct (via fields / handle_outputs)
        // structure: [Nonce (1 field), Ciphertext (6 fields for the tuple)]
        let mut outputs = Vec::new();
        mxe_enc.handle_outputs(&mut outputs);

        // Check format: Mxe owner uses 1 field (Nonce). EncData<InterestProfileTuple> uses 6 fields (Ciphertext).
        // Total should be 7 fields (1 nonce + 6 ciphertexts).
        if outputs.len() < 7 {
            return Err(ProgramError::InvalidAccountData.into()); 
        }

        // Extract Nonce
        let nonce_field = match outputs[0] {
            EvalValue::Base(f) => f,
            _ => return Err(ProgramError::InvalidAccountData.into()),
        };
        // Convert nonce field to u128. 
        // to_le_bytes returns 32 bytes (256 bits). We take 16.
        let nonce_bytes = nonce_field.to_le_bytes(); 
        let mut nonce_arr = [0u8; 16];
        nonce_arr.copy_from_slice(&nonce_bytes[0..16]);
        let nonce = u128::from_le_bytes(nonce_arr);

        // Extract Ciphertexts (6 fields for the tuple)
        let mut ciphertexts = [[0u8; 32]; 6];
        for (i, output) in outputs.iter().skip(1).enumerate() {
            if i >= 6 { break; }
             match output {
                EvalValue::Base(f) => {
                    let b = f.to_le_bytes();
                    // Copy into 32 byte array (pad or trim if needed, usually 32 bytes)
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&b[0..32]); // Ensure size match
                    ciphertexts[i] = arr;
                },
                _ => return Err(ProgramError::InvalidAccountData.into()),
            }
        }

        // 5. Store result
        ctx.accounts.state.interest_profile = MXEWrapper {
            inner: MXEEncryptedStruct {
                nonce,
                ciphertexts,
            }
        };
        
        Ok(())
    }

    // Legacy function for backward compatibility (deprecated)
    #[deprecated(note = "Use store_interest_profile instead")]
    pub fn store_tier(
        ctx: Context<StoreTier>, 
        encrypted_tier: SharedEncryptedStruct<1>
    ) -> Result<()> {
        // Keep old implementation for compatibility
        // ... (keeping the old code for now)
        Ok(())
    }
}

// 4. THE STORAGE STRUCTURE
#[account]
pub struct UserProfile {
    // We use a wrapper because MXEEncryptedStruct does not implement Clone, which #[account] requires.
    // The wrapper manually implements Clone by copying the public fields.
    // Updated to store full InterestProfile (6 fields) instead of just tier
    pub interest_profile: MXEWrapper<6>, 
}

// 5. THE CONTEXT
#[derive(Accounts)]
pub struct StoreInterestProfile<'info> {
    #[account(
        init_if_needed, 
        payer = user, 
        // Space calculation: 8 (discriminator) + 16 (nonce) + (32 * 6) (6 ciphertext fields) = 216 bytes
        space = 8 + 16 + (32 * 6),
        seeds = [b"user_profile", user.key().as_ref()], 
        bump
    )]
    pub state: Account<'info, UserProfile>,

    #[account(mut)]
    pub user: Signer<'info>, 
    
    pub system_program: Program<'info, System>,
}

// Legacy context for backward compatibility
#[derive(Accounts)]
pub struct StoreTier<'info> {
    #[account(
        init_if_needed, 
        payer = user, 
        space = 8 + 32 + 32 + 16, // Adjust space for wrapper struct overhead (nonce + ciphertexts)
        seeds = [b"user_profile", user.key().as_ref()], 
        bump
    )]
    pub state: Account<'info, UserProfile>,

    #[account(mut)]
    pub user: Signer<'info>, 
    
    pub system_program: Program<'info, System>,
}

// Wrapper for MXEEncryptedStruct to implement Clone
pub struct MXEWrapper<const LEN: usize> {
    pub inner: MXEEncryptedStruct<LEN>,
}

impl<const LEN: usize> Clone for MXEWrapper<LEN> {
    fn clone(&self) -> Self {
        MXEWrapper {
            inner: MXEEncryptedStruct {
                nonce: self.inner.nonce,
                ciphertexts: self.inner.ciphertexts,
            },
        }
    }
}

impl<const LEN: usize> AnchorSerialize for MXEWrapper<LEN> {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        self.inner.serialize(writer)
    }
}

impl<const LEN: usize> AnchorDeserialize for MXEWrapper<LEN> {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        let inner = MXEEncryptedStruct::<LEN>::deserialize_reader(reader)?;
        Ok(MXEWrapper { inner })
    }
}

// Helper: Convert [u8; 32] to ArcisCiphertext (BaseField)
// Logic adapted from ArcisX25519Pubkey::from_uint8 source
fn bytes_to_field(s: &[u8; 32]) -> ArcisCiphertext {
     // Use existing From<u64> impl on BaseField
     // ArcisCiphertext::from(u64) is standard
     let two_power_eight = ArcisCiphertext::from(256);
     let mut x = ArcisCiphertext::from(0);
     let mut factor = ArcisCiphertext::from(1);
     for &b in s {
         x = x + ArcisCiphertext::from(b as u64) * factor; // ArcisCiphertext arithmetic
         factor = factor * two_power_eight;
     }
     x
}