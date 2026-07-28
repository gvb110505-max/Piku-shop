// 토스페이먼츠 결제 승인 서버 (Vercel Serverless Function)
// 시크릿 키는 절대 코드에 쓰지 말고 Vercel 환경변수 TOSS_SECRET_KEY에 넣을 것

// ★ 가격표 — index.html의 products와 반드시 같게 유지할 것 (금액 위조 방지용)
const PRICES = {
  1:59000, 2:89000, 3:42000, 4:45000,
  5:55000, 6:38000, 7:43000, 8:41000,
  9:29000, 10:36000, 11:25000, 12:33000,
  13:69000, 14:42000, 15:45000, 16:47000,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { paymentKey, orderId, amount, items } = req.body || {};
  if (!paymentKey || !orderId || !amount) {
    return res.status(400).json({ message: "필수 값 누락" });
  }

  // 1) 서버에서 금액 재계산 → 클라이언트가 보낸 금액과 대조 (조작 방지)
  try {
    const cart = JSON.parse(Buffer.from(decodeURIComponent(items), "base64").toString());
    const real = cart.reduce((s, c) => s + (PRICES[c.no] || 0) * c.q, 0);
    if (real !== amount || real <= 0) {
      return res.status(400).json({ message: "금액 검증 실패" });
    }
  } catch {
    return res.status(400).json({ message: "주문 정보 오류" });
  }

  // 2) 토스페이먼츠 승인 요청
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ message: "서버 키 미설정 (TOSS_SECRET_KEY)" });

  const auth = Buffer.from(secretKey + ":").toString("base64");
  const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const data = await tossRes.json();
  if (!tossRes.ok) {
    return res.status(tossRes.status).json({ message: data.message || "승인 실패" });
  }

  // 3) 성공 — 여기서 주문을 기록하고 싶으면 이 지점에서 저장 (지금은 토스 대시보드에서 확인)
  return res.status(200).json({
    orderId: data.orderId,
    orderName: data.orderName,
    totalAmount: data.totalAmount,
    approvedAt: data.approvedAt,
  });
}
