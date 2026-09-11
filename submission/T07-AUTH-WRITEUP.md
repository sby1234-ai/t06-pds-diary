# 과제 7 — 인증 구현 설명서

**결과물**: https://sby1234-ai.github.io/t06-pds-diary/ (첫 화면 = 로그인 화면, 계정 생성 없이도 이 화면까지는 열림)
**소스**: https://github.com/sby1234-ai/t06-pds-diary
**이어서 사용한 과제6 결과**: 같은 저장소를 그대로 이어서 사용함(새 저장소를 만들지 않음). 과제6 최종 결과물 주소는 동일하게 `https://sby1234-ai.github.io/t06-pds-diary/`이며, 과제7의 커밋들은 과제6 최종 커밋(`717d2db` "프론트엔드... 검증 테스트 19/19 통과" 이후 계열)을 조상으로 그대로 포함한다.

---

## ① 무엇으로 붙였나

**Supabase Auth (GoTrue)** — 이미 과제6에서 데이터베이스로 쓰고 있던 Supabase가 함께 제공하는 인증 서비스를 그대로 이어 붙였다. 이메일+비밀번호 방식.

- 클라이언트 라이브러리: `@supabase/supabase-js` **버전 2.116.0** (jsdelivr CDN에서 `@2` 태그가 가리키는 버전을 확인 후 그 정확한 버전으로 고정해서 import — `scripts/db.mjs` 1번째 줄)
- 서버 쪽 인증 서비스: Supabase가 관리형으로 운영하는 GoTrue (버전은 Supabase 플랫폼이 관리하며 사용자가 직접 지정하지 않음)

## ② 왜 그걸 골랐나

함께 검토했지만 고르지 않은 방법 두 가지와 이유:

1. **직접 구현(자체 bcrypt + JWT 발급)** — 고르지 않은 이유: 비밀번호 저장·세션 발급·만료·무효화를 전부 직접 짜면 실수 하나가 바로 보안 사고로 이어지는데, 이미 검증된 구현을 안 쓸 이유가 없었다.
2. **별도 인증 서비스(Auth0, Clerk 등)** — 고르지 않은 이유: 이미 Supabase를 DB로 쓰고 있어서, 다른 인증 서비스를 더하면 관리 지점이 하나 늘고 RLS의 `auth.uid()`처럼 DB 정책과 매끄럽게 연결되는 이점을 놓치게 된다.

Supabase Auth를 고른 이유: 같은 플랫폼 안에서 인증과 데이터베이스 권한(RLS)이 `auth.uid()` 하나로 바로 연결되어, "로그인한 사람 것만 보인다"를 데이터베이스 레벨에서 강제할 수 있었다.

## ③ 어디를 어떻게 고쳤나

가입·로그인·로그아웃·자료 조회 네 흐름이 지나는 소스 위치:

| 흐름 | 파일 · 위치 |
|---|---|
| 가입 | `scripts/db.mjs` `signUp()` (내부적으로 `supabase.auth.signUp`) → `scripts/app.mjs`의 `#signupForm` submit 핸들러 |
| 로그인 | `scripts/db.mjs` `signIn()` (`supabase.auth.signInWithPassword`) → `scripts/app.mjs`의 `#loginForm` submit 핸들러 |
| 로그아웃 | `scripts/db.mjs` `signOut()` (`supabase.auth.signOut`) → `scripts/app.mjs`의 `#logoutBtn` 클릭 핸들러 |
| 자료 조회 게이트 | `scripts/app.mjs`의 `getSession()`/`onAuthStateChange()` 리스너 → 세션이 없으면 `showAuthScreen()`, 있으면 `showAppFor()`가 `index.html`의 `#authScreen`/`#appRoot`를 서로 바꿔 보여줌 |
| 자료 조회 실제 차단 | `supabase/schema-v2-auth.sql` — 5개 테이블(`plans`,`plan_history`,`todos`,`do_records`,`retrospectives`)에 `user_id` 컬럼 추가(기본값 `auth.uid()`), `owner_select_*`/`owner_insert_*`/`owner_update_*`/`owner_delete_*` RLS 정책이 전부 `auth.uid() = user_id and public.current_session_valid()`를 요구 |
| 세션 즉시 무효화 | `supabase/schema-v2-auth.sql`의 `current_session_valid()` 함수 (JWT의 `session_id`가 `auth.sessions`에 아직 있는지 매 요청마다 확인), `supabase/schema-v2-session-revoke-on-pwchange.sql`의 `on_password_change` 트리거 (비밀번호가 바뀌면 `auth.sessions`에서 그 사람 세션을 전부 지움) |
| 계정 삭제(자료) | `scripts/db.mjs` `deleteAllMyData()` → `scripts/app.mjs`의 `#deleteAccountBtn` 핸들러 |
| 기존(과제6) 데이터 이전 | `supabase/schema-v2-backfill.sql` — 주인이 없던 기존 행을 실제 계정 UUID로 옮김 |

