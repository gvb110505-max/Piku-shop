/* PIKU 카드 매입 — 설정과 매입가표 (buy/index.html 에서 사용) */

/* ▼ 가게 설정 — 비워두면 해당 항목은 화면에 안 나옴 */
const BUY_CONFIG = {
  kakaoUrl: "",        // 오픈카톡 링크 (https://open.kakao.com/o/...)
  instaId: "",         // 인스타그램 아이디 (@ 빼고)
  minTotal: 0,         // 최소 매입 금액 (원). 0이면 표시 안 함
  payDays: "",         // 정산 시점. 예: "검수 완료 당일"
  shipAddress: "",     // 카드 보낼 주소. 비우면 "신청 후 개별 안내"
  updated: "",         // 매입가 갱신일. 예: "2026-11-23"
};

/* ▼ 상태별 매입 비율 — 매입가표 금액 × 비율 */
const CONDITIONS = [
  { key: "NM", label: "미개봉급",  rate: 1.0, desc: "개봉 직후 바로 슬리브에 넣은 상태. 화이트닝, 찍힘, 휨 없음" },
  { key: "EX", label: "약한 사용감", rate: 0.8, desc: "뒷면 모서리에 작은 화이트닝 1~2곳, 앞면은 깨끗함" },
  { key: "PL", label: "사용감 있음", rate: 0.5, desc: "화이트닝이 여러 곳, 표면 스크래치가 빛에 비춰 보임" },
  { key: "DMG", label: "손상",      rate: 0.2, desc: "접힘, 찢김, 물 자국, 휨. 사진 확인 후 개별 견적" },
];

/* ▼ 매입가표
   game: "pokemon" "onepiece" "yugioh" 등 (GAMES 키와 맞추기)
   name: 카드명 / set: 확장팩 / no: 카드 번호 / rarity: 레어도
   lang: "KR" "JP" "EN" / price: 미개봉급 기준 매입가(원)
   hot: true 면 "매입 강화" 표시
   ※ 아래는 화면 확인용 예시. 실제 카드와 금액으로 바꾸고 SAMPLE 을 false 로. */
const SAMPLE = true;

const GAMES = { pokemon: "포켓몬", onepiece: "원피스", yugioh: "유희왕" };

const buylist = [
  { game:"pokemon",  name:"예시 카드 A", set:"SET-01", no:"001/100", rarity:"SAR", lang:"KR", price:30000, hot:true },
  { game:"pokemon",  name:"예시 카드 B", set:"SET-01", no:"045/100", rarity:"SR",  lang:"KR", price:8000 },
  { game:"pokemon",  name:"예시 카드 C", set:"SET-02", no:"112/098", rarity:"AR",  lang:"JP", price:4000 },
  { game:"onepiece", name:"예시 카드 D", set:"OP-01",  no:"OP01-001", rarity:"SEC", lang:"KR", price:15000 },
  { game:"onepiece", name:"예시 카드 E", set:"OP-02",  no:"OP02-013", rarity:"SR",  lang:"JP", price:3000 },
  { game:"yugioh",   name:"예시 카드 F", set:"PACK-1", no:"KR001",    rarity:"QCSE",lang:"KR", price:20000 },
];
