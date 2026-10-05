"""거래(Transaction): 생성, 서명, 서명 검증, 직렬화."""
from dataclasses import asdict, dataclass

from .hashing import canonical_json, sha256_hex
from .wallet import Wallet, public_key_to_address, verify_signature

COIN = 100_000_000           # 1코인 = 1억 최소단위 (부동소수점 오차 방지를 위해 정수만 사용)
COINBASE_SENDER = "COINBASE"  # 보상 거래의 발신자 표시


def format_coin(units: int) -> str:
    """최소단위 정수를 '12.5 PWC' 형태 문자열로 변환."""
    whole, frac = divmod(units, COIN)
    text = f"{whole:,}" + (f".{frac:08d}".rstrip("0") if frac else "")
    return f"{text} PWC"


@dataclass
class Transaction:
    sender: str             # 보내는 주소 (보상 거래면 "COINBASE")
    recipient: str          # 받는 주소
    amount: int             # 보내는 양 (최소단위 정수)
    fee: int = 0            # 채굴자에게 주는 수수료 (최소단위 정수)
    nonce: int = 0          # 발신 계정의 거래 순번 → 재전송(replay) 방지. 보상 거래는 블록 높이
    sender_pubkey: str = ""  # 발신자 공개키 (서명 검증용)
    signature: str = ""     # 발신자 서명 (hex)

    # ---------- 해시 / 서명 ----------
    def signing_payload(self) -> bytes:
        """서명 대상 바이트: 서명 필드를 제외한 모든 필드의 정규 직렬화."""
        data = asdict(self)
        data.pop("signature")
        return canonical_json(data)

    @property
    def tx_id(self) -> str:
        """거래 ID = SHA-256(서명 대상). 서명을 제외하므로 서명 변형으로 ID를 바꿀 수 없다."""
        return sha256_hex(self.signing_payload())

    @property
    def is_coinbase(self) -> bool:
        return self.sender == COINBASE_SENDER

    def sign(self, wallet: Wallet) -> "Transaction":
        """지갑으로 거래에 서명. 지갑 주소와 발신 주소가 다르면 거부."""
        if wallet.address != self.sender:
            raise ValueError("발신 주소와 지갑 주소가 다릅니다")
        self.sender_pubkey = wallet.public_key_hex
        self.signature = wallet.sign(self.signing_payload())
        return self

    def verify_signature(self) -> bool:
        """서명 검증: (1) 공개키가 발신 주소와 일치 (2) 서명이 유효."""
        if self.is_coinbase or not self.sender_pubkey or not self.signature:
            return False
        try:
            if public_key_to_address(self.sender_pubkey) != self.sender:
                return False
        except ValueError:
            return False
        return verify_signature(self.sender_pubkey, self.signing_payload(), self.signature)

    # ---------- 생성 헬퍼 ----------
    @classmethod
    def create(cls, wallet: Wallet, recipient: str, amount: int, nonce: int, fee: int = 0) -> "Transaction":
        """서명된 일반 거래 생성."""
        tx = cls(sender=wallet.address, recipient=recipient, amount=amount, fee=fee, nonce=nonce)
        return tx.sign(wallet)

    @classmethod
    def coinbase(cls, miner: str, amount: int, height: int) -> "Transaction":
        """보상 거래 생성. nonce에 블록 높이를 넣어 블록마다 tx_id가 달라지게 한다."""
        return cls(sender=COINBASE_SENDER, recipient=miner, amount=amount, fee=0, nonce=height)

    # ---------- 직렬화 ----------
    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Transaction":
        return cls(**data)
