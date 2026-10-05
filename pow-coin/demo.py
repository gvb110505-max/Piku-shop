"""PowCoin 데모: 지갑 3개 → 경쟁 채굴(승수) → 전송 → 이중 지불 거부 → 검증 → 변조 탐지 → 리더보드."""
import os
import tempfile

from powcoin import COIN, Blockchain, ChainConfig, InvalidTransaction, Transaction, Wallet, format_coin


def section(title: str) -> None:
    print(f"\n{'=' * 70}\n {title}\n{'=' * 70}")


def race_round(chain: Blockchain, miners: dict[str, Wallet]) -> None:
    """한 라운드 경쟁 채굴.

    채굴자마다 자기 주소가 들어간 후보 블록을 만들고 nonce를 0부터 올린다.
    (채굴자 주소가 블록 데이터에 들어가므로 각자 해시 공간이 다르다.)
    모두 같은 속도로 해시를 계산한다고 가정하면 '가장 적은 시도로 성공한 사람'이
    가장 먼저 찾은 사람이므로 그 사람이 승자다. 난수 없이 해시만으로 결정되므로
    누구나 같은 결과를 재현·검증할 수 있다.
    """
    results = []
    for name, wallet in miners.items():
        block = chain.build_candidate(wallet.address)
        _, attempts, elapsed = chain.solve(block)
        results.append((attempts, name, block, elapsed))
    attempts, winner, block, elapsed = min(results, key=lambda r: (r[0], r[1]))
    chain.add_block(block)  # 검증을 통과해야만 체인에 추가되고 승수가 +1 된다
    summary = ", ".join(f"{n} {a:,}회" for a, n, _, _ in sorted(results, key=lambda r: r[1]))
    print(f"  라운드 #{block.index:<3} 시도[{summary}] → 승자 {winner}")
    chain.print_mined(block, attempts, elapsed)


def print_balances(chain: Blockchain, wallets: dict[str, Wallet]) -> None:
    for name, w in wallets.items():
        print(f"  {name:<6} 잔액 {format_coin(chain.get_balance(w.address)):>16} | 승수 {chain.get_wins(w.address)}")


def print_leaderboard(chain: Blockchain, names: dict[str, str]) -> None:
    for rank, (address, wins) in enumerate(chain.leaderboard(), start=1):
        print(f"  {rank}위  {names.get(address, address[:8]):<6} {address}  {wins}승")


def main() -> None:
    config = ChainConfig(initial_difficulty=15, target_block_time=0.5, adjust_interval=10)
    chain = Blockchain(config)

    section("1. 지갑 3개 생성")
    wallets = {name: Wallet() for name in ("alice", "bob", "carol")}
    names = {w.address: n for n, w in wallets.items()}
    for name, w in wallets.items():
        print(f"  {name:<6} 주소 {w.address}")

    section(f"2. 경쟁 채굴 12라운드 (시작 난이도 {config.initial_difficulty}비트, 10블록마다 조정)")
    for _ in range(12):
        race_round(chain, wallets)
    print()
    print_balances(chain, wallets)

    section("3. 코인 전송")
    alice, bob, carol = wallets["alice"], wallets["bob"], wallets["carol"]
    for sender, receiver, amount in ((alice, bob, 10), (bob, carol, 5)):
        if chain.get_balance(sender.address) < amount * COIN:
            print(f"  {names[sender.address]} 잔액이 부족해 전송을 건너뜀")
            continue
        tx = Transaction.create(sender, receiver.address, amount * COIN, chain.next_nonce(sender.address), fee=COIN // 10)
        chain.add_transaction(tx)
        print(f"  {names[sender.address]} → {names[receiver.address]} {amount} PWC (수수료 0.1) 접수: {tx.tx_id[:16]}…")

    print("\n  [이중 지불 / 부정 거래 시도]")
    attempts = []
    rich = max(wallets.values(), key=lambda w: chain.get_balance(w.address))
    overspend = Transaction.create(rich, carol.address, chain.get_balance(rich.address) + COIN, chain.next_nonce(rich.address))
    attempts.append(("잔액보다 많이 보내기", overspend))
    attempts.append(("같은 거래 재전송", chain.mempool[0]))
    forged = Transaction(sender=alice.address, recipient=carol.address, amount=COIN,
                         nonce=chain.next_nonce(alice.address)).sign(alice)
    forged.amount = 1_000 * COIN  # 서명 후 금액 변조
    attempts.append(("서명 후 금액 변조", forged))
    for label, tx in attempts:
        try:
            chain.add_transaction(tx)
            print(f"  ✗ {label}: 통과됨 (버그!)")
        except InvalidTransaction as exc:
            print(f"  ✓ {label}: 거부 - {exc}")

    print("\n  거래를 블록에 담기 위해 한 라운드 더 채굴")
    race_round(chain, wallets)
    print()
    print_balances(chain, wallets)
    print(f"  총 발행량 {format_coin(chain.total_issued)} / 상한 {format_coin(config.max_supply)}")

    section("4. 전체 체인 검증")
    ok, reason = chain.check_chain()
    print(f"  블록 {len(chain.chain)}개 검증 결과: {'유효' if ok else '무효'} ({reason})")

    section("5. 변조 시도")
    tampered = chain.clone_blocks()
    tampered[-1].transactions[1].amount = 9_999 * COIN
    ok, reason = chain.check_chain(tampered)
    print(f"  (a) 블록 #{tampered[-1].index}의 거래 금액 변조 → {'유효' if ok else '무효'}: {reason}")

    tampered = chain.clone_blocks()
    thief = wallets["carol"].address
    victim = next(b for b in tampered[1:] if b.miner != thief)  # carol이 채굴하지 않은 첫 블록
    victim.miner = thief
    victim.transactions[0].recipient = thief
    ok, reason = chain.check_chain(tampered)
    print(f"  (b) 블록 #{victim.index} 채굴자를 carol로 바꿔 승수 가로채기 → {'유효' if ok else '무효'}: {reason}")

    chain.solve(victim)  # 변조한 블록을 다시 채굴해도 다음 블록의 prev_hash와 끊어진다
    ok, reason = chain.check_chain(tampered)
    print(f"  (c) (b)를 다시 채굴해 해시를 맞춰도 → {'유효' if ok else '무효'}: {reason}")
    print(f"  원본 체인은 그대로: {'유효' if chain.validate_chain() else '무효'}")

    section("6. 저장 후 다시 불러와 승수 재계산")
    path = os.path.join(tempfile.gettempdir(), "powcoin_chain.json")
    chain.save(path)
    reloaded = Blockchain.load(path)
    same = reloaded.leaderboard() == chain.leaderboard() == sorted(
        chain.recount_wins().items(), key=lambda kv: (-kv[1], kv[0]))
    print(f"  {path} 저장/로드 → 승수 일치: {same}")

    section("7. 최종 승수 리더보드")
    print_leaderboard(reloaded, names)


if __name__ == "__main__":
    main()
