use {
    accountability::{
        constants::{COMMITMENT_SEED, VAULT_SEED},
        state::{Commitment, CommitmentState},
    },
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::instruction::Instruction,
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const STARTING_BALANCE: u64 = 10_000_000_000;
const STAKE_AMOUNT: u64 = 1_000_000_000;
const DEADLINE: i64 = 100;

#[test]
fn oracle_can_resolve_success_and_replay_is_rejected() {
    let mut fixture = setup();
    send_stake(&mut fixture);
    let staker_after_stake = balance(&fixture.svm, fixture.staker.pubkey());
    let vault_balance = balance(&fixture.svm, fixture.vault);
    let active_commitment = read_commitment(&fixture.svm, fixture.commitment);

    assert_eq!(active_commitment.staker, fixture.staker.pubkey());
    assert_eq!(active_commitment.amount, STAKE_AMOUNT);
    assert_eq!(active_commitment.state, CommitmentState::Active);
    assert_eq!(active_commitment.oracle_pubkey, fixture.oracle.pubkey());
    assert_eq!(active_commitment.deadline, DEADLINE);
    assert_eq!(
        active_commitment.failure_destination,
        fixture.destination.pubkey()
    );

    send_oracle_resolve(&mut fixture, true);

    assert_eq!(
        balance(&fixture.svm, fixture.staker.pubkey()),
        staker_after_stake + STAKE_AMOUNT + (vault_balance - STAKE_AMOUNT)
    );
    assert!(fixture.svm.get_account(&fixture.vault).is_none());
    assert_eq!(
        read_commitment(&fixture.svm, fixture.commitment).state,
        CommitmentState::Resolved
    );
    assert!(try_oracle_resolve(&mut fixture, true).is_err());
}

#[test]
fn oracle_can_resolve_failure_to_stored_destination() {
    let mut fixture = setup();
    send_stake(&mut fixture);
    let destination_before = balance(&fixture.svm, fixture.destination.pubkey());

    send_oracle_resolve(&mut fixture, false);

    assert_eq!(
        balance(&fixture.svm, fixture.destination.pubkey()),
        destination_before + STAKE_AMOUNT
    );
    assert!(fixture.svm.get_account(&fixture.vault).is_none());
}

#[test]
fn non_oracle_cannot_resolve() {
    let mut fixture = setup();
    send_stake(&mut fixture);
    let attacker = Keypair::new();
    fixture
        .svm
        .airdrop(&attacker.pubkey(), STARTING_BALANCE)
        .unwrap();

    let instruction = resolve_instruction(&fixture, attacker.pubkey(), true);
    assert!(send_result(&mut fixture.svm, &attacker, instruction).is_err());
    assert_eq!(
        read_commitment(&fixture.svm, fixture.commitment).state,
        CommitmentState::Active
    );
    assert!(fixture.svm.get_account(&fixture.vault).is_some());
}

#[test]
fn anyone_can_timeout_after_deadline_but_not_before() {
    let mut fixture = setup();
    send_stake(&mut fixture);
    let cranker = Keypair::new();
    fixture
        .svm
        .airdrop(&cranker.pubkey(), STARTING_BALANCE)
        .unwrap();
    let destination_before = balance(&fixture.svm, fixture.destination.pubkey());

    let timeout = timeout_instruction(&fixture, cranker.pubkey());
    assert!(send_result(&mut fixture.svm, &cranker, timeout).is_err());
    fixture.svm.expire_blockhash();

    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = DEADLINE;
    fixture.svm.set_sysvar(&clock);

    assert!(try_oracle_resolve(&mut fixture, true).is_err());
    assert_eq!(
        read_commitment(&fixture.svm, fixture.commitment).state,
        CommitmentState::Active
    );

    let timeout = timeout_instruction(&fixture, cranker.pubkey());
    send(&mut fixture.svm, &cranker, timeout);

    assert_eq!(
        balance(&fixture.svm, fixture.destination.pubkey()),
        destination_before + STAKE_AMOUNT
    );
    assert!(fixture.svm.get_account(&fixture.vault).is_none());
    assert_eq!(
        read_commitment(&fixture.svm, fixture.commitment).state,
        CommitmentState::Resolved
    );
}

struct Fixture {
    svm: LiteSVM,
    staker: Keypair,
    oracle: Keypair,
    destination: Keypair,
    commitment: Pubkey,
    vault: Pubkey,
}

fn setup() -> Fixture {
    let program_id = accountability::id();
    let staker = Keypair::new();
    let oracle = Keypair::new();
    let destination = Keypair::new();
    let mut svm = LiteSVM::new();
    svm.add_program(
        program_id,
        include_bytes!("../../../target/deploy/accountability.so"),
    )
    .unwrap();
    svm.airdrop(&staker.pubkey(), STARTING_BALANCE).unwrap();
    svm.airdrop(&oracle.pubkey(), STARTING_BALANCE).unwrap();
    svm.airdrop(&destination.pubkey(), 1_000_000).unwrap();

    let (commitment, _) =
        Pubkey::find_program_address(&[COMMITMENT_SEED, staker.pubkey().as_ref()], &program_id);
    let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, commitment.as_ref()], &program_id);

    Fixture {
        svm,
        staker,
        oracle,
        destination,
        commitment,
        vault,
    }
}

