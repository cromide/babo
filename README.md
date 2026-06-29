# BABO Exchange 🪙

순수 JavaScript로 만든 **가상 암호화폐 투자 시뮬레이션 게임**.

## 소개
30일 동안 NPC 봇들과 수익률을 겨루는 트레이딩 게임. 실시간 시세 변동,
뉴스 이벤트, 랭킹, 종목 토론방까지 갖춘 단일 페이지 게임입니다.

## 주요 기능
- 6종 코인 + BABO 코인 시세 시뮬레이션 (캔들 차트)
- 6가지 전략의 NPC 봇 AI와 수익률 경쟁
- 12종 뉴스 이벤트가 시장에 실시간 반영
- 매수/매도, 보유 자산, 실시간 랭킹, 토론방

## 기술 스택
- Vanilla JavaScript (게임 로직 ~800줄), HTML5, CSS3
- 외부 라이브러리 없음

## 실행
```bash
# 정적 파일이라 바로 열거나 로컬 서버로 실행
python3 -m http.server 8000
# http://localhost:8000
```

## 파일
- `index.html` · `style.css` · `game.js`
