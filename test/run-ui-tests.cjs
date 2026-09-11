// UI 배선(wiring) 검증용 테스트.
// 실 Supabase 접속은 이 샌드박스의 네트워크 정책상 막혀 있어(사전에 확인함),
// 여기서는 supabase-js를 가짜(in-memory) 구현으로 가로채서 화면 로직 자체의
// 버그(엘리먼트 누락, 이벤트 미연결, 렌더링 오류 등)를 잡는 것이 목적이다.
// 실제 라이브 Supabase 프로젝트에 대한 진짜 연결/RLS/쓰기 확인은 이미
// Claude 내장 브라우저(사용자 PC)에서 실제 REST 호출로 별도 확인했다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8792';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(id, desc, pass, note) {
  results.push({ id, desc, pass, note: note || '' });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + id + '  ' + desc + (note ? '  -- ' + note : ''));
}

// ── 가짜 supabase-js 모듈. createClient()가 반환하는 client는 in-memory store를 사용한다.
const FAKE_SUPABASE_JS = `
function uuid() { return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
const store = { plans: [], plan_history: [], todos: [], do_records: [], retrospectives: [] };
window.__store = store; // 테스트에서 직접 들여다볼 수 있게 노출

// ── 가짜 인증. 실제 로그인/세션 로직 자체는 이미 라이브 Supabase로 별도 검증했고,
// 여기서는 "로그인해야 화면이 열리고, 로그아웃하면 닫힌다"는 화면 배선만 확인한다.
const authUsers = []; // {email, password, id}
let currentSession = null;
const authListeners = [];
function fireAuthChange(event) {
  for (const cb of authListeners) cb(event, currentSession);
}
const authApi = {
  async signUp({ email, password }) {
    if (authUsers.find((u) => u.email === email)) {
      return { data: {}, error: { message: 'User already registered' } };
    }
    const user = { id: uuid(), email };
    authUsers.push({ email, password, id: user.id });
    currentSession = { user, access_token: 'fake-token-' + user.id };
    fireAuthChange('SIGNED_IN');
    return { data: { user, session: currentSession }, error: null };
  },
  async signInWithPassword({ email, password }) {
    const found = authUsers.find((u) => u.email === email && u.password === password);
    if (!found) return { data: {}, error: { message: 'Invalid login credentials' } };
    currentSession = { user: { id: found.id, email }, access_token: 'fake-token-' + found.id };
    fireAuthChange('SIGNED_IN');
    return { data: { session: currentSession }, error: null };
  },
  async signOut() {
    currentSession = null;
    fireAuthChange('SIGNED_OUT');
    return { error: null };
  },
  async getSession() {
    return { data: { session: currentSession } };
  },
  async updateUser({ password }) {
    const found = authUsers.find((u) => u.id === currentSession.user.id);
    if (found) found.password = password;
    return { data: {}, error: null };
  },
  onAuthStateChange(cb) {
    authListeners.push(cb);
    return { data: { subscription: { unsubscribe() {} } } };
  },
};

const DEFAULTS = {
  plans: { priority: 'medium', success_criteria: '', expected_minutes: 0, source_retro_id: null, source_insight: null, is_deleted: false },
  todos: { priority: 'medium', tags: [], expected_minutes: 0, status: 'open', is_deleted: false, plan_id: null, due_date: null },
  do_records: { ended_at: null, actual_minutes: null, blocked_reason: null, completed: false },
  retrospectives: {},
  plan_history: {},
};

class QB {
  constructor(table) {
    this.table = table;
    this._filters = [];
    this._mode = 'select';
    this._payload = null;
    this._single = false;
    this._onConflict = null;
  }
  select() { return this; }
  eq(field, value) { this._filters.push([field, value]); return this; }
  order() { this._ordered = true; return this; }
  single() { this._single = true; return this; }
  insert(obj) { this._mode = 'insert'; this._payload = obj; return this; }
  update(obj) { this._mode = 'update'; this._payload = obj; return this; }
  upsert(obj, opts) { this._mode = 'upsert'; this._payload = obj; this._onConflict = opts && opts.onConflict; return this; }
  delete() { this._mode = 'delete'; return this; }
  _matches(row) { return this._filters.every(([f, v]) => row[f] === v); }
  _exec() {
    const rows = store[this.table];
    if (this._mode === 'select') {
      let out = rows.filter((r) => this._matches(r));
      if (this._single) {
        return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'not found: ' + this.table } };
      }
      return { data: out, error: null };
    }
    if (this._mode === 'insert') {
      const row = Object.assign({}, DEFAULTS[this.table] || {}, { user_id: currentSession ? currentSession.user.id : null }, this._payload, {
        id: this._payload.id || uuid(),
        created_at: this._payload.created_at || new Date().toISOString(),
        updated_at: this._payload.updated_at || new Date().toISOString(),
      });
      rows.push(row);
      return { data: this._single ? row : [row], error: null };
    }
    if (this._mode === 'update') {
      const target = rows.filter((r) => this._matches(r));
      for (const row of target) Object.assign(row, this._payload);
      const result = target[0] || null;
      return { data: this._single ? result : target, error: result ? null : { message: 'not found for update' } };
    }
    if (this._mode === 'upsert') {
      const key = this._onConflict;
      let existing = key ? rows.find((r) => r[key] === this._payload[key]) : null;
      if (existing) {
        Object.assign(existing, this._payload);
        return { data: this._single ? existing : [existing], error: null };
      }
      const row = Object.assign({}, DEFAULTS[this.table] || {}, this._payload, {
        id: this._payload.id || uuid(),
        created_at: this._payload.created_at || new Date().toISOString(),
      });
      rows.push(row);
      return { data: this._single ? row : [row], error: null };
    }
    if (this._mode === 'delete') {
      const remaining = rows.filter((r) => !this._matches(r));
      const removed = rows.filter((r) => this._matches(r));
      store[this.table] = remaining;
      return { data: removed, error: null };
    }
    return { data: null, error: { message: 'unknown mode' } };
  }
  then(resolve, reject) {
    try {
      const result = this._exec();
      resolve(result);
    } catch (e) {
      reject(e);
    }
  }
}

class FakeClient {
  from(table) { return new QB(table); }
  get auth() { return authApi; }
}

export function createClient() { return new FakeClient(); }
`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await page.route('**/cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: FAKE_SUPABASE_JS })
  );

  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(500);

  // U01: 로그인하지 않으면 로그인 화면이 보이고, 자료 화면(appRoot)은 숨겨져 있음
  const authVisible = await page.isVisible('#authScreen');
  const appHiddenBefore = await page.isHidden('#appRoot');
  log('U01-로그인게이트', '로그인 전에는 로그인 화면만 보이고 자료 화면은 숨겨짐', authVisible && appHiddenBefore);

  // U01b: 회원가입 -> 자동 로그인 -> 자료 화면 노출
  await page.click('.auth-tabs button[data-authtab="signup"]');
  await page.fill('#signupEmail', 'tester@example.com');
  await page.fill('#signupPassword', 'testpass123');
  await page.click('#signupForm button[type="submit"]');
  await page.waitForTimeout(300);
  const appVisibleAfterSignup = await page.isVisible('#appRoot');
  const emailLabel = await page.textContent('#userEmailLabel');
  log('U01c-회원가입후자동로그인', '가입 즉시 로그인되어 자료 화면이 열리고 이메일이 표시됨', appVisibleAfterSignup && emailLabel.includes('tester@example.com'));

  // U02: 초기 로딩 에러 없음
  log('U02-초기로딩', '초기 로딩 시 콘솔/페이지 에러 없음', pageErrors.length === 0, pageErrors.join(' | '));

  // U03: 계획 생성 -> 목록 반영
  await page.fill('#planTitle', '9월 3주차 집중 계획');
  await page.fill('#planStart', '2026-09-14');
  await page.fill('#planEnd', '2026-09-20');
  await page.fill('#planCriteria', '매일 할 일 3개 이상 완료');
  await page.click('#planSubmitBtn');
  await page.waitForTimeout(300);
  const planListText = await page.textContent('#planList');
  log('U03-계획생성', '계획 생성 후 목록에 제목 표시', planListText.includes('9월 3주차 집중 계획'));

  // U04: XSS - 스크립트 태그가 문자 그대로 보이고 실행되지 않음
  await page.fill('#planTitle', '<img src=x onerror="window.__xss=1">');
  await page.fill('#planStart', '2026-09-14');
  await page.fill('#planEnd', '2026-09-20');
  await page.fill('#planCriteria', 'XSS 테스트');
  await page.click('#planSubmitBtn');
  await page.waitForTimeout(300);
  const xssTriggered = await page.evaluate(() => window.__xss === 1);
  const planListText2 = await page.textContent('#planList');
  log('U04-XSS안전', '스크립트성 입력이 실행되지 않고 문자 그대로만 보임', !xssTriggered && planListText2.includes('<img src=x'));

  // U05: 계획 -> 할 일 탭에서 연결 옵션에 반영
  await page.click('.tabs button[data-tab="todo"]');
  await page.waitForTimeout(200);
  const todoPlanOptions = await page.$$eval('#todoPlan option', (opts) => opts.map((o) => o.textContent));
  log('U05-계획연결옵션', '할 일 폼의 계획 선택지에 방금 만든 계획이 보임', todoPlanOptions.some((t) => t.includes('9월 3주차 집중 계획')));

  // U06: 할 일 생성(마감일을 어제로 -> 지연 배지 확인)
  await page.fill('#todoTitle', '보고서 초안 작성');
  await page.fill('#todoDue', '2026-09-01'); // 오늘(가짜론 브라우저 실제 오늘 기준) 이전
  await page.selectOption('#todoPriority', 'high');
  await page.fill('#todoTags', '업무, 급함');
  await page.click('#todoSubmitBtn');
  await page.waitForTimeout(300);
  const todoListText = await page.textContent('#todoList');
  log('U06-할일생성', '할 일 생성 후 목록에 제목/태그 표시', todoListText.includes('보고서 초안 작성') && todoListText.includes('업무'));
  log('U07-지연배지', '마감 지난 할 일에 지연 배지 표시', todoListText.includes('지연'));

  // U08: 검색 필터
  await page.fill('#todoSearch', '없는제목검색');
  await page.waitForTimeout(200);
  const emptyFilterText = await page.textContent('#todoList');
  log('U08-검색필터', '검색어에 안 맞으면 빈 목록 안내', emptyFilterText.includes('없습니다'));
  await page.fill('#todoSearch', '');
  await page.waitForTimeout(200);

  // U09: 실행(Do) 탭 - 시작 -> 완료 흐름, 중복 완료 방지 확인
  await page.click('.tabs button[data-tab="do"]');
  await page.waitForTimeout(300);
  const doListBefore = await page.textContent('#doList');
  log('U09-실행목록', '진행중 할 일이 실행 탭에 보임', doListBefore.includes('보고서 초안 작성'));

  await page.click('#doList button:has-text("시작")');
  await page.waitForTimeout(300);
  const afterStart = await page.textContent('#doList');
  log('U10-시작기록', '시작 클릭 후 진행중 표시', afterStart.includes('진행중'));

  const doRecordCountAfterStart = await page.evaluate(() => window.__store.do_records.length);
  await page.click('#doList button:has-text("완료")');
  await page.waitForTimeout(300);
  const doRecordCountAfterComplete = await page.evaluate(() => window.__store.do_records.length);
  const completedRecord = await page.evaluate(() => window.__store.do_records[0]);
  log('U11-완료기록', '완료 처리 후 같은 실행 기록 1건만 존재(중복 집계 없음)', doRecordCountAfterStart === 1 && doRecordCountAfterComplete === 1 && completedRecord.completed === true);

  const todoStatusAfterComplete = await page.evaluate(() => window.__store.todos.find((t) => t.title === '보고서 초안 작성').status);
  log('U12-할일상태동기화', '실행 완료 시 연결된 할 일 status가 done으로 바뀜', todoStatusAfterComplete === 'done');

  // U13: 회고(See) 탭 - 집계 숫자 + 드릴다운
  await page.click('.tabs button[data-tab="see"]');
  await page.waitForTimeout(300);
  await page.fill('#seeStart', '2026-01-01');
  await page.fill('#seeEnd', '2026-12-31');
  await page.click('#seeRefreshBtn');
  await page.waitForTimeout(300);
  const statGridText = await page.textContent('#seeStatGrid');
  log('U13-집계표시', '계획 수/완료 수 등 집계 카드 표시', /계획 수/.test(statGridText) && /완료 수/.test(statGridText));

  const doneBox = await page.locator('.stat-box', { hasText: '완료 수' });
  await doneBox.click();
  await page.waitForTimeout(200);
  const drilldownText = await page.textContent('#seeDrilldown');
  log('U14-드릴다운', '완료 수 클릭 시 근거 기록(보고서 초안 작성) 표시', drilldownText.includes('보고서 초안 작성'));

  // U15: 회고 저장 -> 다음 계획에서 연결 옵션으로 보임
  await page.fill('#retroInsight', '오전에 집중이 잘 되니 어려운 일을 오전으로');
  await page.click('#retroForm button[type="submit"]');
  await page.waitForTimeout(300);
  await page.click('.tabs button[data-tab="plan"]');
  await page.waitForTimeout(200);
  const retroLinkOptions = await page.$$eval('#planRetroLink option', (opts) => opts.map((o) => o.textContent));
  log('U16-회고연결옵션', '저장한 회고가 계획 폼의 회고 연결 선택지에 보임', retroLinkOptions.some((t) => t.includes('오전에 집중이 잘 되니')));

  // U17: 회고를 이어받아 계획 생성 -> source_insight 저장 확인
  await page.selectOption('#planRetroLink', { index: 1 });
  await page.fill('#planTitle', '다음 주 계획');
  await page.fill('#planStart', '2026-09-21');
  await page.fill('#planEnd', '2026-09-27');
  await page.fill('#planCriteria', '오전에 어려운 일 우선 배치');
  await page.click('#planSubmitBtn');
  await page.waitForTimeout(300);
  const newPlan = await page.evaluate(() => window.__store.plans.find((p) => p.title === '다음 주 계획'));
  log('U18-피드백루프', '회고 통찰을 이어받은 계획에 source_insight가 저장됨', !!newPlan && newPlan.source_insight === '오전에 집중이 잘 되니 어려운 일을 오전으로');

  // U19: 계획 수정 -> plan_history에 수정 전 스냅샷 남는지
  const planBeforeEdit = await page.evaluate(() => window.__store.plans.find((p) => p.title === '9월 3주차 집중 계획'));
  await page.evaluate((id) => {
    document.querySelectorAll('#planList .list-item').forEach((item) => {
      if (item.querySelector('.title').textContent === '9월 3주차 집중 계획') {
        item.querySelector('button.ghost').click();
      }
    });
  }, planBeforeEdit.id);
  await page.waitForTimeout(200);
  await page.fill('#planTitle', '9월 3주차 집중 계획(수정됨)');
  await page.click('#planSubmitBtn');
  await page.waitForTimeout(300);
  const historyCount = await page.evaluate((id) => window.__store.plan_history.filter((h) => h.plan_id === id).length, planBeforeEdit.id);
  log('U20-수정이력보존', '계획 수정 시 plan_history에 수정 전 스냅샷 1건 이상 남음', historyCount >= 1);

  // U21: 삭제(소프트 삭제) - is_deleted true, 목록에서는 사라짐
  const planToDelete = await page.evaluate(() => window.__store.plans.find((p) => p.title === '다음 주 계획'));
  page.once('dialog', (d) => d.accept());
  await page.evaluate((id) => {
    document.querySelectorAll('#planList .list-item').forEach((item) => {
      if (item.querySelector('.title').textContent === '다음 주 계획') {
        item.querySelectorAll('button')[1].click();
      }
    });
  }, planToDelete.id);
  await page.waitForTimeout(300);
  const deletedFlag = await page.evaluate((id) => window.__store.plans.find((p) => p.id === id).is_deleted, planToDelete.id);
  const planListAfterDelete = await page.textContent('#planList');
  log('U22-소프트삭제', '삭제 시 is_deleted=true로만 표시되고(물리삭제 아님) 목록에서는 숨겨짐', deletedFlag === true && !planListAfterDelete.includes('다음 주 계획'));

  // U23: 내보내기 버튼 동작(다운로드 트리거) 확인
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.tabs button[data-tab="export"]').then(() => page.click('#exportBtn')),
  ]);
  const downloadPath = await download.path();
  const exportedJson = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
  log('U24-내보내기', '내보내기 JSON에 4개 컬렉션 모두 포함', ['plans', 'todos', 'do_records', 'retrospectives'].every((k) => Array.isArray(exportedJson[k])));

  // U25: 로그아웃하면 다시 로그인 화면으로 돌아감
  await page.click('#logoutBtn');
  await page.waitForTimeout(300);
  const authVisibleAfterLogout = await page.isVisible('#authScreen');
  const appHiddenAfterLogout = await page.isHidden('#appRoot');
  log('U25-로그아웃', '로그아웃하면 자료 화면이 숨겨지고 로그인 화면으로 돌아감', authVisibleAfterLogout && appHiddenAfterLogout);

  // U26: 틀린 비밀번호로 로그인 실패 메시지
  await page.click('.auth-tabs button[data-authtab="login"]');
  await page.fill('#loginEmail', 'tester@example.com');
  await page.fill('#loginPassword', 'wrong-password');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(300);
  const wrongPwMsg = await page.textContent('#loginStatus');
  log('U26-로그인실패문구', '틀린 비밀번호 로그인 시 실패 문구 표시', /Invalid login credentials/.test(wrongPwMsg));

  // U27: 없는 계정으로 로그인 시도 -> 같은 문구(T07-C99 취지: 문구를 구분하지 않음)
  await page.fill('#loginEmail', 'no-such-user@example.com');
  await page.fill('#loginPassword', 'whatever123');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(300);
  const noUserMsg = await page.textContent('#loginStatus');
  log('U27-계정없음문구동일', '없는 계정 로그인 실패 문구가 비밀번호 오류 문구와 동일', noUserMsg.trim() === wrongPwMsg.trim());

  // U28: 다시 올바르게 로그인 -> 계정 삭제 -> 로그인 화면으로 복귀 + 데이터 삭제
  await page.fill('#loginEmail', 'tester@example.com');
  await page.fill('#loginPassword', 'testpass123');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(300);
  page.once('dialog', (d) => d.accept());
  await page.click('#deleteAccountBtn');
  await page.waitForTimeout(300);
  const remainingPlans = await page.evaluate(() => window.__store.plans.length);
  const backToAuth = await page.isVisible('#authScreen');
  log('U29-계정삭제', '계정 삭제 시 내 자료가 전부 지워지고 로그인 화면으로 돌아감', remainingPlans === 0 && backToAuth);

  await page.screenshot({ path: path.join(OUT, 'final.png'), fullPage: true });
  await browser.close();

  const failCount = results.filter((r) => !r.pass).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log('\\n=== SUMMARY: ' + (results.length - failCount) + '/' + results.length + ' passed ===');
  process.exit(failCount > 0 ? 1 : 0);
})();
