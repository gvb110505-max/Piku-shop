/* PIKU 카드 — 설정과 가격표 (buy/index.html 에서 사용) */

/* ▼ 가게 설정 — 비워두면 해당 항목은 화면에 안 나옴 */
const BUY_CONFIG = {
  buyRate: 0.6,        // 매입가 = 판매가 × 이 비율 (100원 단위 버림)
  kakaoUrl: "",        // 오픈카톡 링크 (https://open.kakao.com/o/...)
  instaId: "",         // 인스타그램 아이디 (@ 빼고)
  minTotal: 0,         // 최소 매입 금액 (원). 0이면 표시 안 함
  payDays: "",         // 정산 시점. 예: "검수 완료 당일"
  shipAddress: "",     // 카드 보낼 주소. 비우면 "신청 후 개별 안내"
  updated: "",          // 가격 갱신일. 예: "2026-11-27"
};

/* ▼ 상태별 매입 비율 — 매입가 × 비율 (가게 사정에 맞게 고치기) */
const CONDITIONS = [
  { key: "NM", label: "미개봉급",  rate: 1.0, desc: "개봉 직후 바로 슬리브에 넣은 상태. 화이트닝, 찍힘, 휨 없음" },
  { key: "EX", label: "약한 사용감", rate: 0.8, desc: "뒷면 모서리에 작은 화이트닝 1~2곳, 앞면은 깨끗함" },
  { key: "PL", label: "사용감 있음", rate: 0.5, desc: "화이트닝이 여러 곳, 표면 스크래치가 빛에 비춰 보임" },
  { key: "DMG", label: "손상",      rate: 0.2, desc: "접힘, 찢김, 물 자국, 휨. 사진 확인 후 개별 견적" },
];

const SAMPLE = false;
const GAMES = { pokemon: "포켓몬" };

/* ▼ 가격표 — price 는 "판매가"(손님이 살 때 가격). 매입가는 자동 계산.
   game / name / set: 확장팩 / no: 카드 번호 / rarity: 레어도 / lang: "KR" "JP" "EN"
   stock: 재고 수량 (0 이면 구매 탭에서 "품절". 빼두면 재고 표시 안 함)
   hot: true 면 "매입 강화" 표시
   ※ 비어 있으면 가격표에 "정리하고 있어요" 문구가 나옴 */
const buylist = [
  // 예: { game:"pokemon", name:"카드명", set:"확장팩", no:"001/100", rarity:"SR", lang:"KR", price:10000, stock:1 },
];
