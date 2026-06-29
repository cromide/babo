/* ============================================================
   BABO Exchange — 가상 투자 시뮬레이션 (랭킹 경쟁 + 채팅)
   하루씩 넘어가며 시장을 시뮬레이션하고, NPC 투자자들과
   수익률 랭킹을 겨룬다. 시즌이 끝나면 우승자와 승자 코인을 공개.
   ============================================================ */

const CONFIG = {
  startCash: 10000,
  maxDay: 30,
  fee: 0.001, // 거래 수수료 0.1%
};

// 코인 정의: 변동성(vol)과 추세 편향(drift)이 코인마다 다르다.
const COIN_DEFS = [
  { sym: "BTC",  name: "비트코인",     price: 42000, vol: 0.04, drift: 0.004 },
  { sym: "ETH",  name: "이더리움",     price: 2300,  vol: 0.05, drift: 0.005 },
  { sym: "BNB",  name: "바이낸스코인", price: 310,   vol: 0.045, drift: 0.003 },
  { sym: "SOL",  name: "솔라나",       price: 95,    vol: 0.08, drift: 0.008 },
  { sym: "XRP",  name: "리플",         price: 0.52,  vol: 0.06, drift: 0.001 },
  { sym: "DOGE", name: "도지코인",     price: 0.08,  vol: 0.11, drift: -0.002 },
  { sym: "BABO", name: "바보코인",     price: 1.0,   vol: 0.15, drift: 0.006 },
];

// 뉴스 이벤트 템플릿. effect = 다음 가격 변동에 더해지는 충격(비율).
const NEWS_POOL = [
  { t: "{C} 대형 거래소 신규 상장 소식!",            effect: +0.18, good: true },
  { t: "{C} 글로벌 결제사와 파트너십 체결",          effect: +0.14, good: true },
  { t: "{C} 네트워크 업그레이드 성공적 완료",        effect: +0.10, good: true },
  { t: "고래 지갑이 {C} 대량 매집 포착",             effect: +0.12, good: true },
  { t: "{C} ETF 승인 기대감 확산",                   effect: +0.16, good: true },
  { t: "유명 인플루언서가 {C} 강력 추천",            effect: +0.08, good: true },
  { t: "{C} 규제 당국 조사 착수 보도",               effect: -0.16, bad: true },
  { t: "{C} 스마트컨트랙트 취약점 발견",             effect: -0.20, bad: true },
  { t: "대형 투자사, {C} 전량 매도 정황",            effect: -0.14, bad: true },
  { t: "{C} 재단 내분설로 투자심리 위축",            effect: -0.10, bad: true },
  { t: "{C} 거래소 출금 일시 중단 논란",             effect: -0.12, bad: true },
  { t: "전반적 약세장, {C} 동반 하락 압력",          effect: -0.07, bad: true },
];

// NPC 투자자 정의 (전략 + 성격)
const BOT_DEFS = [
  { id: "b1", name: "추격매수왕", emoji: "🚀", strat: "momentum",   stratKr: "추세추종" },
  { id: "b2", name: "역발상러",   emoji: "🎯", strat: "contrarian", stratKr: "역추세" },
  { id: "b3", name: "존버형",     emoji: "💎", strat: "hodler",     stratKr: "장기보유" },
  { id: "b4", name: "도박꾼",     emoji: "🎰", strat: "yolo",       stratKr: "올인" },
  { id: "b5", name: "뉴스충",     emoji: "📰", strat: "news",       stratKr: "뉴스매매" },
  { id: "b6", name: "퀀트봇",     emoji: "🤖", strat: "quant",      stratKr: "평균회귀" },
];

let state = null;

