#!/usr/bin/env node
'use strict';
/**
 * Piku Poker — 친구들과 즐기는 멀티플레이 텍사스 홀덤 (로컬/와이파이 서버)
 *   실행:  node server.js        (포트 변경: PORT=4000 node server.js)
 */
const { createApp } = require('./lib/app');
const qr = require('./lib/qr');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const { server, urls: getUrls } = createApp({ port: PORT });

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✖ 포트 ${PORT} 이 이미 사용 중입니다. 다른 포트로 실행하세요:  PORT=4000 node server.js\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const urls = getUrls();
  const main = urls[0] || `http://localhost:${PORT}`;
  const gold = (s) => `\x1b[38;5;220m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log('');
  console.log(gold('   ♠ ♥  PIKU POKER  ♦ ♣'));
  console.log(dim('   같은 와이파이의 친구들과 텍사스 홀덤'));
  console.log('');
  console.log(`   이 컴퓨터에서:   ${bold(`http://localhost:${PORT}`)}`);
  if (urls.length) {
    console.log(`   친구들 접속:     ${bold(gold(main))}`);
    for (const u of urls.slice(1)) console.log(dim(`                    ${u}`));
  } else {
    console.log('   ⚠ 네트워크 주소를 찾지 못했습니다. 와이파이 연결을 확인하세요.');
  }
  console.log('');
  if (urls.length && !process.env.NO_QR) {
    console.log(dim('   휴대폰 카메라로 스캔해서 바로 입장:'));
    console.log(qr.toTerminal(main).split('\n').map((l) => '   ' + l).join('\n'));
    console.log('');
  }
  console.log(dim('   종료: Ctrl+C'));
  console.log('');
});
