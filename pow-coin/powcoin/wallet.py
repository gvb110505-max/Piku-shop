"""지갑: ECDSA(secp256k1) 키쌍 생성, 서명, 서명 검증, 주소 파생."""
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from .hashing import sha256_hex

ADDRESS_HEX_LEN = 40


def public_key_to_address(pubkey_hex: str) -> str:
    """공개키(압축 포맷 hex) → 주소. SHA-256(공개키)의 앞 20바이트(40 hex)."""
    return sha256_hex(bytes.fromhex(pubkey_hex))[:ADDRESS_HEX_LEN]


def is_valid_address(address) -> bool:
    """주소 형식 검사: 소문자 16진수 40자."""
    return (
        isinstance(address, str)
        and len(address) == ADDRESS_HEX_LEN
        and all(c in "0123456789abcdef" for c in address)
    )


def verify_signature(pubkey_hex: str, message: bytes, signature_hex: str) -> bool:
    """공개키로 서명을 검증. 형식 오류를 포함한 모든 실패는 False."""
    try:
        public_key = ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256K1(), bytes.fromhex(pubkey_hex)
        )
        public_key.verify(bytes.fromhex(signature_hex), message, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


class Wallet:
    """ECDSA 키쌍을 보관하는 지갑."""

    def __init__(self, private_key: ec.EllipticCurvePrivateKey | None = None):
        # 개인키는 OS의 암호학적 난수(CSPRNG)로 생성된다.
        # (채굴/보상 결정에는 난수를 전혀 쓰지 않는다)
        self._private_key = private_key or ec.generate_private_key(ec.SECP256K1())

    @property
    def public_key_hex(self) -> str:
        """압축 포맷(33바이트) 공개키 hex."""
        return self._private_key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.CompressedPoint
        ).hex()

    @property
    def address(self) -> str:
        return public_key_to_address(self.public_key_hex)

    def sign(self, message: bytes) -> str:
        """메시지를 개인키로 서명하고 DER 서명을 hex로 반환."""
        return self._private_key.sign(message, ec.ECDSA(hashes.SHA256())).hex()

    def export_pem(self, password: bytes) -> bytes:
        """개인키를 비밀번호로 암호화한 PEM으로 내보낸다 (평문 저장 금지)."""
        return self._private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.BestAvailableEncryption(password),
        )

    @classmethod
    def from_pem(cls, pem: bytes, password: bytes) -> "Wallet":
        """암호화된 PEM에서 지갑 복원."""
        key = serialization.load_pem_private_key(pem, password=password)
        if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256K1):
            raise ValueError("secp256k1 개인키가 아닙니다")
        return cls(key)