/* ---------- 유틸 ---------- */
const $ = (id) => document.getElementById(id);
const fmt = (n, d = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const priceFmt = (p) => (p >= 100 ? fmt(p, 2) : p >= 1 ? fmt(p, 3) : fmt(p, 4));
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ---------- 초기화 ---------- */
// 종가(open→close) 한 쌍으로 캔들 1개를 만든다. 장중 고가/저가 꼬리를 합성.
function makeCandle(open, close, vol) {
  const wick = Math.abs(open) * vol * 0.6;
  const high = Math.max(open, close) + Math.random() * wick;
  const low = Math.min(open, close) - Math.random() * wick;
  return { o: open, h: high, l: Math.max(low, open * 0.001), c: close };
}

// 시작 전 10일치 가짜 과거 캔들을 만들어 차트가 처음부터 보이게 한다.
// 마지막 캔들의 종가는 정의된 시작가(startPrice)와 일치시킨다.
function warmupHistory(c) {
  const past = 10;
  const closes = [c.price];
  let p = c.price;
  for (let i = 0; i < past; i++) {
    p = p / (1 + (c.drift + c.vol * gauss()) * 0.6);
    closes.push(p);
  }
  closes.reverse(); // 과거 → 현재(=시작가)
  const candles = [];
  for (let i = 1; i < closes.length; i++) {
    candles.push(makeCandle(closes[i - 1], closes[i], c.vol));
  }
  return candles;
}

function emptyHoldings() {
  const h = {};
  COIN_DEFS.forEach((c) => (h[c.sym] = { qty: 0, avgCost: 0 }));
  return h;
}

function newGame() {
  state = {
    day: 1,
    selected: COIN_DEFS[0].sym,
    side: "buy",
    coins: COIN_DEFS.map((c) => ({
      ...c,
      startPrice: c.price,
      history: warmupHistory(c), // 과거 시세 일부 + 시작가로 끝맺음
      shock: 0, // 다음날 적용될 뉴스 충격
    })),
    view: { span: null, right: null }, // 차트 줌(span=보이는 캔들 수)/스크롤(right). null=전체보기
    me: { cash: CONFIG.startCash, holdings: emptyHoldings() },
    bots: BOT_DEFS.map((b) => ({
      ...b,
      cash: CONFIG.startCash,
      holdings: emptyHoldings(),
    })),
    news: [{ t: "🔔 새 시즌 시작! 30일간 NPC들과 수익률을 겨루세요.", cls: "" }],
    lastNewsMeta: [], // 봇/채팅이 참고할 [{sym, good}]
    chat: [],
  };
  pushChat("system", null, "📢 시즌 1 개막! 모두 행운을 빕니다.", "c-sys");
  state.bots.forEach((b) =>
    pushChat(b.name, b.emoji, rand(GREETINGS[b.strat]))
  );

  $("endModal").classList.add("hidden");
  $("maxDay").textContent = CONFIG.maxDay;
  $("chatOnline").textContent = `● ${BOT_DEFS.length + 1}명 접속중`;
  render();
}

function getCoin(sym) {
  return state.coins.find((c) => c.sym === sym);
}
function lastCandle(c) {
  return c.history[c.history.length - 1];
}
function curPrice(sym) {
  return lastCandle(getCoin(sym)).c;
}
function dayChange(c) {
  const k = lastCandle(c);
  return ((k.c - k.o) / k.o) * 100; // 그날 캔들의 시가 대비 종가 변동
}

/* ---------- 하루 진행 (시뮬레이션 핵심) ---------- */
function advanceDay() {
  if (state.day >= CONFIG.maxDay) return;

  // 1) 새 뉴스 생성: 1~2개 코인에 충격 부여
  const newsCount = Math.random() < 0.5 ? 1 : 2;
  const newNews = [];
  const newsMeta = [];
  const used = new Set();
  for (let i = 0; i < newsCount; i++) {
    const coin = rand(state.coins);
    if (used.has(coin.sym)) continue;
    used.add(coin.sym);
    const tpl = rand(NEWS_POOL);
    coin.shock += tpl.effect;
    newNews.push({ t: tpl.t.replace("{C}", `${coin.name}(${coin.sym})`), cls: tpl.good ? "up" : "down" });
    newsMeta.push({ sym: coin.sym, good: !!tpl.good });
  }

  // 우측 끝(최신)을 보고 있었는지 기록 → 새 캔들 추가 후 따라가기 위함
  const oldN = state.coins[0].history.length;
  const wasAtRight = state.view.right == null || state.view.right >= oldN;

  // 2) 가격 갱신: 추세 + 랜덤워크 + 뉴스 충격 → 새 캔들 생성
  state.coins.forEach((c) => {
    const open = lastCandle(c).c; // 전일 종가가 오늘 시가
    let pct = c.drift + c.vol * gauss() + c.shock;
    pct = Math.max(-0.6, Math.min(0.6, pct));
    let close = open * (1 + pct);
    if (close < c.startPrice * 0.02) close = c.startPrice * 0.02;
    c.history.push(makeCandle(open, close, c.vol));
    c.shock = 0;
  });

  // 우측 끝을 따라가던 경우 새 캔들로 스크롤
  if (wasAtRight && state.view.right != null) {
    state.view.right = state.coins[0].history.length;
  }

  state.day += 1;
  state.news = newNews.length
    ? newNews
    : [{ t: "특별한 뉴스가 없는 조용한 하루였습니다.", cls: "" }];
  state.lastNewsMeta = newsMeta;

  // 3) NPC들이 전략대로 매매
  state.bots.forEach((b) => runBot(b, newsMeta));

  // 4) 채팅 생성 (시장/뉴스/랭킹 반응)
  generateChat(newsMeta);

  render();

  if (state.day >= CONFIG.maxDay) endGame();
}

/* ---------- 자산 계산 ---------- */
function holdingsValue(holdings) {
  return Object.entries(holdings).reduce((s, [sym, h]) => s + h.qty * curPrice(sym), 0);
}
function netWorthOf(entity) {
  return entity.cash + holdingsValue(entity.holdings);
}
function returnOf(entity) {
  return ((netWorthOf(entity) - CONFIG.startCash) / CONFIG.startCash) * 100;
}

/* ---------- 거래 엔진 (플레이어 + 봇 공용) ---------- */
function execBuy(entity, sym, qty) {
  const price = curPrice(sym);
  const cost = qty * price * (1 + CONFIG.fee);
  if (qty <= 0 || cost > entity.cash + 1e-9) return false;
  const h = entity.holdings[sym];
  const nq = h.qty + qty;
  h.avgCost = (h.avgCost * h.qty + price * qty) / nq;
  h.qty = nq;
  entity.cash -= cost;
  return true;
}
function execSell(entity, sym, qty) {
  const h = entity.holdings[sym];
  if (qty <= 0 || qty > h.qty + 1e-9) return false;
  entity.cash += qty * curPrice(sym) * (1 - CONFIG.fee);
  h.qty -= qty;
  if (h.qty < 1e-9) { h.qty = 0; h.avgCost = 0; }
  return true;
}

/* ---------- 플레이어 주문 ---------- */
function trade() {
  const sym = state.selected;
  const qty = parseFloat($("qtyInput").value);
  if (!qty || qty <= 0) return toast("수량을 입력하세요.", "err");

  if (state.side === "buy") {
    if (!execBuy(state.me, sym, qty)) return toast("현금이 부족합니다.", "err");
    toast(`${sym} ${fmt(qty, 4)}개 매수 완료`, "ok");
  } else {
    if (!execSell(state.me, sym, qty)) return toast("보유 수량이 부족합니다.", "err");
    toast(`${sym} ${fmt(qty, 4)}개 매도 완료`, "ok");
  }
  $("qtyInput").value = "";
  render();
}

/* ---------- NPC 전략 ---------- */
function buyFrac(bot, sym, frac) {
  const budget = bot.cash * frac;
  const qty = budget / (curPrice(sym) * (1 + CONFIG.fee));
  if (qty > 0) execBuy(bot, sym, qty);
}
function sellFrac(bot, sym, frac) {
  const h = bot.holdings[sym];
  if (h.qty > 0) execSell(bot, sym, h.qty * frac);
}
function movingAvg(c, n) {
  const hist = c.history.slice(-n);
  return hist.reduce((a, k) => a + k.c, 0) / hist.length;
}

function runBot(bot, newsMeta) {
  const coins = state.coins;
  switch (bot.strat) {
    case "momentum": {
      // 어제 가장 많이 오른 코인을 추격 매수, 떨어진 보유분은 정리
      const sorted = [...coins].sort((a, b) => dayChange(b) - dayChange(a));
      const top = sorted[0];
      if (dayChange(top) > 0 && bot.cash > 100) buyFrac(bot, top.sym, 0.5);
      coins.forEach((c) => { if (dayChange(c) < -4) sellFrac(bot, c.sym, 0.7); });
      break;
    }
    case "contrarian": {
      // 가장 많이 빠진 코인을 줍줍, 많이 오른 보유분은 익절
      const sorted = [...coins].sort((a, b) => dayChange(a) - dayChange(b));
      const bottom = sorted[0];
      if (dayChange(bottom) < 0 && bot.cash > 100) buyFrac(bot, bottom.sym, 0.4);
      coins.forEach((c) => { if (dayChange(c) > 8) sellFrac(bot, c.sym, 0.5); });
      break;
    }
    case "hodler": {
      // 초반에 BTC/ETH 매집 후 거의 존버
      if (state.day <= 4) {
        buyFrac(bot, "BTC", 0.45);
        buyFrac(bot, "ETH", 0.55);
      } else if (Math.random() < 0.1) {
        buyFrac(bot, rand(["BTC", "ETH"]), 0.3);
      }
      break;
    }
    case "yolo": {
      // 전 재산 한 코인에 올인했다가 다음날 전량 매도 반복
      const held = Object.entries(bot.holdings).filter(([, h]) => h.qty > 0);
      if (held.length) held.forEach(([sym]) => sellFrac(bot, sym, 1));
      if (bot.cash > 100) buyFrac(bot, rand(coins).sym, 0.95);
      break;
    }
    case "news": {
      // 호재 코인 매수, 악재면 보유분 손절
      newsMeta.forEach((n) => {
        if (n.good && bot.cash > 100) buyFrac(bot, n.sym, 0.5);
        else if (!n.good) sellFrac(bot, n.sym, 1);
      });
      if (!newsMeta.length && bot.cash > 100 && Math.random() < 0.3)
        buyFrac(bot, rand(coins).sym, 0.3);
      break;
    }
    case "quant": {
      // 5일 이동평균 대비 저평가 매수 / 고평가 매도
      coins.forEach((c) => {
        if (c.history.length < 3) return;
        const ma = movingAvg(c, 5);
        const p = curPrice(c.sym);
        if (p < ma * 0.95 && bot.cash > 100) buyFrac(bot, c.sym, 0.25);
        else if (p > ma * 1.08) sellFrac(bot, c.sym, 0.5);
      });
      break;
    }
  }
}

/* ---------- 채팅 (트롤박스) ---------- */
function pushChat(who, emoji, text, cls = "") {
  state.chat.push({ who, emoji, text, cls });
  if (state.chat.length > 60) state.chat.shift();
}

function generateChat(newsMeta) {
  // 랭킹 계산해서 1등은 자랑, 꼴찌는 자책
  const board = leaderboardData();
  const leader = board[0];
  const loser = board[board.length - 1];

  // 1) 뉴스 반응
  newsMeta.forEach((n) => {
    if (Math.random() < 0.85) {
      const bot = rand(state.bots);
      const coin = getCoin(n.sym);
      const pool = n.good ? CHAT_GOOD : CHAT_BAD;
      pushChat(bot.name, bot.emoji, rand(pool).replace("{C}", coin.sym));
    }
  });

  // 2) 랭킹 트래시토크 (봇이 1등이면 자랑)
  if (leader.kind === "bot" && Math.random() < 0.6) {
    pushChat(leader.name, leader.emoji, rand(CHAT_BRAG).replace("{R}", fmt(leader.ret) + "%"));
  }
  if (loser.kind === "bot" && Math.random() < 0.4) {
    pushChat(loser.name, loser.emoji, rand(CHAT_DOWN));
  }

  // 3) 가장 급등한 코인 잡담
  const hot = [...state.coins].sort((a, b) => dayChange(b) - dayChange(a))[0];
  if (dayChange(hot) > 6 && Math.random() < 0.7) {
    const bot = rand(state.bots);
    pushChat(bot.name, bot.emoji, rand(CHAT_PUMP).replace("{C}", hot.sym));
  }

  // 4) 가벼운 잡담
  if (Math.random() < 0.5) {
    const bot = rand(state.bots);
    pushChat(bot.name, bot.emoji, rand(CHAT_SMALL));
  }
}

function sendChat() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text) return;
  pushChat("나", "🧑", text, "c-me");
  input.value = "";
  renderChat();
  // 봇이 가끔 반응
  if (Math.random() < 0.7) {
    const bot = rand(state.bots);
    setTimeout(() => {
      pushChat(bot.name, bot.emoji, rand(CHAT_REPLY));
      renderChat();
    }, 600 + Math.random() * 900);
  }
}

