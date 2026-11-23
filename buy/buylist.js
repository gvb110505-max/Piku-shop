/* PIKU 카드 — 설정과 가격표 (buy/index.html 에서 사용) */

/* ▼ 가게 설정 — 비워두면 해당 항목은 화면에 안 나옴 */
const BUY_CONFIG = {
  buyRate: 0.6,        // 매입가 = 판매가 × 이 비율 (100원 단위 버림)
  kakaoUrl: "",        // 오픈카톡 링크 (https://open.kakao.com/o/...)
  instaId: "",         // 인스타그램 아이디 (@ 빼고)
  minTotal: 0,         // 최소 매입 금액 (원). 0이면 표시 안 함
  payDays: "",         // 정산 시점. 예: "검수 완료 당일"
  shipAddress: "",     // 카드 보낼 주소. 비우면 "신청 후 개별 안내"
  updated: "2026-11-23", // 가격 갱신일
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
   ---- 아래 줄 끝 주석은 가격 출처. 사장님 참고용이고 화면엔 안 나옴 ----
   pokesise = 포켓시세 번개장터 거래 평균가 / pokepolio = 포케폴리오 한글판 실거래가
   두 사이트 모두 2026-11-23 첫 화면에서 확인. 확장팩·번호가 사이트에 없던 칸은 비워둠 */
const buylist = [
  // 거래가 잦고 값이 오르는 중이거나 버티는 카드
  { game:"pokemon", name:"N의 방안",       set:"",                    no:"173/086", rarity:"SAR", lang:"KR", price:33500, hot:true }, // pokesise 인기
  { game:"pokemon", name:"유카리",          set:"",                    no:"116/080", rarity:"SAR", lang:"KR", price:28700, hot:true }, // pokesise 인기
  { game:"pokemon", name:"릴리에의 결심",    set:"",                    no:"085/063", rarity:"SR",  lang:"KR", price:19000, hot:true }, // pokesise 인기
  { game:"pokemon", name:"제라오라",        set:"극장판 관람 프로모",     no:"",        rarity:"프로모", lang:"KR", price:16000 }, // pokepolio +128.6%
  { game:"pokemon", name:"메타몽",          set:"Pokémon GO",          no:"",        rarity:"N",   lang:"KR", price:13500 }, // pokepolio +68.8%
  { game:"pokemon", name:"파비코리",        set:"",                    no:"087/076", rarity:"",    lang:"KR", price:12800 }, // pokesise +220%
  { game:"pokemon", name:"꼬부기",          set:"포켓몬 카드 151",       no:"",        rarity:"AR",  lang:"KR", price:10500 }, // pokepolio +110%
  { game:"pokemon", name:"쉐이미 V",        set:"극장판 DP 극장 선물",    no:"",        rarity:"프로모", lang:"KR", price:9500 },  // pokepolio +58.3%
  { game:"pokemon", name:"레파르다스",      set:"",                    no:"135/086", rarity:"",    lang:"KR", price:6900 },  // pokesise +130%
  { game:"pokemon", name:"일레도리자드",    set:"",                    no:"201/193", rarity:"",    lang:"KR", price:6800 },  // pokesise +206.8%
  { game:"pokemon", name:"과미르",          set:"",                    no:"103/101", rarity:"",    lang:"KR", price:5000 },  // pokesise +127.3%
  { game:"pokemon", name:"피카츄",          set:"",                    no:"037/103", rarity:"",    lang:"KR", price:4000 },  // pokesise +166.7%

  // 30th CELEBRATION: 거래는 많지만 발매 뒤 값이 빠지는 중. 매입은 조심
  { game:"pokemon", name:"피카츄 ex",       set:"30th CELEBRATION",    no:"",        rarity:"SAR", lang:"KR", price:27000 }, // pokepolio 26,958원 -51.2%
  { game:"pokemon", name:"뮤츠 ex FUR",     set:"30th CELEBRATION",    no:"",        rarity:"UR",  lang:"KR", price:24100 }, // pokepolio 24,130원 -50.9%
  { game:"pokemon", name:"춤추새 ex",       set:"인페르노X",            no:"",        rarity:"SAR", lang:"KR", price:8500 },  // pokepolio -48%
  { game:"pokemon", name:"팬텀",            set:"30th CELEBRATION",    no:"",        rarity:"UR",  lang:"KR", price:8200 },  // pokepolio -55.7%
  { game:"pokemon", name:"크레세리아&다크라이 LEGEND", set:"30th CELEBRATION", no:"151/103", rarity:"UR", lang:"KR", price:4000 }, // pokepolio 11/23 체결
  { game:"pokemon", name:"유크시",          set:"30th CELEBRATION",    no:"148/103", rarity:"UR",  lang:"KR", price:4000 },  // pokepolio 11/23 체결
  { game:"pokemon", name:"게노세크트 EX",    set:"30th CELEBRATION",    no:"155/103", rarity:"UR",  lang:"KR", price:4000 },  // pokepolio 11/23 체결
  { game:"pokemon", name:"자시안 V",        set:"30th CELEBRATION",    no:"161/103", rarity:"UR",  lang:"KR", price:4000 },  // pokepolio 11/23 체결
  { game:"pokemon", name:"빛나는 세레비",    set:"30th CELEBRATION",    no:"141/103", rarity:"UR",  lang:"KR", price:4000 },  // pokepolio 11/23 체결
];
