/* eslint-disable @typescript-eslint/tslint/config */
export const anchorTomlContent = `[programs.localnet]
{folderName} = "replace_with_actual_program_id"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "anchor test --skip-build"

[idl]
format = "json"
`;

export const cargoTomlContent = `[package]
name = "{folderName}"
version = "0.1.0"
edition = "2021"

[dependencies]
anchor-lang = "0.28.0"
solana-program = "1.11.0"

[lib]
crate-type = ["cdylib", "lib"]

[features]
no-entrypoint = []
`;

export const programRsContent = `use anchor_lang::prelude::*;

declare_id!("replace_with_actual_program_id");

#[program]
pub mod {folderName} {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let base_account = &mut ctx.accounts.base_account;
        base_account.data = 0;
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let base_account = &mut ctx.accounts.base_account;
        base_account.data += 1;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = 8 + 8)]
    pub base_account: Account<'info, BaseAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub base_account: Account<'info, BaseAccount>,
}

#[account]
pub struct BaseAccount {
    pub data: u64;
}
`;

export const testTsContent = `import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { {folderName} } from "../target/types/{folderName}";
import { assert } from "chai";

describe("{folderName} program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.{folderName} as Program<{folderName}>;

  let baseAccount = anchor.web3.Keypair.generate();

  it("Initializes the account", async () => {
    await program.methods.initialize().accounts({
      baseAccount: baseAccount.publicKey,
      user: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([baseAccount]).rpc();

    const account = await program.account.baseAccount.fetch(baseAccount.publicKey);
    assert.equal(account.data.toNumber(), 0);
  });

  it("Increments the account data", async () => {
    await program.methods.increment().accounts({
      baseAccount: baseAccount.publicKey,
    }).rpc();

    const account = await program.account.baseAccount.fetch(baseAccount.publicKey);
    assert.equal(account.data.toNumber(), 1);
  });
});
`;