/* ---------- 채팅 문구 풀 ---------- */
const GREETINGS = {
  momentum: ["가즈아! 오르는 놈만 탑니다 🚀", "추세는 친구다."],
  contrarian: ["남들 팔 때 삽니다 🎯", "공포에 사라 했죠."],
  hodler: ["나는 그냥 존버합니다 💎🙌", "10년 보고 갑니다."],
  yolo: ["인생은 한방 🎰", "분산투자? 그게 뭐죠?"],
  news: ["뉴스가 곧 돈이다 📰", "속보 뜨면 바로 들어갑니다."],
  quant: ["감정 빼고 데이터로 갑니다 🤖", "평균회귀를 믿습니다."],
};
const CHAT_GOOD = ["{C} 호재 떴다! 풀매수 간다 🔥", "{C} 이거 가는거 아님? 👀", "{C} 지금이라도 타야하나", "{C} 가즈아아아"];
const CHAT_BAD = ["{C} 악재네… 손절각", "{C} 던지고 나왔습니다 😇", "{C} 물린 사람 손?", "{C} 이거 더 빠진다에 한표"];
const CHAT_PUMP = ["{C} 떡상 미쳤다 🚀🚀", "{C} 안 산 사람 벼락거지각", "{C} 이게 오르네 ㄷㄷ", "{C} 풀매수 안한거 후회중"];
const CHAT_BRAG = ["수익률 {R} 찍었습니다 ㅎㅎ", "역시 내 전략이 맞았어 {R} 📈", "1등 자리 사수중 {R}", "다들 내 종목 따라오세요 {R}"];
const CHAT_DOWN = ["아 또 물렸다…", "내 계좌 녹는중 🫠", "이 게임 접어야하나", "분명 오른다 했는데…"];
const CHAT_SMALL = ["오늘 장 변동성 쩌네", "다들 뭐 들고있음?", "존버가 답일까…", "익절은 언제나 옳다", "내일 반등 가즈아", "차트만 보면 멀미남 🤢", "이게 투자냐 도박이지"];
const CHAT_REPLY = ["ㅇㅈ ㅋㅋ", "그건 좀 위험한데요", "오 좋은 픽이네요", "저도 그렇게 봅니다", "글쎄요… 전 반댄데", "ㄴㄴ 그건 물림각", "님 수익률부터 인증 ㅋ"];

