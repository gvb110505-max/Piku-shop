import { Redis } from 'ioredis';
import { config } from '../config.js';

export const createRedis = () => new Redis(config.redisUrl, { maxRetriesPerRequest: null });

/** 엔진 명령 스트림과 이벤트 채널 이름. */
export const KEYS = {
  ENGINE_STREAM: 'engine:commands',
  ENGINE_GROUP: 'engine',
  EVENTS: 'events',
  replyChannel: (instance: string) => `engine:reply:${instance}`,
  POOL_NETWORK: 'pool:network',     // 스트라텀 서버가 갱신하는 네트워크 정보
  POOL_WORKERS: 'pool:workers',     // 워커별 상태 해시
  HOTWALLET: 'wallet:hot',
};
