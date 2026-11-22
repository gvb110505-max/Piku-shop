# Piku Arena (프로토타입)

3D 멀티 액션 게임 프로토타입. Three.js(ES 모듈, CDN) 사용, 빌드 과정 없음.

## 실행
ES 모듈이라 파일을 직접 열면(file://) 동작하지 않습니다. 저장소 루트에서:

```
python3 -m http.server 8000
```
후 http://localhost:8000/game/ 접속. (Vercel 등에 배포하면 `/game/` 경로로 바로 동작)

## 조작
WASD/방향키 이동 · Space 점프 · Shift 달리기 · 마우스 시점(클릭해서 고정) · Esc/P 일시정지

## 구조
- `js/main.js` – 메인 메뉴, 화면 상태(menu/playing/paused/result), 게임 루프
- `js/single.js` – 싱글 모드 (코인 15개 모으기 타임어택)
- `js/player.js` – 이동·점프·중력·박스 충돌, `snapshot()`으로 멀티용 상태 직렬화
- `js/character.js` – 기본 도형(캡슐/구/박스) 캐릭터 + 걷기 애니메이션
- `js/camera.js` – 3인칭 궤도 카메라
- `js/world.js` – 맵/조명/충돌 박스
- `js/network.js` – 멀티플레이 연결 인터페이스 자리 (미구현)