/* ---------- 랭킹 데이터 ---------- */
function leaderboardData() {
  const rows = [
    { kind: "me", name: "나 (당신)", emoji: "🧑", stratKr: "직접 매매", nw: netWorthOf(state.me), ret: returnOf(state.me) },
    ...state.bots.map((b) => ({
      kind: "bot", name: b.name, emoji: b.emoji, stratKr: b.stratKr,
      nw: netWorthOf(b), ret: returnOf(b),
    })),
  ];
  return rows.sort((a, b) => b.nw - a.nw);
}

/* ---------- 렌더링 ---------- */
function render() {
  $("dayCount").textContent = state.day;
  $("cash").textContent = fmt(state.me.cash);
  const nw = netWorthOf(state.me);
  $("netWorth").textContent = fmt(nw);
  const ret = returnOf(state.me);
  const retEl = $("totalReturn");
  retEl.textContent = (ret >= 0 ? "+" : "") + fmt(ret) + "%";
  retEl.className = "stat-value " + (ret >= 0 ? "up" : "down");

  renderMarket();
  renderChart();
  renderTrade();
  renderHoldings();
  renderNews();
  renderLeaderboard();
  renderChat();

  $("nextDayBtn").textContent = state.day >= CONFIG.maxDay ? "시즌 종료" : "다음 날 ▶";
  $("nextDayBtn").disabled = state.day >= CONFIG.maxDay;
}