fn send_stake(fixture: &mut Fixture) {
    let instruction = Instruction::new_with_bytes(
        accountability::id(),
        &accountability::instruction::Stake {
            amount: STAKE_AMOUNT,
            oracle_pubkey: fixture.oracle.pubkey(),
            deadline: DEADLINE,
            failure_destination: fixture.destination.pubkey(),
        }
        .data(),
        accountability::accounts::Stake {
            staker: fixture.staker.pubkey(),
            commitment: fixture.commitment,
            vault: fixture.vault,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut fixture.svm, &fixture.staker, instruction);
}

fn send_oracle_resolve(fixture: &mut Fixture, did_succeed: bool) {
    try_oracle_resolve(fixture, did_succeed).unwrap();
}

fn try_oracle_resolve(
    fixture: &mut Fixture,
    did_succeed: bool,
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    let instruction = resolve_instruction(fixture, fixture.oracle.pubkey(), did_succeed);
    send_result(&mut fixture.svm, &fixture.oracle, instruction)
}

fn resolve_instruction(fixture: &Fixture, oracle: Pubkey, did_succeed: bool) -> Instruction {
    Instruction::new_with_bytes(
        accountability::id(),
        &accountability::instruction::Resolve { did_succeed }.data(),
        accountability::accounts::Resolve {
            oracle,
            staker: fixture.staker.pubkey(),
            commitment: fixture.commitment,
            vault: fixture.vault,
            destination: fixture.destination.pubkey(),
        }
        .to_account_metas(None),
    )
}

fn timeout_instruction(fixture: &Fixture, cranker: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        accountability::id(),
        &accountability::instruction::Timeout {}.data(),
        accountability::accounts::Timeout {
            cranker,
            staker: fixture.staker.pubkey(),
            commitment: fixture.commitment,
            vault: fixture.vault,
            destination: fixture.destination.pubkey(),
        }
        .to_account_metas(None),
    )
}

fn send(svm: &mut LiteSVM, payer: &Keypair, instruction: Instruction) {
    send_result(svm, payer, instruction).unwrap();
}

fn send_result(
    svm: &mut LiteSVM,
    payer: &Keypair,
    instruction: Instruction,
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    let message = Message::new_with_blockhash(
        &[instruction],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let transaction =
        VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    svm.send_transaction(transaction).map(|_| ())
}

fn balance(svm: &LiteSVM, address: Pubkey) -> u64 {
    svm.get_account(&address)
        .map_or(0, |account| account.lamports)
}

fn read_commitment(svm: &LiteSVM, address: Pubkey) -> Commitment {
    let account = svm.get_account(&address).unwrap();
    Commitment::try_deserialize(&mut account.data.as_slice()).unwrap()
}
