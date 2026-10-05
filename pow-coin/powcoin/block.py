"""블록: 헤더 직렬화, 해시 계산, 직렬화."""
import hashlib
from dataclasses import dataclass, field

from .hashing import canonical_json, meets_difficulty
from .transaction import Transaction


@dataclass
class Block:
    index: int                  # 블록 높이 (제네시스 = 0)
    timestamp: float            # 블록 생성 시각 (UNIX 초)
    transactions: list[Transaction]
    prev_hash: str              # 이전 블록 해시 → 체인 연결
    miner: str                  # 채굴자 주소 (승수 집계 기준)
    difficulty: int             # 이 블록이 충족해야 하는 앞자리 0 비트 수
    nonce: int = 0              # 채굴로 찾아낸 값
    hash: str = field(default="")

    def header_bytes(self) -> bytes:
        """'블록 데이터' = nonce와 hash를 제외한 모든 필드의 정규 직렬화."""
        return canonical_json({
            "index": self.index,
            "timestamp": self.timestamp,
            "transactions": [tx.to_dict() for tx in self.transactions],
            "prev_hash": self.prev_hash,
            "miner": self.miner,
            "difficulty": self.difficulty,
        })

    def compute_hash(self) -> str:
        """SHA-256(블록 데이터 + nonce). 누구나 같은 입력으로 재계산해 검증할 수 있다."""
        return hashlib.sha256(self.header_bytes() + str(self.nonce).encode()).hexdigest()

    def has_valid_pow(self) -> bool:
        """저장된 해시가 실제 계산값과 같고, 난이도 조건을 충족하는지."""
        return self.hash == self.compute_hash() and meets_difficulty(self.hash, self.difficulty)

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "timestamp": self.timestamp,
            "transactions": [tx.to_dict() for tx in self.transactions],
            "prev_hash": self.prev_hash,
            "miner": self.miner,
            "difficulty": self.difficulty,
            "nonce": self.nonce,
            "hash": self.hash,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Block":
        return cls(
            index=data["index"],
            timestamp=data["timestamp"],
            transactions=[Transaction.from_dict(t) for t in data["transactions"]],
            prev_hash=data["prev_hash"],
            miner=data["miner"],
            difficulty=data["difficulty"],
            nonce=data["nonce"],
            hash=data["hash"],
        )