바꾸지 않은 것: 화면의 CRUD 로직(`fetchPlans`, `createTodo` 등)은 과제6 그대로다. Supabase 클라이언트가 로그인 세션의 토큰을 자동으로 붙여 보내기 때문에, RLS만 새로 걸면 기존 코드가 그대로 "내 것만" 동작한다.

## ④ 안 열리는 것을 확인한 기록

전부 실제 라이브 Supabase 프로젝트에 대한 실제 HTTP 요청/응답이다. 테스트는 실제 이메일이 아닌 별도 테스트 계정 2~3개(`akrrkt7+t7a...@gmail.com` 등, 실제 사용 계정과 무관)로 진행했고, 비밀번호는 아래 어디에도 원문으로 남기지 않았다.

**확인 1 — 로그인하지 않고 직접 요청**
```
GET /rest/v1/plans?select=*
(Authorization: Bearer <anon 공개키>, 로그인 세션 없음)
→ 200  본문: []
```
(과제6 때는 이 요청이 전체 계획을 다 돌려줬다 — 지금은 빈 배열)

**확인 2 — 로그아웃 후 같은 토큰으로 같은 요청 재전송**
```
GET /rest/v1/plans?id=eq.dbda9f62-...&select=id,title
[로그인 상태]  → 200  [{"id":"dbda9f62-...","title":"A의 계획"}]
[로그아웃 실행: POST /auth/v1/logout?scope=global → 204]
[같은 토큰으로 같은 요청 재전송] → 200  []
```

**확인 2-2 — 비밀번호 변경 후 같은(변경 전) 토큰으로 같은 요청 재전송** (처음엔 안 막혔다가 트리거 추가 후 막힘 — 아래 ⑥ 참고)
```
GET /rest/v1/plans?id=eq.65caba17-...&select=id,title
[변경 전]  → 200  [{"id":"65caba17-...","title":"C의 계획-비번변경테스트"}]
[PUT /auth/v1/user  body:{"password":"eyJ...생략(새 비밀번호, 원문 생략)"} → 200]
[같은 토큰으로 같은 요청 재전송] → 200  []
```

**확인 3 — 다른 계정 자료 읽기 (양방향)**
```
[A 토큰으로] GET /rest/v1/plans?id=eq.<B의 계획id>&select=*  → 200  []
[B 토큰으로] GET /rest/v1/plans?id=eq.<A의 계획id>&select=*  → 200  []
```

**확인 4 — 다른 계정 자료 수정·삭제 (양방향), 그리고 거절 전후 상대방 자료가 그대로인지**
```
[A 토큰으로] PATCH /rest/v1/plans?id=eq.<B의 계획id>  body:{"title":"해킹시도"}   → 204 (0건 변경)
[A 토큰으로] DELETE /rest/v1/plans?id=eq.<B의 계획id>                            → 204 (0건 삭제)
[B 토큰으로] PATCH /rest/v1/plans?id=eq.<A의 계획id>  body:{"title":"해킹시도2"}  → 204 (0건 변경)
[B 토큰으로] DELETE /rest/v1/plans?id=eq.<A의 계획id>                            → 204 (0건 삭제)

거절 뒤 확인:
[B 토큰으로] GET 자기 계획 → title 그대로 "B의 계획" (안 바뀜, 안 지워짐)
[A 토큰으로] GET 자기 계획 → title 그대로 "A의 계획" (안 바뀜, 안 지워짐)
```

