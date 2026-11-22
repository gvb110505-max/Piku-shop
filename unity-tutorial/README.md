# 열사의 행성 – 튜토리얼 프로토타입 (Unity / C#)

기본 도형 + 단색 머티리얼 + 이름 라벨만으로 만든 튜토리얼 구간 프로토타입.
범위: 시작 → 임시거처 도착 또는 열사(사망). 그 이후 이야기/식물 성장/상점 확장은 포함하지 않음.

> ⚠ 이 코드는 Unity 에디터가 없는 환경에서 작성되어 **컴파일/실행 검증을 하지 못했습니다.**
> 처음 열었을 때 컴파일 오류나 경고가 있으면 알려주세요.

## 설치
1. Unity 2021.3 LTS 이상(3D 프로젝트, Built-in 또는 URP)에서 새 프로젝트 생성
2. 이 폴더의 `Assets/Scripts` 를 프로젝트의 `Assets/` 에 복사
3. **Edit > Project Settings > Player > Active Input Handling** 을 `Input Manager (Old)` 또는 `Both` 로 설정 (재시작 필요)
4. 빈 씬을 열고 메뉴 **Tutorial > Build Tutorial Scene** 실행 → 씬 전체가 자동 배치됨
5. 씬을 저장(Ctrl+S) — 재시작 버튼이 씬을 다시 불러오므로 Build Settings에 씬이 등록되어 있어야 함(저장된 씬이면 자동 등록)
6. Play

## 조작
WASD 이동 · 마우스 시점 · E 상호작용 · 차 안에서 WASD 운전 / E 하차 · 대사창은 E 또는 숫자키/클릭
(에디터에서 Esc로 마우스가 풀리면 화면 클릭으로 다시 고정)

## 진행 순서
1. 검은 화면 페이드 인(밤, 3코인) → 가게로 이동
2. 가게 안 괴물과 대화 → "3코인을 준다"
3. 괴물이 입을 벌림 → 씨앗 획득
4. 집 진입 → 물통에서 물(0.12L) 획득, 물 게이지 표시
5. 밭: 씨앗 심기 → 물 주기(파티클, 새싹 등장)
6. 열기 경고 안내 → 가림막 씌우기 → **90초 타이머 시작**
7. 낡은 차 탑승 → 임시거처(약 600m 거리)로 운전
8. 타이머 종료 전 도착 = 성공 / 아침이 된 뒤 안전 구역 밖 15초 = 사망

## 구조
| 스크립트 | 역할 |
|---|---|
| `GameManager` | 게임 상태(Intro/Playing/Success/GameOver), 코인·씨앗·물, 사망/성공/재시작 |
| `QuestManager` | 진행 단계(enum), 목표 텍스트, 목표 마커 대상 |
| `DayTimer` | 해 뜨기 카운트다운, 하늘/조명색 변화, 30초 이하 경고음 |
| `HeatSystem` | 열기 게이지, 15초 사망, 이동 속도 감소 |
| `SafeZone` | 가게·집 내부 / 임시거처 그늘 (트리거 콜라이더, 차량 탑승 시 차량 위치로 판정) |
| `PlayerController` / `VehicleController` / `ThirdPersonCamera` | 이동, 운전, 3인칭 카메라(열기 흔들림) |
| `Interactable` → `Monster`, `Seed`, `WaterTank`, `FarmPlot`, `Car` | E 상호작용 오브젝트 |
| `UIManager` | HUD·대사창·페이드·열기 비네트·결과 화면 (전부 코드로 생성) |

## 인스펙터에서 조절하는 값
- `DayTimer`: Duration(90), Warning Time(30), 하늘/조명 색
- `HeatSystem`: Death Time(15), Recover Rate, Min Speed Multiplier
- `PlayerController`: Move Speed / `VehicleController`: Max Speed, Acceleration, Steer Speed
- `GameManager`: Start Coins(3), Fade In Duration, 물 양(탱크에서 얻는 양, 1회 소모량)
- `Monster`: 입 벌림 각도/시간, 코인 비용 / `FarmPlot`: 각 연출 시간, 열기 경고 문구
- `QuestManager`: 단계별 목표 문구, 마커 높이

## 실제 모델로 교체하기
모든 오브젝트는 `Visual` 자식에 도형이 들어 있습니다. `Visual`을 모델로 바꿔 끼우고,
`Monster`의 `Upper Jaw / Lower Jaw` 피벗만 새 뼈대에 연결하면 됩니다.
`WorldLabel` 컴포넌트를 지우면 이름 라벨이 사라집니다.

## 알려진 제약 (프로토타입)
- 차량 충돌은 CharacterController(캡슐) 기반이라 차체 앞뒤가 약간 겹칠 수 있음
- 임시거처가 걸어서 닿기 힘든 거리인지는 `Player Speed(5) × (90+15초)` 기준으로 배치(z=600). 거리/속도는 씬과 인스펙터에서 조절
- 한글 폰트는 OS 폰트(맑은 고딕 등)를 사용. 폰트가 없는 환경에서는 글자가 깨질 수 있음 → `FontProvider`에서 교체
- 타이머 종료 직후라도 15초 안에 임시거처에 도착해 생존하면 성공으로 처리
