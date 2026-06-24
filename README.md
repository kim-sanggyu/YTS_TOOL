# YTS Tool

연말정산 시스템 개발·운영에 필요한 도구를 모아둔 내부 웹 포털입니다.

## 기술 스택

- **Next.js 16** (App Router, Turbopack) + TypeScript
- **Tailwind CSS** + shadcn/ui
- **NextAuth.js v5** — credentials 로그인, JWT 세션
- **oracledb v6.10.0** — v7은 Instant Client 11.2와 호환 안 됨, 버전 고정 필수
- Oracle Instant Client 11.2 (64비트)

## 사전 요구사항

### Oracle Instant Client 설치

oracledb 네이티브 모듈 실행에 필요합니다.

1. [Oracle Instant Client 11.2 (64비트)](https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html) 다운로드
2. `D:/tools/instantclient_11_2` 에 압축 해제
3. 해당 경로를 시스템 환경변수 `PATH`에 추가

> 경로를 변경할 경우 `next.config.ts`의 `ORACLE_CLIENT_PATH` 설정도 함께 수정해야 합니다.

## 설치

```bash
npm install
```

## 환경변수 설정

프로젝트 루트에 `.env.local` 파일을 생성합니다. (`.env`가 아님에 주의)

```env
# NextAuth
AUTH_SECRET=

# 연말정산시스템 DB (ytsDb)
YTS_DB_USER=
YTS_DB_PASSWORD=
YTS_DB_HOST=
YTS_DB_PORT=
YTS_DB_SID=

# 연말정산지원시스템 DB (yttsDb)
YTTS_DB_USER=
YTTS_DB_PASSWORD=
YTTS_DB_HOST=
YTTS_DB_PORT=
YTTS_DB_SID=
```

> 각 항목의 실제 값은 별도로 전달받은 `.env.local` 파일을 그대로 사용하세요.

## 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속

## 주요 화면

| 경로 | 설명 |
|------|------|
| `/login` | 로그인 |
| `/` | 대시보드 |
| `/tools/hwp-layout` | HWP 레이아웃 업로드 |
| `/tools/java-layout` | Java 소스 업로드 |
| `/tools/media-layout` | 전산매체 Java 소스 생성 |