function renderMarket() {
  const ul = $("marketList");
  ul.innerHTML = "";
  state.coins.forEach((c) => {
    const chg = dayChange(c);
    const li = document.createElement("li");
    if (c.sym === state.selected) li.classList.add("active");
    li.innerHTML = `
      <span class="coin-id"><span class="coin-sym">${c.sym}</span><span class="coin-nm">${c.name}</span></span>
      <span class="coin-price">${priceFmt(curPrice(c.sym))}</span>
      <span class="coin-chg ${chg >= 0 ? "up" : "down"}">${chg >= 0 ? "+" : ""}${fmt(chg)}%</span>`;
    li.onclick = () => { state.selected = c.sym; render(); };
    ul.appendChild(li);
  });
}

function renderLeaderboard() {
  const ul = $("leaderboard");
  ul.innerHTML = "";
  leaderboardData().forEach((r, i) => {
    const li = document.createElement("li");
    if (r.kind === "me") li.classList.add("is-me");
    li.innerHTML = `
      <span class="lb-rank ${i < 3 ? "top" : ""}">${i + 1}</span>
      <span class="lb-name"><span class="nm">${r.emoji} ${r.name}</span><span class="strat">${r.stratKr}</span></span>
      <span class="lb-val"><span class="nw">${fmt(r.nw)}</span><br><span class="ret ${r.ret >= 0 ? "up" : "down"}">${r.ret >= 0 ? "+" : ""}${fmt(r.ret)}%</span></span>`;
    ul.appendChild(li);
  });
}

