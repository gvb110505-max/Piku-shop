"""PowCoin 테스트: 난이도, 변조 탐지, 서명, 이중 지불, 보상 정책, 승수."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from powcoin import (  # noqa: E402
    COIN,
    Blockchain,
    ChainConfig,
    InvalidBlock,
    InvalidTransaction,
    Transaction,
    Wallet,
    meets_difficulty,
)

FAST = dict(initial_difficulty=8)  # 테스트 속도를 위해 낮은 난이도 사용


@pytest.fixture
def wallets():
    return Wallet(), Wallet(), Wallet()


@pytest.fixture
def chain():
    return Blockchain(ChainConfig(**FAST))


def funded_chain(miner: Wallet, blocks: int = 2) -> Blockchain:
    c = Blockchain(ChainConfig(**FAST))
    for _ in range(blocks):
        c.mine_block(miner.address, verbose=False)
    return c


# ------------------------------------------------------------------ 난이도
def test_meets_difficulty_counts_leading_zero_bits():
    assert meets_difficulty("0001" + "f" * 60, 15)        # 0000 0000 0000 0001 → 앞 15비트 0
    assert not meets_difficulty("0002" + "f" * 60, 15)    # 0000 0000 0000 0010 → 15번째 비트 1
    assert meets_difficulty("0" * 64, 256)


def test_default_rule_is_15_bits(wallets):
    c = Blockchain()
    assert c.config.initial_difficulty == 15
    block = c.mine_block(wallets[0].address, verbose=False)
    assert block.difficulty == 15
    assert int(block.hash, 16) >> (256 - 15) == 0
    assert bin(int(block.hash, 16))[2:].zfill(256)[:15] == "0" * 15


def test_mined_block_hash_is_reproducible(chain, wallets):
    block = chain.mine_block(wallets[0].address, verbose=False)
    assert block.hash == block.compute_hash()
    assert block.has_valid_pow()


def test_block_without_pow_is_rejected(chain, wallets):
    block = chain.build_candidate(wallets[0].address)
    nonce = 0
    while True:  # 난이도를 만족하지 않는 nonce를 일부러 고른다
        block.nonce = nonce
        if not meets_difficulty(block.compute_hash(), block.difficulty):
            break
        nonce += 1
    block.hash = block.compute_hash()
    with pytest.raises(InvalidBlock, match="작업증명"):
        chain.add_block(block)


def test_block_declaring_lower_difficulty_is_rejected(chain, wallets):
    block = chain.build_candidate(wallets[0].address)
    block.difficulty = 1
    chain.solve(block)
    with pytest.raises(InvalidBlock, match="난이도 불일치"):
        chain.add_block(block)


def test_difficulty_increases_when_blocks_are_fast(wallets):
    c = Blockchain(ChainConfig(initial_difficulty=6, target_block_time=1_000))
    for _ in range(10):
        c.mine_block(wallets[0].address, verbose=False)
    assert c.chain[9].difficulty == 6
    assert c.chain[10].difficulty == 7
    assert c.validate_chain()


def test_difficulty_decreases_when_blocks_are_slow(wallets):
    c = Blockchain(ChainConfig(initial_difficulty=6, target_block_time=1e-9))
    for _ in range(10):
        c.mine_block(wallets[0].address, verbose=False)
    assert c.chain[10].difficulty == 5
    assert c.validate_chain()


# ------------------------------------------------------------------ 보상 정책
def test_reward_halving_and_supply_cap(wallets):
    cfg = ChainConfig(initial_difficulty=4, halving_interval=2, max_supply=120 * COIN)
    c = Blockchain(cfg)
    for _ in range(5):
        c.mine_block(wallets[0].address, verbose=False)
    rewards = [b.transactions[0].amount for b in c.chain[1:]]
    # 50, 50 → (반감) 20(상한까지 남은 양) → 0, 0
    assert rewards == [50 * COIN, 50 * COIN, 20 * COIN, 0, 0]
    assert c.total_issued == 120 * COIN
    assert c.block_reward(3, 0) == 25 * COIN  # 상한이 없을 때 반감된 보상


def test_coinbase_is_first_and_inflated_reward_rejected(chain, wallets):
    block = chain.mine_block(wallets[0].address, verbose=False)
    assert block.transactions[0].is_coinbase
    assert block.transactions[0].recipient == block.miner

    cheat = chain.build_candidate(wallets[0].address)
    cheat.transactions[0].amount += 1  # 보상 부풀리기
    chain.solve(cheat)
    with pytest.raises(InvalidBlock, match="보상 금액 불일치"):
        chain.add_block(cheat)


# ------------------------------------------------------------------ 변조 탐지
def test_tampered_transaction_detected(wallets):
    a, b, _ = wallets
    c = funded_chain(a)
    c.add_transaction(Transaction.create(a, b.address, 5 * COIN, c.next_nonce(a.address)))
    c.mine_block(a.address, verbose=False)
    assert c.validate_chain()

    tampered = c.clone_blocks()
    tampered[3].transactions[1].amount = 90 * COIN
    ok, reason = c.check_chain(tampered)
    assert not ok and "변조" in reason


def test_tampered_then_remined_block_breaks_link(wallets):
    c = funded_chain(wallets[0], blocks=3)
    tampered = c.clone_blocks()
    tampered[1].timestamp += 0.001
    c.solve(tampered[1])  # 변조 블록 자체는 다시 유효한 작업증명을 갖지만
    ok, reason = c.check_chain(tampered)
    assert not ok and "이전 해시" in reason  # 다음 블록과의 연결이 끊어진다


def test_tampered_prev_hash_detected(wallets):
    c = funded_chain(wallets[0])
    tampered = c.clone_blocks()
    tampered[2].prev_hash = "f" * 64
    assert not c.validate_chain(tampered)


# ------------------------------------------------------------------ 서명
def test_valid_signature_verifies(wallets):
    a, b, _ = wallets
    tx = Transaction.create(a, b.address, COIN, nonce=0)
    assert tx.verify_signature()


def test_modified_signed_transaction_fails(wallets):
    a, b, _ = wallets
    tx = Transaction.create(a, b.address, COIN, nonce=0)
    tx.amount = 2 * COIN
    assert not tx.verify_signature()


def test_signature_from_other_key_rejected(wallets):
    a, b, mallory = wallets
    c = funded_chain(a)
    tx = Transaction(sender=a.address, recipient=b.address, amount=COIN, nonce=0)
    tx.sender_pubkey = mallory.public_key_hex
    tx.signature = mallory.sign(tx.signing_payload())
    assert not tx.verify_signature()
    with pytest.raises(InvalidTransaction, match="서명"):
        c.add_transaction(tx)


def test_cannot_sign_for_another_address(wallets):
    a, b, mallory = wallets
    with pytest.raises(ValueError):
        Transaction(sender=a.address, recipient=b.address, amount=COIN).sign(mallory)


def test_wallet_pem_roundtrip(wallets):
    a = wallets[0]
    restored = Wallet.from_pem(a.export_pem(b"pw"), b"pw")
    assert restored.address == a.address


# ------------------------------------------------------------------ 이중 지불
def test_overspend_rejected(wallets):
    a, b, _ = wallets
    c = funded_chain(a, blocks=1)  # 50 코인
    with pytest.raises(InvalidTransaction, match="잔액 부족"):
        c.add_transaction(Transaction.create(a, b.address, 51 * COIN, 0))


def test_duplicate_transaction_rejected(wallets):
    a, b, _ = wallets
    c = funded_chain(a)
    tx = Transaction.create(a, b.address, COIN, 0)
    c.add_transaction(tx)
    with pytest.raises(InvalidTransaction, match="중복"):
        c.add_transaction(tx)
    c.mine_block(a.address, verbose=False)
    with pytest.raises(InvalidTransaction, match="중복"):  # 확정 후 재전송(replay)도 거부
        c.add_transaction(tx)
    assert c.get_balance(b.address) == COIN


def test_pending_double_spend_rejected(wallets):
    a, b, carol = wallets
    c = funded_chain(a, blocks=1)  # 50 코인
    c.add_transaction(Transaction.create(a, b.address, 30 * COIN, 0))
    with pytest.raises(InvalidTransaction, match="잔액 부족"):
        c.add_transaction(Transaction.create(a, carol.address, 30 * COIN, 1))


def test_block_with_double_spend_rejected(wallets):
    a, b, carol = wallets
    c = funded_chain(a, blocks=1)
    block = c.build_candidate(a.address)
    block.transactions += [
        Transaction.create(a, b.address, 30 * COIN, 0),
        Transaction.create(a, carol.address, 30 * COIN, 1),
    ]
    c.solve(block)
    with pytest.raises(InvalidBlock, match="잔액 부족"):
        c.add_block(block)


def test_balances_after_transfer(wallets):
    a, b, _ = wallets
    c = funded_chain(a, blocks=1)
    c.add_transaction(Transaction.create(a, b.address, 10 * COIN, 0, fee=COIN))
    c.mine_block(b.address, verbose=False)
    assert c.get_balance(a.address) == 39 * COIN
    assert c.get_balance(b.address) == 10 * COIN + 50 * COIN + COIN  # 받은 돈 + 보상 + 수수료


# ------------------------------------------------------------------ 승수
def test_successful_mining_increments_wins(chain, wallets):
    a, b, _ = wallets
    assert chain.get_wins(a.address) == 0
    chain.mine_block(a.address, verbose=False)
    assert chain.get_wins(a.address) == 1
    chain.mine_block(a.address, verbose=False)
    chain.mine_block(b.address, verbose=False)
    assert chain.get_wins(a.address) == 2
    assert chain.get_wins(b.address) == 1
    assert chain.leaderboard() == [(a.address, 2), (b.address, 1)]


def test_failed_mining_does_not_change_wins(wallets):
    a = wallets[0]
    c = Blockchain(ChainConfig(initial_difficulty=40))
    assert c.mine_block(a.address, max_attempts=100, verbose=False) is None
    assert c.get_wins(a.address) == 0
    assert len(c.chain) == 1


def test_invalid_block_does_not_change_wins(chain, wallets):
    a, b, _ = wallets
    chain.mine_block(a.address, verbose=False)

    bad = chain.build_candidate(b.address)
    bad.transactions[0].amount *= 2
    chain.solve(bad)
    with pytest.raises(InvalidBlock):
        chain.add_block(bad)

    stale = chain.build_candidate(b.address)
    stale.prev_hash = "0" * 64
    chain.solve(stale)
    with pytest.raises(InvalidBlock):
        chain.add_block(stale)

    assert chain.get_wins(b.address) == 0
    assert chain.get_wins(a.address) == 1


def test_wins_are_derived_from_chain_and_survive_reload(chain, wallets, tmp_path):
    a, b, carol = wallets
    for w in (a, b, a, carol, a, b):
        chain.mine_block(w.address, verbose=False)
    assert chain.wins == chain.recount_wins()

    path = tmp_path / "chain.json"
    chain.save(str(path))
    reloaded = Blockchain.load(str(path))
    assert reloaded.leaderboard() == chain.leaderboard()
    assert reloaded.get_wins(a.address) == 3
    assert reloaded.get_balance(a.address) == chain.get_balance(a.address)


def test_reload_rejects_tampered_miner(chain, wallets):
    a, _, carol = wallets
    chain.mine_block(a.address, verbose=False)
    data = chain.to_dict()
    data["chain"][1]["miner"] = carol.address  # 승수 가로채기 시도
    with pytest.raises(InvalidBlock):
        Blockchain.from_dict(data)
