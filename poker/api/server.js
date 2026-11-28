'use strict';
/**
 * Vercel 함수 진입점: 게임 서버(HTTP + WebSocket)를 그대로 내보낸다.
 * 정적 파일(public/)은 Vercel CDN 이 서빙하고, /ws · /api/info · /qr.svg 만 이 함수로 온다.
 */
const { createApp } = require('../lib/app');

const { server } = createApp({ hosted: true, port: 443 });

module.exports = server;