function renderChat() {
  const ul = $("chatList");
  ul.innerHTML = "";
  state.chat.forEach((m) => {
    const li = document.createElement("li");
    li.className = m.cls || "";
    if (m.cls === "c-sys") li.textContent = m.text;
    else li.innerHTML = `<span class="c-who">${m.emoji || ""} ${m.who}:</span> ${escapeHtml(m.text)}`;
    ul.appendChild(li);
  });
  ul.scrollTop = ul.scrollHeight;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTrade() {
  const sym = state.selected;
  $("tradeSymbol").textContent = sym;
  $("chartSymbol").textContent = sym;
  $("chartName").textContent = getCoin(sym).name;
  $("chartPrice").textContent = priceFmt(curPrice(sym));
  const chg = dayChange(getCoin(sym));
  const cc = $("chartChange");
  cc.textContent = (chg >= 0 ? "+" : "") + fmt(chg) + "%";
  cc.className = "chart-change " + (chg >= 0 ? "up" : "down");

  $("orderAvail").textContent =
    state.side === "buy"
      ? `${fmt(state.me.cash)} USDT`
      : `${fmt(state.me.holdings[sym].qty, 4)} ${sym}`;
  updateOrderTotal();
}

function updateOrderTotal() {
  const qty = parseFloat($("qtyInput").value) || 0;
  $("orderTotal").textContent = fmt(qty * curPrice(state.selected)) + " USDT";
}

function renderHoldings() {
  const ul = $("holdingsList");
  ul.innerHTML = "";
  const owned = Object.entries(state.me.holdings).filter(([, h]) => h.qty > 1e-9);
  if (!owned.length) {
    ul.innerHTML = `<li class="empty">보유 중인 코인이 없습니다.</li>`;
    return;
  }
  owned.forEach(([sym, h]) => {
    const price = curPrice(sym);
    const value = h.qty * price;
    const pnl = (price - h.avgCost) * h.qty;
    const pnlPct = h.avgCost ? ((price - h.avgCost) / h.avgCost) * 100 : 0;
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="hold-top"><span>${sym}</span><span>${fmt(value)} USDT</span></div>
      <div class="hold-bot">
        <span>${fmt(h.qty, 4)} @ ${priceFmt(h.avgCost)}</span>
        <span class="${pnl >= 0 ? "up" : "down"}">${pnl >= 0 ? "+" : ""}${fmt(pnl)} (${fmt(pnlPct)}%)</span>
      </div>`;
    ul.appendChild(li);
  });
}

function renderNews() {
  const ul = $("newsList");
  ul.innerHTML = "";
  state.news.forEach((n) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="tag ${n.cls}">${
      n.cls === "up" ? "▲ 호재" : n.cls === "down" ? "▼ 악재" : "•"
    }</span> ${n.t}`;
    ul.appendChild(li);
  });
}

/* ---------- 차트 ---------- */
function renderChart() {
  const canvas = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) {
    // 레이아웃이 아직 잡히지 않음 → 다음 프레임에 다시 그린다
    requestAnimationFrame(renderChart);
    return;
  }
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const full = getCoin(state.selected).history; // 전체 캔들 {o,h,l,c}
  const N = full.length;
  // 보이는 구간 계산 (줌/스크롤)
  let span = state.view.span == null ? N : state.view.span;
  span = Math.max(5, Math.min(N, span));
  let right = state.view.right == null ? N : state.view.right;
  right = Math.max(span, Math.min(N, right));
  const data = full.slice(right - span, right);
  const pad = { l: 8, r: 64, t: 16, b: 8 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  const max = Math.max(...data.map((k) => k.h));
  const min = Math.min(...data.map((k) => k.l));
  const range = max - min || max || 1;
  const yOf = (v) => pad.t + plotH - ((v - min) / range) * plotH;

  // 캔들 폭/간격
  const n = data.length;
  const slot = plotW / n;
  const bw = Math.max(2, Math.min(14, slot * 0.62)); // 몸통 폭
  const xCenter = (i) => pad.l + slot * (i + 0.5);

  // 그리드 + 가격 라벨
  ctx.strokeStyle = "#2b3139";
  ctx.fillStyle = "#848e9c";
  ctx.font = "10px sans-serif";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (plotH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillText(priceFmt(max - (range * g) / 4), pad.l + plotW + 6, y + 3);
  }

  const GREEN = "#2ebd85", RED = "#f6465d";

  // 캔들 그리기
  data.forEach((k, i) => {
    const up = k.c >= k.o;
    const color = up ? GREEN : RED;
    const cx = xCenter(i);

    // 심지 (고가~저가)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, yOf(k.h));
    ctx.lineTo(cx, yOf(k.l));
    ctx.stroke();

    // 몸통 (시가~종가)
    const yo = yOf(k.o), yc = yOf(k.c);
    const top = Math.min(yo, yc);
    const bodyH = Math.max(1, Math.abs(yc - yo));
    ctx.fillStyle = color;
    ctx.fillRect(cx - bw / 2, top, bw, bodyH);
  });

  // 현재가 점선 라인
  const lastC = data[data.length - 1].c;
  const ly = yOf(lastC);
  ctx.strokeStyle = "rgba(240,185,11,.6)";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.l, ly);
  ctx.lineTo(pad.l + plotW, ly);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#f0b90b";
  ctx.fillRect(pad.l + plotW, ly - 7, pad.r, 14);
  ctx.fillStyle = "#0b0e11";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText(priceFmt(lastC), pad.l + plotW + 5, ly + 3);
}