**확인 5 — 주소·본문 조작, 목록 응답 오염 여부**
```
[A 토큰으로] GET /rest/v1/plans?user_id=eq.<B의 id>&select=*        → 200  []  (주소에 남의 id를 넣어도 안 나옴)
[A 토큰으로] GET /rest/v1/plans?select=id,title,user_id (필터 없음)  → 200  [A의 계획 1건만] (목록에 B 자료 없음)
[A 토큰으로] POST /rest/v1/plans body:{..., "user_id":"<B의 id>"}   → 403 {"code":"42501","message":"new row violates row-level security policy for table \"plans\""}
```

**부가 확인 — 계정/비밀번호 관련 세부 기준**
```
같은 이메일로 재가입: POST /auth/v1/signup (이미 쓴 이메일) → 422 {"error_code":"user_already_exists","msg":"User already registered"}
비밀번호 틀림:       POST /auth/v1/token?grant_type=password → 400 {"error_code":"invalid_credentials","msg":"Invalid login credentials"}
존재하지 않는 계정:   POST /auth/v1/token?grant_type=password → 400 {"error_code":"invalid_credentials","msg":"Invalid login credentials"}
                    (→ 문구가 완전히 동일함, 계정 존재 여부를 알아낼 수 없음)
```

**저장된 비밀번호 값 (같은 비밀번호로 만든 두 계정)**
```
account A: $2a$10$RTzQ2DaGM.4p/n1rcwndLOl7pF9o1vSZaDVfpBj8tbfWTaQccldlm
account C: $2a$10$OlyiqkmP9RBMgOhV8iqba.hoy930qOgfjd7LotZDnwD23dlDKtwJO
```
- 방법: **bcrypt** (해시 앞부분 `$2a$10$`로 알고리즘·비용계수 10을 그대로 확인할 수 있음). 고른 이유: Supabase Auth(GoTrue)가 기본으로 쓰는 방식이라 별도 선택의 여지가 없었고, bcrypt는 계정마다 다른 salt를 자동으로 붙여주는 널리 검증된 방식이라 그대로 신뢰했다.
- 같은 문자열("SharedPassw0rd!9")을 두 계정에 넣었는데 저장된 값이 서로 다르다 — 계정마다 다른 salt가 쓰인다는 뜻.
- 입력한 글자("SharedPassw0rd!9")가 저장된 값 어디에도 그대로 보이지 않는다.
- 로그인 요청 본문에는 비밀번호 원문이 들어가지만(HTTPS로 암호화되어 전송됨), 저장은 위 해시로만 되고, 응답 본문에는 비밀번호가 전혀 포함되지 않는다(access_token만 옴).
- 비밀번호를 다루는 부분은 전부 라이브러리(Supabase Auth)에 맡겼고, 직접 만든 부분이 없다.

**세션/토큰 관련**
- 사람을 알아보는 방식: **토큰(JWT, Supabase의 access_token)**. 헤더의 `Authorization: Bearer <token>`으로만 전달되며 주소(URL)에는 실리지 않는다.
- 만료 시각: 발급 시(`iat`)로부터 3600초(1시간) 뒤 만료(`exp`) — 예: `iat:1789104032, exp:1789107632`.
- 이 토큰을 서명하는 비밀키는 Supabase가 서버 쪽에서만 들고 있고, 이 저장소의 브라우저 코드·배포 파일·Git 커밋 이력 어디에도 없다(우리가 다루는 키는 `sb_publishable_...`뿐이며, 이는 공개용으로 설계된 키다).

## ⑤ AI와 나

