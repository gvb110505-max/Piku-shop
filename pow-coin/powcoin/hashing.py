"""해시 관련 공통 함수 (직렬화, SHA-256, 난이도 판정)."""
import hashlib
import json


def canonical_json(obj) -> bytes:
    """키 정렬 + 공백 제거 JSON 직렬화.

    같은 데이터는 어느 노드에서 직렬화해도 항상 같은 바이트가 나와야
    해시가 일치하므로, 서명/해시 대상은 반드시 이 함수를 거친다.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_hex(data: bytes) -> str:
    """SHA-256 해시를 16진수 문자열로 반환."""
    return hashlib.sha256(data).hexdigest()


def meets_difficulty(hash_hex: str, bits: int) -> bool:
    """해시의 앞 `bits`개 비트가 모두 0인지 검사.

    256비트 해시를 정수로 보고 오른쪽으로 (256 - bits)만큼 밀면
    앞 `bits`개 비트만 남는다. 그 값이 0이면 조건 충족.
    각 비트가 0일 확률이 1/2 이므로 성공 확률은 1/2^bits (15비트면 1/32768).
    """
    if not 0 <= bits <= 256:
        return False
    return int(hash_hex, 16) >> (256 - bits) == 0