/* ---------- 게임 종료 ---------- */
function endGame() {
  // 투자자 최종 순위
  const board = leaderboardData();
  const myIdx = board.findIndex((r) => r.kind === "me");

  // 승자 코인
  const coinRanked = state.coins
    .map((c) => ({ sym: c.sym, name: c.name, ret: ((curPrice(c.sym) - c.startPrice) / c.startPrice) * 100 }))
    .sort((a, b) => b.ret - a.ret);
  const winnerCoin = coinRanked[0];

  $("winnerSymbol").textContent = `${winnerCoin.sym} (${winnerCoin.name})`;
  const wr = $("winnerReturn");
  wr.textContent = `${winnerCoin.ret >= 0 ? "+" : ""}${fmt(winnerCoin.ret)}%`;
  wr.className = "winner-return " + (winnerCoin.ret >= 0 ? "up" : "down");

  const myRet = returnOf(state.me);
  $("finalNet").textContent = fmt(netWorthOf(state.me));
  const fr = $("finalReturn");
  fr.textContent = (myRet >= 0 ? "+" : "") + fmt(myRet) + "%";
  fr.className = myRet >= 0 ? "up" : "down";
  $("finalRank").textContent = `${myIdx + 1}위 / ${board.length}명`;

  // 투자자 랭킹 표
  const pr = $("playerRanking");
  pr.innerHTML = `<div class="rank-row" style="border:none;color:#848e9c"><span class="rk">#</span><span>최종 투자자 순위</span><span></span></div>`;
  board.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    if (r.kind === "me") row.style.background = "rgba(240,185,11,.10)";
    row.innerHTML = `
      <span class="rk">${i === 0 ? "👑" : i + 1}</span>
      <span>${r.emoji} ${r.name}</span>
      <span class="${r.ret >= 0 ? "up" : "down"}">${r.ret >= 0 ? "+" : ""}${fmt(r.ret)}%</span>`;
    pr.appendChild(row);
  });

  // 코인 랭킹 표
  const rk = $("coinRanking");
  rk.innerHTML = `<div class="rank-row" style="border:none;color:#848e9c"><span class="rk">#</span><span>코인별 시즌 수익률</span><span></span></div>`;
  coinRanked.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <span class="rk">${i + 1}</span>
      <span>${c.sym} · ${c.name}</span>
      <span class="${c.ret >= 0 ? "up" : "down"}">${c.ret >= 0 ? "+" : ""}${fmt(c.ret)}%</span>`;
    rk.appendChild(row);
  });

  // 종료 멘트
  const champ = board[0];
  $("endModal").querySelector("h2").textContent =
    champ.kind === "me" ? "🎉 우승! 당신이 1등입니다!" : `🏁 시즌 종료 — 우승자: ${champ.emoji} ${champ.name}`;

  $("endModal").classList.remove("hidden");
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, cls = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + cls;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
}

/* ---------- 이벤트 바인딩 ---------- */
$("nextDayBtn").onclick = advanceDay;
$("resetBtn").onclick = () => {
  if (confirm("새 게임을 시작할까요? 현재 진행 상황이 사라집니다.")) newGame();
};
$("playAgain").onclick = newGame;
$("submitOrder").onclick = trade;
$("qtyInput").oninput = updateOrderTotal;
$("chatSend").onclick = sendChat;
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    state.side = tab.dataset.side;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const btn = $("submitOrder");
    if (state.side === "buy") { btn.textContent = "매수"; btn.className = "btn btn-submit btn-buy"; }
    else { btn.textContent = "매도"; btn.className = "btn btn-submit btn-sell"; }
    $("qtyInput").value = "";
    renderTrade();
  };
});

document.querySelectorAll(".pct").forEach((b) => {
  b.onclick = () => {
    const pct = parseFloat(b.dataset.pct);
    const sym = state.selected;
    const price = curPrice(sym);
    if (state.side === "buy") {
      $("qtyInput").value = ((state.me.cash * pct) / (1 + CONFIG.fee) / price).toFixed(4);
    } else {
      $("qtyInput").value = (state.me.holdings[sym].qty * pct).toFixed(4);
    }
    updateOrderTotal();
  };
});

/* ---------- 차트 줌 / 스크롤 ---------- */
function chartN() {
  return state.coins[0].history.length;
}
function curSpan() {
  const N = chartN();
  return Math.max(5, Math.min(N, state.view.span == null ? N : state.view.span));
}
function curRight() {
  const N = chartN();
  const span = curSpan();
  return Math.max(span, Math.min(N, state.view.right == null ? N : state.view.right));
}
function zoom(factor) {
  const N = chartN();
  const right = curRight();
  let span = Math.round(curSpan() * factor);
  span = Math.max(5, Math.min(N, span));
  state.view.span = span;
  state.view.right = Math.max(span, Math.min(N, right));
  renderChart();
}

const chartCanvas = $("chart");
chartCanvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoom(e.deltaY < 0 ? 0.82 : 1.22); // 휠 업=확대, 다운=축소
}, { passive: false });

// 드래그로 좌우 스크롤
let drag = null;
chartCanvas.addEventListener("mousedown", (e) => {
  drag = { x: e.clientX, right: curRight(), span: curSpan() };
  chartCanvas.classList.add("dragging");
});
window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  const N = chartN();
  const plotW = chartCanvas.clientWidth - 72; // pad.l+pad.r 근사
  const perCandle = plotW / drag.span;
  const moved = Math.round((e.clientX - drag.x) / perCandle); // 오른쪽 드래그=과거로
  let right = drag.right - moved;
  right = Math.max(drag.span, Math.min(N, right));
  if (right !== curRight()) {
    state.view.span = drag.span;
    state.view.right = right;
    renderChart();
  }
});
window.addEventListener("mouseup", () => {
  drag = null;
  chartCanvas.classList.remove("dragging");
});
// 더블클릭 = 전체보기
chartCanvas.addEventListener("dblclick", () => {
  state.view.span = null;
  state.view.right = null;
  renderChart();
});

document.querySelectorAll(".chart-tools button").forEach((b) => {
  b.onclick = () => {
    const a = b.dataset.zoom;
    if (a === "in") zoom(0.7);
    else if (a === "out") zoom(1.43);
    else { state.view.span = null; state.view.right = null; renderChart(); }
  };
});

window.addEventListener("resize", () => state && renderChart());

newGame();
