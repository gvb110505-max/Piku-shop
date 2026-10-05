import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 통합 테스트는 같은 테스트 DB 스키마를 초기화하므로 파일 단위로 순차 실행
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000, fileParallelism: false },
});
