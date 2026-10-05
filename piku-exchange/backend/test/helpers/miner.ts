/** 테스트용: 채굴 프로그램(cpuminer)과 같은 방식으로 notify 파라미터만으로 헤더를 만들고 쉐어를 찾는다. */
import { difficultyToTarget, hashToBigInt, sha256d, swapWords } from '../../src/core/stratum/bitcoin.js';

export function minerHeader(params: unknown[], en1: string, en2: string, nonce: number) {
  const [, prevhash, coinb1, coinb2, branches, version, nbits, ntime] = params as [string, string, string, string, string[], string, string, string];
  const coinbase = Buffer.from(coinb1 + en1 + en2 + coinb2, 'hex');
  const root = branches.reduce((acc, b) => sha256d(Buffer.concat([acc, Buffer.from(b, 'hex')])), sha256d(coinbase));
  const n = Buffer.alloc(4); n.writeUInt32LE(nonce);
  return Buffer.concat([
    Buffer.from(version, 'hex').reverse(), swapWords(Buffer.from(prevhash, 'hex')), root,
    Buffer.from(ntime, 'hex').reverse(), Buffer.from(nbits, 'hex').reverse(), n,
  ]);
}

/** 쉐어 난이도를 만족하는 nonce 찾기. */
export function findShare(params: unknown[], en1: string, en2: string, difficulty: number, startNonce = 0) {
  const target = difficultyToTarget(difficulty);
  for (let nonce = startNonce; ; nonce++) {
    const header = minerHeader(params, en1, en2, nonce);
    if (hashToBigInt(sha256d(header)) <= target) return { nonce, header };
  }
}
