import { describe, expect, it } from 'vitest';
import {
  bitsToTarget, difficultyToTarget, hashToBigInt, merkleBranches, merkleRoot, merkleRootFromBranches,
  serializeHeader, serializeHeight, sha256d, swapWords, targetToDifficulty,
} from '../src/core/stratum/bitcoin.js';
import { buildBlockHex, checkShare, createJob, notifyParams, type BlockTemplate } from '../src/core/stratum/job.js';

describe('비트코인 직렬화', () => {
  it('제네시스 블록 헤더 해시가 일치한다', () => {
    const header = serializeHeader({
      version: 1,
      prevHashInternal: Buffer.alloc(32),
      merkleRootInternal: Buffer.from('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', 'hex').reverse(),
      time: 1231006505, bits: 0x1d00ffff, nonce: 2083236893,
    });
    expect(Buffer.from(sha256d(header)).reverse().toString('hex'))
      .toBe('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
  });

  it('난이도 ↔ 목표값', () => {
    expect(bitsToTarget('1d00ffff')).toBe(0xffffn << 208n);
    expect(targetToDifficulty(bitsToTarget('1d00ffff'))).toBe(1);
    expect(difficultyToTarget(2)).toBe((0xffffn << 208n) / 2n);
  });

  it('BIP34 높이 직렬화', () => {
    expect(serializeHeight(1).toString('hex')).toBe('51');
    expect(serializeHeight(17).toString('hex')).toBe('0111');
    expect(serializeHeight(128).toString('hex')).toBe('028000');
    expect(serializeHeight(840000).toString('hex')).toBe('0340d10c');
  });

  it('머클 브랜치로 계산한 루트 = 전체 트리 루트 (트랜잭션 수 홀/짝 모두)', () => {
    for (const n of [0, 1, 2, 3, 6, 7]) {
      const hashes = Array.from({ length: n + 1 }, (_, i) => sha256d(Buffer.from([i])));
      const fromBranches = merkleRootFromBranches(hashes[0], merkleBranches(hashes.slice(1)));
      expect(fromBranches.equals(merkleRoot(hashes))).toBe(true);
    }
  });
});

/** 채굴 프로그램(cpuminer/cgminer)과 같은 방식으로 notify 파라미터만 가지고 헤더를 만든다. */
function minerHeader(params: unknown[], en1: string, en2: string, nonce: number) {
  const [, prevhash, coinb1, coinb2, branches, version, nbits, ntime] = params as [string, string, string, string, string[], string, string, string];
  const coinbase = Buffer.from(coinb1 + en1 + en2 + coinb2, 'hex');
  const root = branches.reduce((acc, b) => sha256d(Buffer.concat([acc, Buffer.from(b, 'hex')])), sha256d(coinbase));
  const n = Buffer.alloc(4); n.writeUInt32LE(nonce);
  return Buffer.concat([
    Buffer.from(version, 'hex').reverse(), swapWords(Buffer.from(prevhash, 'hex')), root,
    Buffer.from(ntime, 'hex').reverse(), Buffer.from(nbits, 'hex').reverse(), n,
  ]);
}

describe('Stratum 작업 → 쉐어 → 블록', () => {
  const txs = [1, 2, 3].map((i) => {
    const data = Buffer.from(`fake-tx-${i}`).toString('hex');
    return { data, txid: Buffer.from(sha256d(Buffer.from(data, 'hex'))).reverse().toString('hex') };
  });
  const template: BlockTemplate = {
    version: 0x20000000,
    previousblockhash: '0000000000000000000a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcd',
    transactions: txs, coinbasevalue: 5_000_000_000, bits: '207fffff', height: 1234, curtime: 1_760_000_000,
    default_witness_commitment: '6a24aa21a9ed' + '11'.repeat(32),
  };
  const payoutScript = '0014' + '22'.repeat(20);

  it('채굴자가 notify만으로 만든 헤더와 서버가 재구성한 헤더가 같고, 쉐어/블록 판정이 맞다', () => {
    const job = createJob('1', template, payoutScript);
    const params = notifyParams(job, true);
    const en1 = 'deadbeef', en2 = '00000001';
    const shareDiff = 0.00002;
    const target = difficultyToTarget(shareDiff);

    let nonce = 0;
    let header: Buffer;
    do { header = minerHeader(params, en1, en2, ++nonce); } while (hashToBigInt(sha256d(header)) > target);

    const check = checkShare(job, {
      extranonce1: en1, extranonce2: en2,
      ntime: template.curtime.toString(16).padStart(8, '0'), nonce: nonce.toString(16).padStart(8, '0'),
    }, shareDiff);
    expect(check.header.equals(header)).toBe(true);
    expect(check.meetsShare).toBe(true);
    expect(check.meetsNetwork).toBe(true); // regtest 난이도라 바로 블록 후보

    // 잘못된 nonce는 쉐어 조건을 (거의 확실히) 만족하지 못한다
    const bad = checkShare(job, { extranonce1: en1, extranonce2: en2, ntime: template.curtime.toString(16), nonce: (nonce + 1).toString(16).padStart(8, '0') }, 1);
    expect(bad.meetsShare).toBe(false);

    // 제출할 블록: 헤더 + tx 개수 + 세그윗 코인베이스 + 템플릿 트랜잭션
    const block = Buffer.from(buildBlockHex(job, check), 'hex');
    expect(block.subarray(0, 80).equals(header)).toBe(true);
    expect(block[80]).toBe(4);
    const cbStart = 81;
    expect(block.subarray(cbStart + 4, cbStart + 6).toString('hex')).toBe('0001'); // segwit marker/flag
    expect(block.toString('hex').endsWith(txs.map((t) => t.data).join(''))).toBe(true);

    // 헤더의 머클 루트 = (witness 없는) 코인베이스 txid + 템플릿 txid 들의 머클 루트
    const ids = [sha256d(check.coinbase), ...txs.map((t) => Buffer.from(t.txid, 'hex').reverse())];
    expect(header.subarray(36, 68).equals(merkleRoot(ids))).toBe(true);
  });

  it('coinbase scriptSig는 BIP34 높이로 시작한다', () => {
    const job = createJob('2', template, payoutScript);
    // version(4) + vin count(1) + prevout(36) + script len(1) 다음이 높이
    expect(job.coinb1.subarray(42).toString('hex')).toBe(serializeHeight(1234).toString('hex'));
  });
});
