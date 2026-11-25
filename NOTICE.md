# 저작권 및 라이선스 고지

My Pick — 방 번호로 모여 함께 고르는 서비스
Copyright (C) 2026 이명균 (Lee Myunggyun), hatility (하틸리티)

이 프로그램은 자유 소프트웨어입니다. [GNU Affero General Public License 3.0](LICENSE)(이하 AGPL-3.0)
또는 그 이후 버전의 조건에 따라 누구나 사용 · 수정 · 재배포할 수 있습니다. 이 프로그램은 유용하게 쓰이길 바라며
배포하지만, 상품성이나 특정 목적 적합성에 대한 묵시적 보증을 포함해 **어떤 보증도 하지 않습니다**.

AGPL-3.0 은 이 프로그램을 고쳐서 네트워크로 서비스하는 사람에게도, 그 서비스를 쓰는 사람이 고친 소스를
받을 수 있게 할 의무를 지웁니다. 서비스 첫 화면 아래쪽에 소스 주소를 보여 주는 자리가 있습니다 (`.env` 의 `SOURCE_URL`).

## 저작권자 예외

아래 저작권자는 AGPL-3.0의 의무(소스 공개, 같은 라이선스 유지 등)에 구속되지 않습니다.
저작권자는 이 프로그램과 그 수정본을 AGPL-3.0 이외의 조건으로 사용 · 수정 · 배포 · 서비스하거나
다른 라이선스로 제공할 수 있습니다.

| 저작권자 | GitHub |
|---|---|
| 이명균 | [@aodrha03](https://github.com/aodrha03) |
| hatility (하틸리티) | [@hatility](https://github.com/hatility) |

이 예외는 위 저작권자에게만 적용됩니다. 그 밖의 모든 사람에게는 AGPL-3.0 전문이 그대로 적용됩니다.

## 기여

이 저장소에 코드 · 문서 등을 기여하면, 기여한 내용을 AGPL-3.0으로 제공하는 것과 함께
위 저작권자가 그 내용을 위 예외와 같은 조건으로 사용 · 재라이선스하는 것에 동의하는 것으로 봅니다.

## 함께 쓴 것

| 이름 | 쓰는 곳 | 라이선스 |
|---|---|---|
| React · React DOM | 화면 | MIT |
| lucide-react | 관리자 · 방장 화면, 큰 화면 아이콘 | ISC |
| qrcode-generator | 큰 화면의 입장 QR | MIT |
| Vite · TypeScript | 빌드 · 검사 | MIT · Apache-2.0 |
| playwright-core | 화면 자동 시험 (개발할 때만) | Apache-2.0 |
| Node.js (Docker 이미지 node:24-alpine, 내장 SQLite) | 서버 · 저장 | MIT |
| Caddy (Docker 이미지 caddy:2-alpine) | HTTPS 로 띄울 때만 (`docker-compose.https.yml`) | Apache-2.0 |
| Claude (Anthropic) | AI 도움 — 코드 · 글 초안, 화면 · 보안 점검. 기획 · 검토 · 최종 결정은 만든 사람 | — |

| Pretendard | 글꼴 (`public/fonts/pretendard/`, 필요한 조각만 받아요) | SIL OFL 1.1 (`public/fonts/pretendard/OFL.txt`) |

글꼴도 이 사이트 안에 있어요. 바깥 서버에서 불러오는 것은 없어요.

## AI 활용

이 서비스는 AI(Claude)의 도움을 받아 만들었어요. 무엇을 만들지 정하고, 살펴 고르고, 내보낼지 결정하는 일과 그 책임은 만든 사람에게 있어요. 서비스는 투표자의 정보를 AI 에 보내지 않아요.
