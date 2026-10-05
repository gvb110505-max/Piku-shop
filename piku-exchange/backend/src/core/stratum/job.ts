/**
 * getblocktemplate 결과로 Stratum 작업(job)을 만들고, 채굴자가 제출한 쉐어를 검증한다.
 *
 * 코인베이스 트랜잭션 = coinb1 + extranonce1(서버가 연결마다 부여) + extranonce2(채굴자) + coinb2
 */
import {
  bitsToTarget, difficultyToTarget, hashToBigInt, hexReverse, merkleBranches, merkleRootFromBranches,
  serializeHeader, serializeHeight, sha256d, swapWords, u32le, u64le, varInt,
} from './bitcoin.js';

export interface BlockTemplate {
  version: number;
  previousblockhash: string;
  transactions: { data: string; txid: string; hash?: string }[];
  coinbasevalue: number;
  bits: string;
  height: number;
  curtime: number;
  mintime?: number;
  default_witness_commitment?: string;
}

export const EXTRANONCE1_SIZE = 4;
export const EXTRANONCE2_SIZE = 4;

export interface Job {
  id: string;
  template: BlockTemplate;
  coinb1: Buffer;
  coinb2: Buffer;
  branches: Buffer[];
  prevHashInternal: Buffer;
  networkTarget: bigint;
  networkDifficultyTarget: string;
  createdAt: number;
}

/**
 * 작업 생성.
 * @param payoutScript 블록 보상을 받을 풀 주소의 scriptPubKey (hex)
 * @param tag          coinbase에 남길 풀 표시 문자열
 */
export function createJob(id: string, t: BlockTemplate, payoutScript: string, tag = '/PIKU-pool/'): Job {
  const heightPush = serializeHeight(t.height);
  const tagBytes = Buffer.from(tag, 'ascii');
  const scriptSigLen = heightPush.length + EXTRANONCE1_SIZE + EXTRANONCE2_SIZE + tagBytes.length;
  if (scriptSigLen > 100) throw new Error('coinbase scriptSig가 100바이트를 넘습니다');

  const outputs: Buffer[] = [];
  const payout = Buffer.from(payoutScript, 'hex');
  outputs.push(Buffer.concat([u64le(BigInt(t.coinbasevalue)), varInt(payout.length), payout]));
  if (t.default_witness_commitment) {
    const wc = Buffer.from(t.default_witness_commitment, 'hex');
    outputs.push(Buffer.concat([u64le(0n), varInt(wc.length), wc]));
  }

  const coinb1 = Buffer.concat([
    u32le(1),                       // tx version
    varInt(1),                      // 입력 1개
    Buffer.alloc(32, 0), u32le(0xffffffff), // coinbase 입력 (prevout 없음)
    varInt(scriptSigLen),
    heightPush,
  ]);
  const coinb2 = Buffer.concat([
    tagBytes,
    u32le(0xffffffff),              // sequence
    varInt(outputs.length), ...outputs,
    u32le(0),                       // locktime
  ]);

  const txHashes = t.transactions.map((tx) => Buffer.from(hexReverse(tx.txid), 'hex'));
  return {
    id, template: t, coinb1, coinb2,
    branches: merkleBranches(txHashes),
    prevHashInternal: Buffer.from(hexReverse(t.previousblockhash), 'hex'),
    networkTarget: bitsToTarget(t.bits),
    networkDifficultyTarget: t.bits,
    createdAt: Date.now(),
  };
}

/** mining.notify 파라미터. 버전/비트/시간은 빅엔디언 hex, prevhash는 4바이트 워드 스왑. */
export function notifyParams(job: Job, cleanJobs: boolean): unknown[] {
  return [
    job.id,
    swapWords(job.prevHashInternal).toString('hex'),
    job.coinb1.toString('hex'),
    job.coinb2.toString('hex'),
    job.branches.map((b) => b.toString('hex')),
    job.template.version.toString(16).padStart(8, '0'),
    job.template.bits,
    job.template.curtime.toString(16).padStart(8, '0'),
    cleanJobs,
  ];
}

export interface ShareInput { extranonce1: string; extranonce2: string; ntime: string; nonce: string; versionMask?: number; versionBits?: string }

export interface ShareCheck {
  hash: Buffer;          // 헤더 해시 (내부 바이트 순서)
  hashHex: string;       // 표시용 블록 해시
  header: Buffer;
  coinbase: Buffer;
  meetsShare: boolean;
  meetsNetwork: boolean;
}

/** 채굴자가 제출한 값으로 헤더를 재구성해 해시를 계산하고 쉐어/블록 조건을 판정. */
export function checkShare(job: Job, s: ShareInput, shareDifficulty: number): ShareCheck {
  const coinbase = Buffer.concat([job.coinb1, Buffer.from(s.extranonce1, 'hex'), Buffer.from(s.extranonce2, 'hex'), job.coinb2]);
  const root = merkleRootFromBranches(sha256d(coinbase), job.branches);
  let version = job.template.version;
  if (s.versionBits && s.versionMask) {
    version = (version & ~s.versionMask) | (parseInt(s.versionBits, 16) & s.versionMask);
  }
  const header = serializeHeader({
    version,
    prevHashInternal: job.prevHashInternal,
    merkleRootInternal: root,
    time: parseInt(s.ntime, 16),
    bits: parseInt(job.template.bits, 16),
    nonce: parseInt(s.nonce, 16),
  });
  const hash = sha256d(header);
  const value = hashToBigInt(hash);
  return {
    hash, hashHex: Buffer.from(hash).reverse().toString('hex'), header, coinbase,
    meetsShare: value <= difficultyToTarget(shareDifficulty),
    meetsNetwork: value <= job.networkTarget,
  };
}

/** submitblock용 블록 hex. 세그윗 블록이면 코인베이스에 witness reserved value(32바이트 0)를 붙인다. */
export function buildBlockHex(job: Job, check: ShareCheck): string {
  let coinbase = check.coinbase;
  if (job.template.default_witness_commitment) {
    // version | marker(00) flag(01) | 입력/출력 | witness(1개 항목, 32바이트 0) | locktime
    const body = coinbase.subarray(4, coinbase.length - 4);
    coinbase = Buffer.concat([
      coinbase.subarray(0, 4), Buffer.from([0x00, 0x01]), body,
      Buffer.from([0x01, 0x20]), Buffer.alloc(32, 0),
      coinbase.subarray(coinbase.length - 4),
    ]);
  }
  return Buffer.concat([
    check.header,
    varInt(job.template.transactions.length + 1),
    coinbase,
    ...job.template.transactions.map((tx) => Buffer.from(tx.data, 'hex')),
  ]).toString('hex');
}
