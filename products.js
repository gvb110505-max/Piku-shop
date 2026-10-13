/* PIKU 상품 데이터 — index.html, product.html 공용 */

/* ▼ 인스타그램 아이디 — 여기만 바꾸면 사이트 전체에 적용됨 (@ 빼고 입력) */
const INSTA_ID = "piku.shop";

/* ============================================================
   상품 등록소 — 이름 없이 번호로만 관리
   no: 상품 번호 / season: "winter" "spring" "summer" "fall"
   img: 대표 사진 파일명 ("" 비워두면 placeholder)
   ---- 상세페이지(product.html?no=번호)에 쓰이는 항목 ----
   imgs: 추가 사진들 ["13-2.jpg","13-3.jpg"]
   sizes: 사이즈 ("FREE" / "S, M, L" 등)
   fabric: 소재 ("cotton 100%" 등)
   desc: 상품 설명 (줄바꿈은 \n)
   ============================================================ */
const products = [
  // ---- 겨울 (12~3월) ----
  {no:1,  type:"Outer",  price:59000, season:"winter", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:2,  type:"Outer",  price:89000, season:"winter", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:3,  type:"Top",    price:42000, season:"winter", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:4,  type:"Bottom", price:45000, season:"winter", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},

  // ---- 봄 (4~6월) ----
  {no:5,  type:"Outer",  price:55000, season:"spring", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:6,  type:"Top",    price:38000, season:"spring", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:7,  type:"Bottom", price:43000, season:"spring", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:8,  type:"Top",    price:41000, season:"spring", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},

  // ---- 여름 (7~9월) ----
  {no:9,  type:"Top",    price:29000, season:"summer", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:10, type:"Bottom", price:36000, season:"summer", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:11, type:"Top",    price:25000, season:"summer", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:12, type:"Bottom", price:33000, season:"summer", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},

  // ---- 가을 (10~11월) ----
  {no:13, type:"Outer",  price:69000, season:"fall", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:14, type:"Top",    price:42000, season:"fall", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:15, type:"Bottom", price:45000, season:"fall", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
  {no:16, type:"Bottom", price:47000, season:"fall", img:"", imgs:[], sizes:"FREE", fabric:"", desc:""},
];

/* ---------- 공용 도우미 ---------- */
const KO = {winter:"겨울", spring:"봄", summer:"여름", fall:"가을"};
const EN = {winter:"WINTER", spring:"SPRING", summer:"SUMMER", fall:"FALL"};
const won = n => "₩" + n.toLocaleString("ko-KR");
const noStr = n => "NO." + String(n).padStart(2,"0");
const INSTA_URL = "https://instagram.com/" + INSTA_ID;
const detailUrl = no => "product.html?no=" + no;
