// 멀티플레이 연결 자리 (아직 미구현).
// 나중에 WebSocket 서버를 붙일 때 이 인터페이스를 구현하면 됩니다.
//   connect(roomId, profile) -> Promise
//   sendState(snapshot)       // 매 틱 내 상태 전송
//   onPlayerJoin / onPlayerLeave / onPlayerState 콜백
export class NetworkClient {
  constructor() { this.connected = false; }
  async connect() { throw new Error('멀티플레이는 아직 준비 중입니다.'); }
  sendState() {}
  disconnect() { this.connected = false; }
}