1. 스키마, DB 정책(RLS), 세션 무효화 함수/트리거, 프론트엔드 로그인·가입·로그아웃 화면 코드는 전부 AI가 작성했고, 실제 라이브 DB에 직접 읽고 쓰면서 동작도 AI가 확인했다.
2. 실제 데이터 넣고 화면 눌러보다가 회고 선택 위치를 헷갈리는 것 같은 건 사람이 써봐야 나오는 문제였다(과제6 때 발견). 이번 과제7에서는 실제 계정 가입·기존 데이터 이전은 비밀번호 문제로 사람이 직접 해야 했다.
3. 설계·배포·검증은 AI가 거의 다 했지만, 실제로 써보면서 걸리는 부분을 찾는 건 사람이 해야 했다.

## ⑥ 아직 못 막은 것

- **로그인 시도 무차별 대입(brute force) 방어를 별도로 붙이지 않았다.** Supabase 기본 요청 제한에 의존하고 있을 뿐, CAPTCHA나 로그인 실패 횟수 제한(계정 잠금)을 직접 구현하지 않았다 — 자동화된 비밀번호 대입 공격에 그대로 노출될 수 있다.
- **2차 인증(2FA)이 없다.** 비밀번호 하나만 뚫리면 바로 계정 전체가 뚫린다.
- **이메일 인증(주소 확인)을 꺼 두었다.** 남의 이메일 주소로도 가입 시도가 가능하다(단, 그 이메일 소유자가 로그인할 수 있는 건 아니므로 계정 탈취로 이어지진 않지만, 스팸성 가입은 막지 못한다). 가입 화면에도 CAPTCHA가 없어 자동 대량 가입에 취약하다.
- **비밀번호 재설정(찾기) 기능이 없다.** 비밀번호를 잊으면 복구할 방법이 앱 안에 없다.
- **실제 로그인 계정(이메일·비밀번호 자체, `auth.users` 행)을 지우는 기능은 못 만들었다.** 이걸 지우려면 관리자 권한 키(service_role)가 필요한데, 그 키는 절대 프론트엔드에 넣을 수 없는 것이라(넣는 순간 이 저장소 전체가 뚫린다), "계정 삭제" 버튼은 내 기록 데이터만 전부 지우고 로그인 정보 자체는 그대로 남는다 — 화면에도 이 사실을 그대로 안내했다.
- **세션 무효화 방식(`current_session_valid()`)이 매 요청마다 `auth.sessions`를 한 번 더 조회한다.** 사용자가 아주 많아지면 이 조회가 성능에 영향을 줄 수 있는데, 지금은 혼자 쓰는 앱이라 문제되지 않는 수준이다.

---

## 짧은 확인 방법 (4줄)

1. 어디로 가나요 — https://sby1234-ai.github.io/t06-pds-diary/ 로 로그인 없이 접속합니다.
2. 세 단계 안에 무엇을 하나요 — (1) 로그인 화면이 뜨는지 봅니다 (2) 아무 계정으로나 로그인 시도해 봅니다(당연히 실패) (3) 새 이메일로 회원가입해 봅니다.
3. 무엇이 보이면 통과인가요 — 로그인 없이는 계획/할일 화면이 전혀 안 보이고, 회원가입하면 그 즉시 로그인되어 내 화면(처음엔 빈 상태)이 뜨면 통과입니다.
4. 안 될 때는 무엇이 보이나요 — 로그인 실패 시 "로그인 실패: Invalid login credentials" 문구가, 중복 이메일 가입 시 "가입 실패: User already registered" 문구가 화면에 그대로 뜹니다.

## AI와 내 판단 (3줄)

1. AI에게 맡긴 일 — 인증 방식 설계, RLS 정책·세션 무효화 트리거 작성, 화면 코드, 그리고 두 개의 테스트 계정을 직접 만들어 양방향 침투 테스트(읽기/수정/삭제/스푸핑)까지 AI가 실행하고 실제 응답을 근거로 남겼다.
2. 내가 직접 판단한 일 — 실제 내 이메일/비밀번호로 계정을 만드는 것, 이메일 인증(Confirm email)을 끌지 여부, Supabase 대시보드 설정 변경은 전부 내가 직접 했다.
3. AI 제안을 따르지 않은 일 — 없음. 다만 AI가 테스트 중 "비밀번호 변경만으로는 세션이 안 끊긴다"는 문제를 스스로 찾아내 트리거를 추가로 제안했고, 그건 그대로 받아들였다.
