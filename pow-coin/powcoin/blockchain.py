"""블록체인: 합의 규칙(난이도·보상·거래 검증), 채굴, 체인 검증, 승수 집계."""
import copy
import hashlib
import json
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from itertools import count

from .block import Block
from .hashing import meets_difficulty
from .transaction import COIN, Transaction, format_coin
from .wallet import is_valid_address

GENESIS_MINER = "GENESIS"
ZERO_HASH = "0" * 64


class ChainError(Exception):
    """체인 규칙 위반의 기본 예외."""


class InvalidTransaction(ChainError):
    """거래가 규칙(서명, 잔액, 중복, nonce 등)을 위반."""


class InvalidBlock(ChainError):
    """블록이 규칙(해시 연결, 난이도, 보상 등)을 위반."""


@dataclass
class ChainConfig:
    """합의 파라미터. 모든 노드가 같은 값을 써야 같은 체인을 유효하다고 판단한다."""
    initial_difficulty: int = 15            # 시작 난이도: 앞 15비트가 0
    target_block_time: float = 1.0          # 목표 블록 간격(초)
    adjust_interval: int = 10               # 몇 블록마다 난이도를 조정할지
    min_difficulty: int = 1
    max_difficulty: int = 64
    initial_reward: int = 50 * COIN         # 초기 블록 보상
    halving_interval: int = 210_000         # 보상 반감 주기(블록)
    max_supply: int = 21_000_000 * COIN     # 총 발행량 상한
    max_txs_per_block: int = 1_000
    max_future_drift: float = 2 * 60 * 60   # 미래 타임스탬프 허용 한도(초)


@dataclass
class LedgerState:
    """체인을 처음부터 재생(replay)해서 얻는 원장 상태."""
    balances: dict[str, int] = field(default_factory=dict)
    nonces: dict[str, int] = field(default_factory=dict)   # 주소별 다음에 써야 할 nonce
    tx_ids: set[str] = field(default_factory=set)          # 확정된 모든 거래 ID
    issued: int = 0                                         # 지금까지 발행된 총량

    def copy(self) -> "LedgerState":
        return LedgerState(dict(self.balances), dict(self.nonces), set(self.tx_ids), self.issued)

    def balance(self, address: str) -> int:
        return self.balances.get(address, 0)

    def next_nonce(self, address: str) -> int:
        return self.nonces.get(address, 0)


class Blockchain:
    def __init__(self, config: ChainConfig | None = None, genesis: Block | None = None):
        self.config = config or ChainConfig()
        if genesis is None:
            genesis = self._create_genesis()
        self._check_genesis(genesis)
        self.chain: list[Block] = [genesis]
        self.state = LedgerState()
        self.mempool: list[Transaction] = []
        # 승수 캐시. add_block()에서 검증을 통과한 블록에 대해서만 +1 된다.
        # 언제든 recount_wins()로 체인의 miner 필드에서 다시 계산할 수 있다.
        self.wins: Counter[str] = Counter()
        self.verbose = True  # 난이도 조정 등 이벤트 출력 여부

    # ================================================================
    # 제네시스
    # ================================================================
    @staticmethod
    def _create_genesis() -> Block:
        """제네시스 블록 생성: 거래 없음, 이전 해시는 0, 채굴 보상 없음."""
        genesis = Block(0, time.time(), [], ZERO_HASH, GENESIS_MINER, difficulty=0)
        genesis.hash = genesis.compute_hash()
        return genesis

    @staticmethod
    def _check_genesis(block: Block) -> None:
        """제네시스 블록의 구조와 해시가 올바른지 검사."""
        if (block.index != 0 or block.prev_hash != ZERO_HASH or block.transactions
                or block.miner != GENESIS_MINER or block.hash != block.compute_hash()):
            raise InvalidBlock("제네시스 블록이 올바르지 않습니다")

    @property
    def last_block(self) -> Block:
        return self.chain[-1]

    @property
    def height(self) -> int:
        """다음에 추가될 블록의 높이."""
        return len(self.chain)

    # ================================================================
    # 합의 규칙: 난이도 조정 / 블록 보상
    # ================================================================
    def expected_difficulty(self, blocks: list[Block], height: int) -> int:
        """높이 `height` 블록이 가져야 할 난이도(비트 수).

        adjust_interval(10) 블록마다 최근 구간의 평균 채굴 시간을 계산해
        - 목표의 절반보다 빠르면 +1비트 (2배 어려워짐)
        - 목표의 2배보다 느리면 -1비트 (2배 쉬워짐)
        로 조정한다. 블록 타임스탬프만으로 계산하므로 누구나 재현 가능하다.
        """
        cfg = self.config
        if height <= 1:
            return cfg.initial_difficulty
        prev = blocks[height - 1].difficulty
        if height % cfg.adjust_interval != 0:
            return prev
        first = blocks[max(0, height - cfg.adjust_interval - 1)]
        last = blocks[height - 1]
        avg = (last.timestamp - first.timestamp) / (last.index - first.index)
        if avg < cfg.target_block_time / 2:
            prev += 1
        elif avg > cfg.target_block_time * 2:
            prev -= 1
        return max(cfg.min_difficulty, min(cfg.max_difficulty, prev))

    def block_reward(self, height: int, issued: int) -> int:
        """높이 `height`의 블록 보상.

        초기 보상을 halving_interval 블록마다 절반으로 줄이고(정수 시프트),
        총 발행량 상한(max_supply)을 절대 넘지 않도록 남은 양으로 자른다.
        """
        cfg = self.config
        halvings = (height - 1) // cfg.halving_interval
        reward = cfg.initial_reward >> halvings if halvings < 64 else 0
        return max(0, min(reward, cfg.max_supply - issued))

    # ================================================================
    # 거래 / 블록 검증 (상태 전이)
    # ================================================================
    @staticmethod
    def _apply_transaction(state: LedgerState, tx: Transaction) -> None:
        """일반 거래를 검증하고 state에 반영. 위반 시 InvalidTransaction.

        이중 지불 방지:
          - 같은 tx_id가 이미 확정됐으면 '중복 거래'로 거부
          - nonce가 계정의 다음 순번과 다르면 거부 (재전송/순서 조작 방지)
          - 잔액 < 금액 + 수수료 이면 '잔액 부족'으로 거부
        """
        if tx.is_coinbase:
            raise InvalidTransaction("보상 거래는 블록 첫 거래로만 허용됩니다")
        for name in ("amount", "fee", "nonce"):
            value = getattr(tx, name)
            if not isinstance(value, int) or isinstance(value, bool):
                raise InvalidTransaction(f"{name}은(는) 정수여야 합니다")
        if tx.amount <= 0 or tx.fee < 0:
            raise InvalidTransaction("금액은 양수, 수수료는 0 이상이어야 합니다")
        if not is_valid_address(tx.recipient):
            raise InvalidTransaction("받는 주소 형식이 올바르지 않습니다")
        if not tx.verify_signature():
            raise InvalidTransaction("서명이 유효하지 않습니다")
        tx_id = tx.tx_id
        if tx_id in state.tx_ids:
            raise InvalidTransaction("중복 거래입니다")
        if tx.nonce != state.next_nonce(tx.sender):
            raise InvalidTransaction(
                f"nonce 불일치 (기대값 {state.next_nonce(tx.sender)}, 받은 값 {tx.nonce})"
            )
        cost = tx.amount + tx.fee
        if state.balance(tx.sender) < cost:
            raise InvalidTransaction(
                f"잔액 부족 (잔액 {format_coin(state.balance(tx.sender))}, 필요 {format_coin(cost)})"
            )
        state.balances[tx.sender] = state.balance(tx.sender) - cost
        state.balances[tx.recipient] = state.balance(tx.recipient) + tx.amount
        state.nonces[tx.sender] = tx.nonce + 1
        state.tx_ids.add(tx_id)

    def _apply_block(self, state: LedgerState, block: Block, prev_blocks: list[Block]) -> LedgerState:
        """블록을 이전 체인(prev_blocks) 뒤에 붙일 수 있는지 검증하고 새 상태를 반환.

        검사 항목: 높이, 해시 연결, 타임스탬프, 채굴자 주소, 난이도 값,
        해시 재계산 일치, 작업증명 충족, coinbase 위치/금액, 모든 거래 유효성.
        """
        prev = prev_blocks[-1]
        if block.index != len(prev_blocks):
            raise InvalidBlock(f"블록 높이 불일치 (기대 {len(prev_blocks)}, 받은 {block.index})")
        if block.prev_hash != prev.hash:
            raise InvalidBlock(f"블록 #{block.index}: 이전 해시 연결이 끊어졌습니다")
        if not isinstance(block.timestamp, (int, float)) or block.timestamp < prev.timestamp:
            raise InvalidBlock(f"블록 #{block.index}: 타임스탬프가 이전 블록보다 앞섭니다")
        if block.timestamp > time.time() + self.config.max_future_drift:
            raise InvalidBlock(f"블록 #{block.index}: 타임스탬프가 너무 먼 미래입니다")
        if not is_valid_address(block.miner):
            raise InvalidBlock(f"블록 #{block.index}: 채굴자 주소가 올바르지 않습니다")
        expected = self.expected_difficulty(prev_blocks, block.index)
        if block.difficulty != expected:
            raise InvalidBlock(
                f"블록 #{block.index}: 난이도 불일치 (기대 {expected}비트, 선언 {block.difficulty}비트)"
            )
        if block.hash != block.compute_hash():
            raise InvalidBlock(f"블록 #{block.index}: 해시가 블록 내용과 일치하지 않습니다 (변조)")
        if not meets_difficulty(block.hash, block.difficulty):
            raise InvalidBlock(f"블록 #{block.index}: 작업증명 미충족 (앞 {block.difficulty}비트가 0이 아님)")

        txs = block.transactions
        if not txs or not txs[0].is_coinbase:
            raise InvalidBlock(f"블록 #{block.index}: 첫 거래는 보상(coinbase) 거래여야 합니다")
        if len(txs) - 1 > self.config.max_txs_per_block:
            raise InvalidBlock(f"블록 #{block.index}: 거래 수 초과")

        new_state = state.copy()
        fees = 0
        for tx in txs[1:]:
            try:
                self._apply_transaction(new_state, tx)
            except InvalidTransaction as exc:
                raise InvalidBlock(f"블록 #{block.index}: 잘못된 거래 포함 - {exc}") from exc
            fees += tx.fee

        coinbase = txs[0]
        reward = self.block_reward(block.index, state.issued)
        if (coinbase.recipient != block.miner or coinbase.nonce != block.index
                or coinbase.fee != 0 or coinbase.sender_pubkey or coinbase.signature):
            raise InvalidBlock(f"블록 #{block.index}: 보상 거래 형식이 올바르지 않습니다")
        if coinbase.amount != reward + fees:
            raise InvalidBlock(
                f"블록 #{block.index}: 보상 금액 불일치 (허용 {format_coin(reward + fees)}, "
                f"청구 {format_coin(coinbase.amount)})"
            )
        new_state.balances[block.miner] = new_state.balance(block.miner) + coinbase.amount
        new_state.tx_ids.add(coinbase.tx_id)
        new_state.issued += reward
        return new_state

    def _replay(self, blocks: list[Block]) -> LedgerState:
        """제네시스부터 모든 블록을 재검증하며 원장 상태를 다시 만든다."""
        if not blocks:
            raise InvalidBlock("빈 체인입니다")
        self._check_genesis(blocks[0])
        state = LedgerState()
        for i in range(1, len(blocks)):
            state = self._apply_block(state, blocks[i], blocks[:i])
        return state

    def check_chain(self, blocks: list[Block] | None = None) -> tuple[bool, str]:
        """전체 체인 검증. (유효 여부, 사유) 반환."""
        try:
            self._replay(self.chain if blocks is None else blocks)
        except (ChainError, KeyError, TypeError, ValueError) as exc:
            return False, str(exc)
        return True, "OK"

    def validate_chain(self, blocks: list[Block] | None = None) -> bool:
        """전체 체인 검증: 해시 연결 + 난이도 충족 + 보상 + 거래 유효성."""
        return self.check_chain(blocks)[0]

    # ================================================================
    # 거래 풀(mempool)
    # ================================================================
    def _pending_state(self) -> LedgerState:
        """확정 상태 + 대기 중 거래를 모두 반영한 상태 (대기 중 이중 지불 방지용)."""
        state = self.state.copy()
        for tx in self.mempool:
            self._apply_transaction(state, tx)
        return state

    def add_transaction(self, tx: Transaction) -> str:
        """거래를 검증해 mempool에 넣는다. 성공 시 tx_id 반환, 실패 시 InvalidTransaction."""
        if any(p.tx_id == tx.tx_id for p in self.mempool):
            raise InvalidTransaction("중복 거래입니다 (이미 대기 중)")
        self._apply_transaction(self._pending_state(), tx)
        self.mempool.append(tx)
        return tx.tx_id

    def next_nonce(self, address: str) -> int:
        """새 거래에 써야 할 nonce (대기 중 거래 포함)."""
        return self._pending_state().next_nonce(address)

    # ================================================================
    # 채굴
    # ================================================================
    def build_candidate(self, miner: str) -> Block:
        """채굴할 후보 블록 구성: coinbase를 첫 거래로 넣고 mempool 거래를 채운다."""
        if not is_valid_address(miner):
            raise ValueError("채굴자 주소 형식이 올바르지 않습니다")
        height = self.height
        state = self.state.copy()
        included: list[Transaction] = []
        for tx in self.mempool[: self.config.max_txs_per_block]:
            try:
                self._apply_transaction(state, tx)
                included.append(tx)
            except InvalidTransaction:
                continue
        fees = sum(tx.fee for tx in included)
        reward = self.block_reward(height, self.state.issued)
        coinbase = Transaction.coinbase(miner, reward + fees, height)
        return Block(
            index=height,
            timestamp=max(time.time(), self.last_block.timestamp),
            transactions=[coinbase] + included,
            prev_hash=self.last_block.hash,
            miner=miner,
            difficulty=self.expected_difficulty(self.chain, height),
        )

    @staticmethod
    def solve(block: Block, max_attempts: int | None = None) -> tuple[bool, int, float]:
        """nonce를 0부터 1씩 올리며 SHA-256(블록 데이터 + nonce)의 앞 N비트가 0인 값을 찾는다.

        난수를 쓰지 않으므로 같은 블록 데이터면 누가 돌려도 같은 nonce가 나온다.
        반환: (성공 여부, 시도 횟수, 소요 시간)
        """
        base = hashlib.sha256(block.header_bytes())  # 블록 데이터 부분은 한 번만 해시
        shift = 256 - block.difficulty
        start = time.perf_counter()
        for nonce in count():
            if max_attempts is not None and nonce >= max_attempts:
                return False, nonce, time.perf_counter() - start
            h = base.copy()
            h.update(str(nonce).encode())
            digest = h.digest()
            if int.from_bytes(digest, "big") >> shift == 0:
                block.nonce = nonce
                block.hash = digest.hex()
                return True, nonce + 1, time.perf_counter() - start
        raise AssertionError("unreachable")

    def mine_block(self, miner: str, max_attempts: int | None = None, verbose: bool = True) -> Block | None:
        """후보 블록을 만들고 채굴. 성공하면 체인에 추가(→ 승수 +1), 실패하면 None (승수 불변)."""
        block = self.build_candidate(miner)
        ok, attempts, elapsed = self.solve(block, max_attempts)
        if not ok:
            if verbose:
                print(f"[채굴 실패] 블록 #{block.index} | {attempts:,}회 시도 후 중단 | {elapsed:.3f}s")
            return None
        self.add_block(block)
        if verbose:
            self.print_mined(block, attempts, elapsed)
        return block

    def print_mined(self, block: Block, attempts: int, elapsed: float) -> None:
        """채굴 결과 한 줄 출력 (시도 횟수, 소요 시간, 보상, 승수)."""
        print(
            f"[채굴 성공] 블록 #{block.index:<3} 난이도 {block.difficulty}비트 | "
            f"시도 {attempts:>9,}회 | {elapsed:6.3f}s | 채굴자 {block.miner[:8]} | "
            f"보상 {format_coin(block.transactions[0].amount)} | 승수 {self.get_wins(block.miner)}"
        )

    def add_block(self, block: Block) -> None:
        """외부(또는 자신)가 채굴한 블록을 검증 후 추가. 무효면 InvalidBlock, 아무 상태도 바뀌지 않음."""
        new_state = self._apply_block(self.state, block, self.chain)
        prev_difficulty = self.last_block.difficulty
        self.chain.append(block)
        self.state = new_state
        self.wins[block.miner] += 1  # 검증을 통과한 블록만 승수 +1
        included = {tx.tx_id for tx in block.transactions}
        self.mempool = [tx for tx in self.mempool if tx.tx_id not in included]
        self._prune_mempool()
        if self.verbose and block.index > 1 and block.difficulty != prev_difficulty:
            print(f"[난이도 조정] {prev_difficulty}비트 → {block.difficulty}비트 (블록 #{block.index}부터)")

    def _prune_mempool(self) -> None:
        """새 블록 반영 후 더 이상 유효하지 않은 대기 거래 제거."""
        state = self.state.copy()
        valid = []
        for tx in self.mempool:
            try:
                self._apply_transaction(state, tx)
                valid.append(tx)
            except InvalidTransaction:
                pass
        self.mempool = valid

    # ================================================================
    # 조회: 잔액 / 승수
    # ================================================================
    def get_balance(self, address: str) -> int:
        """확정된 잔액 (최소단위 정수)."""
        return self.state.balance(address)

    @property
    def total_issued(self) -> int:
        return self.state.issued

    def recount_wins(self, blocks: list[Block] | None = None) -> Counter[str]:
        """체인의 miner 필드만으로 승수를 다시 계산 (제네시스 제외)."""
        blocks = self.chain if blocks is None else blocks
        return Counter(b.miner for b in blocks[1:])

    def get_wins(self, address: str) -> int:
        """채굴자의 승수 (채굴 성공 횟수)."""
        return self.wins.get(address, 0)

    def leaderboard(self) -> list[tuple[str, int]]:
        """승수 내림차순 리더보드. 동률이면 주소 오름차순 (결정적 정렬)."""
        return sorted(self.wins.items(), key=lambda kv: (-kv[1], kv[0]))

    # ================================================================
    # 저장 / 불러오기
    # ================================================================
    def to_dict(self) -> dict:
        return {"config": asdict(self.config), "chain": [b.to_dict() for b in self.chain]}

    @classmethod
    def from_dict(cls, data: dict) -> "Blockchain":
        """저장된 체인을 불러오며 모든 블록을 처음부터 재검증. 승수도 체인에서 다시 계산된다."""
        try:
            blocks = [Block.from_dict(b) for b in data["chain"]]
            chain = cls(ChainConfig(**data["config"]), genesis=blocks[0])
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise InvalidBlock(f"체인 데이터 형식 오류: {exc}") from exc
        chain.verbose = False
        for block in blocks[1:]:
            chain.add_block(block)
        chain.verbose = True
        return chain

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: str) -> "Blockchain":
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))

    def clone_blocks(self) -> list[Block]:
        """변조 실험용 깊은 복사본."""
        return copy.deepcopy(self.chain)
