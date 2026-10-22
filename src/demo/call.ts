/**
 * 통화 중 한 화면(PRD 3절·F1·F4·F5·F6·F7·F11·F12)의 상태와 뷰 모델. 순수 함수다 — 화면(src/app/_components/Call.tsx)은
 * 누른 것을 callReducer로 상태에 쌓고, callView가 돌려준 값을 그리기만 한다. 그래서 "상담 → 예, 처음을 누르면 무엇이 보이나"를
 * 브라우저 없이 시험할 수 있다(call.test.ts).
 *
 * 흐름: 안건 버튼(상담·시술·재시술) → (시술이면) 하위 칩 → 확인 질문의 대답 → 빈 시간 목록.
 * 수술은 크기(하루·반나절, 기본 하루)를, 주사 회차 옮기기는 예정일을 한 번 더 고른다.
 * 목록이 뜬 뒤에는 거르개(요일·시간대·날짜로 이동)와 "더 보기", 칸 누르기(읽어 줄 문장·확정 문자·가예약)만 있다.
 */

import { addDays, dayOfWeek, diffDays, DOW_KEYS, DOW_KO, formatHhmm, formatKstIso, formatShort, kstDateOf, kstMinuteOfDay, type DowKey, type LocalDate } from "@/core/calendar";
import type { Engine } from "@/core/engine";
import { formatExpiry, holdState, liveHolds, type Hold, type HoldState } from "@/core/holds";
import { questionFor, resolveIntake, type Resolved } from "@/core/intake";
import { accountNote, composeClosed, composeConfirmation, composeHoldLine, composeReadout, type Composed } from "@/core/message";
import type { Schedule } from "@/core/schedule";
import { applyFilter, BAND_LABEL, dayLines, findSlots, firstBookable, suggestSlots, type Band, type DayKind, type Slot } from "@/core/slots";

/** 거르개 요일(일요일은 늘 휴진이라 뺀다). */
export const FILTER_DOWS: DowKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
export const FILTER_BANDS: Band[] = ["morning", "afternoon", "evening"];

export interface CallState {
  button: string | null;
  sub: string | null;
  answer: string | null;
  /** 수술 크기(없으면 기본값 = 대답의 sizes 첫 값). */
  size: string | null;
  /** 주사 회차 옮기기의 예정일. */
  moveDue: LocalDate | null;
  dows: DowKey[];
  bands: Band[];
  /** 날짜로 이동: 이 날짜부터. */
  jump: LocalDate | null;
  /** "더 보기"로 늘린 날 수. */
  extraDays: number;
  /** 누른 칸(빈 칸이거나 이 기기의 가예약 칸). */
  selected: { date: LocalDate; start: string } | null;
}

export const INITIAL_CALL: CallState = {
  button: null,
  sub: null,
  answer: null,
  size: null,
  moveDue: null,
  dows: [],
  bands: [],
  jump: null,
  extraDays: 0,
  selected: null,
};

export type CallAction =
  | { type: "button"; key: string }
  | { type: "sub"; key: string }
  | { type: "answer"; key: string }
  | { type: "size"; key: string }
  | { type: "moveDue"; date: LocalDate | null }
  | { type: "toggleDow"; dow: DowKey }
  | { type: "toggleBand"; band: Band }
  | { type: "jump"; date: LocalDate | null }
  | { type: "clearFilter" }
  | { type: "more"; days: number }
  | { type: "select"; date: LocalDate; start: string }
  | { type: "close" }
  | { type: "reset" };

const NO_RESULT_STATE = { dows: [], bands: [], jump: null, extraDays: 0, selected: null } satisfies Partial<CallState>;

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * 누를 때마다 다음 상태. 앞 단계를 다시 누르면 뒤 단계(대답·크기·거르개·누른 칸)를 비운다 — 다른 안건의 거르개나 칸이
 * 남아 새 목록을 조용히 좁히지 않게. 크기만은 같은 안건의 크기 바꾸기라 거르개를 남긴다.
 */
export function callReducer(s: CallState, a: CallAction): CallState {
  switch (a.type) {
    case "button":
      return { ...INITIAL_CALL, button: a.key };
    case "sub":
      return { ...INITIAL_CALL, button: s.button, sub: a.key };
    case "answer":
      return { ...s, ...NO_RESULT_STATE, answer: a.key, size: null, moveDue: null };
    case "size":
      return { ...s, size: a.key, selected: null, extraDays: 0 };
    case "moveDue":
      return { ...s, ...NO_RESULT_STATE, moveDue: a.date };
    case "toggleDow":
      return { ...s, dows: toggle(s.dows, a.dow), selected: null };
    case "toggleBand":
      return { ...s, bands: toggle(s.bands, a.band), selected: null };
    case "jump":
      return { ...s, jump: a.date, selected: null };
    case "clearFilter":
      return { ...s, dows: [], bands: [], jump: null, selected: null };
    case "more":
      return { ...s, extraDays: s.extraDays + a.days };
    case "select":
      return { ...s, selected: { date: a.date, start: a.start } };
    case "close":
      return { ...s, selected: null };
    case "reset":
      return INITIAL_CALL;
  }
}

// ── 뷰 모델 ─────────────────────────────────────────────────────

export interface Choice<K extends string = string> {
  key: K;
  label: string;
  pressed: boolean;
  hint?: string;
}

export interface HeldChip {
  holdId: string;
  date: LocalDate;
  start: string;
  /** "14:00" 또는 여러 날을 묶은 줄이면 "9/30(수) 14:00". */
  label: string;
  state: HoldState;
}

export interface LineView {
  key: string;
  kind: DayKind;
  /** 칸이 있는 날: "9/21(월)", 칸 없는 줄: 엔진이 만든 한 줄("9/24(목)~9/27(일) 추석 연휴·일요일 — 휴진"). */
  text: string;
  /** 오늘·내일·모레(칸이 있는 날만). */
  rel: string | null;
  slots: Slot[];
  /** 그날 칸 모두에 붙는 안내(입금 즉시 확인 필요, 다음 날 내원 …). */
  tags: string[];
  held: HeldChip[];
  /** 휴진 줄: 고객에게 읽어 줄 한 문장("…휴진입니다(추석 연휴·일요일). 가장 가까운 빈 시간은 …"). 다른 줄은 null. */
  say: Composed | null;
}

export interface ResultView {
  service: { key: string; label: string; minutes: number; surgery: boolean };
  /** "처음 오시는 분은 첫 상담부터(V05)" — 질문의 대답 때문에 첫 상담으로 바뀜. */
  redirect: string | null;
  /** 대답에 붙은 경고(재시술 "담당(집도) 의료진 일정은 예약표에서 확인" 등) — 결과 제목 바로 아래에 보인다. */
  warnings: string[];
  /** 안건 안내(목록 아래). */
  notes: string[];
  /** 예약금을 받는 안건인가(직원용 문구를 "입금 확인"과 "확정 연락"으로 나눈다). */
  deposit: boolean;
  /** "입금 안내는 예약 프로그램 문구 사용" — 읽는 문장 밖에 따로 보인다. 예약금 없는 안건은 null. */
  accountNote: string | null;
  hint: string | null;
  rangeText: string;
  /**
   * "첫 가능 9/21(월) 11:00"(기준 시각 + B01 leadMinutes를 칸 격자로 올림) · 수술은 "수술은 9/28(월)부터[가정]".
   * 거르개를 켰거나 회차 옮기기면 그 결과의 첫 칸("첫 칸 10/1(목) 20:00"), 칸이 없으면 null.
   */
  earliestText: string | null;
  lines: LineView[];
  /** 거르개 안의 빈 칸 수. */
  count: number;
  /** 거르개 없이 기간 안의 빈 칸 수. */
  totalCount: number;
  emptyText: string | null;
  windowNote: string | null;
  suggestions: Slot[];
  readout: Composed | null;
  dows: Choice<DowKey>[];
  bands: Choice<Band>[];
  filtered: boolean;
  /** 날짜로 이동. closed면 휴진일(선택지 글에 "부터"를 붙이지 않는다). */
  jump: { value: LocalDate | null; options: { date: LocalDate; label: string; closed: boolean }[] };
  more: { days: number } | null;
}

export interface SheetView {
  date: LocalDate;
  start: string;
  end: string;
  /** "9/22(화) 14:00~15:00" */
  title: string;
  rel: string | null;
  serviceLabel: string;
  /** 예약금을 받는 안건인가. */
  deposit: boolean;
  accountNote: string | null;
  free: boolean;
  hold: Hold | null;
  holdState: HoldState | null;
  /** "9/22(화) 19:00" — 가예약이 풀리는 시각(입금 기한[가정]). */
  holdUntil: string;
  tags: string[];
  readout: Composed;
  confirmation: Composed;
  holdLine: Composed | null;
  /** 이 칸을 가예약하면 풀리는 시각(가예약 전 안내용). */
  wouldHoldUntil: string;
}

export interface CallView {
  buttons: Choice[];
  subs: Choice[] | null;
  question: { text: string; answers: Choice[] } | null;
  sizes: Choice[] | null;
  move: { value: LocalDate | null; options: { date: LocalDate; label: string }[] } | null;
  result: ResultView | null;
  sheet: SheetView | null;
  errors: string[];
}

export function relDay(today: LocalDate, d: LocalDate): string | null {
  return ["오늘", "내일", "모레"][diffDays(today, d)] ?? null;
}

const dowLabel = (d: DowKey) => DOW_KO[DOW_KEYS.indexOf(d)];

export function formatClock(ms: number): string {
  return `${formatShort(kstDateOf(ms))} ${formatHhmm(kstMinuteOfDay(ms))}`;
}

/** 모든 화면 위 띠(PRD F11). */
export function bandText(engine: Engine, nowMs: number, labels: { clinic: string; source: string } = { clinic: "가상 의원", source: "합성 예약" }): string {
  return [labels.clinic, labels.source, `기준 ${formatClock(nowMs)}`, ...(engine.assumptionRules ? ["[가정] 규칙 — 병원 확인 전"] : []), "가예약은 이 기기에서만"].join(" · ");
}

function commonTags(slots: Slot[]): string[] {
  if (slots.length === 0) return [];
  return slots[0].tags.filter((t) => slots.every((s) => s.tags.includes(t)));
}

function endOf(engine: Engine, service: string, start: string): string {
  const [h, m] = start.split(":").map(Number);
  return formatHhmm(h * 60 + m + engine.rules.services[service].minutes);
}

export interface CallInput {
  engine: Engine;
  schedule: Schedule;
  holds: Hold[];
  nowMs: number;
}

/** 확인 질문의 대답까지 누른 상태 → 찾을 안건. 아직 덜 눌렀으면 null. */
export function resolvedOf(engine: Engine, s: CallState): Resolved | null {
  if (!s.button || !s.answer) return null;
  const r = resolveIntake(engine, { button: s.button, ...(s.sub ? { sub: s.sub } : {}), answer: s.answer, ...(s.size ? { size: s.size } : {}) });
  return r.ok ? r.resolved : null;
}

export function callView(input: CallInput, s: CallState): CallView {
  const { engine, schedule, nowMs } = input;
  const today = kstDateOf(nowMs);
  const intake = engine.rules.intake;
  const buttons: Choice[] = intake.map((b) => ({ key: b.key, label: b.label, pressed: s.button === b.key, ...(b.hint ? { hint: b.hint } : {}) }));
  const view: CallView = { buttons, subs: null, question: null, sizes: null, move: null, result: null, sheet: null, errors: [] };
  const b = intake.find((x) => x.key === s.button);
  if (!b) return view;
  if (b.subs) view.subs = b.subs.map((x) => ({ key: x.key, label: x.label, pressed: s.sub === x.key }));
  const q = questionFor(engine, b.key, s.sub ?? undefined);
  if (!q) return view;
  view.question = { text: q.question, answers: q.answers.map((a) => ({ key: a.key, label: a.label, pressed: s.answer === a.key })) };
  if (!s.answer) return view;
  const r = resolveIntake(engine, { button: b.key, ...(s.sub ? { sub: s.sub } : {}), answer: s.answer, ...(s.size ? { size: s.size } : {}) });
  if (!r.ok) {
    view.errors.push(r.error);
    return view;
  }
  const resolved = r.resolved;
  if (resolved.sizes.length > 0) view.sizes = resolved.sizes.map((z, i) => ({ key: z.key, label: i === 0 ? `${z.label.replace(/^.*\((.*)\)$/, "$1")}(기본)` : z.label.replace(/^.*\((.*)\)$/, "$1"), pressed: resolved.service === z.key }));
  if (resolved.mode === "move") {
    const options: { date: LocalDate; label: string }[] = [];
    for (let d = addDays(today, -engine.rules.injectionMoveWindow.before); d <= addDays(today, engine.rules.searchDays.default + 10); d = addDays(d, 1)) {
      // 회차는 진료일에만 잡히고 일요일은 늘 휴진이라, 예정일이 일요일일 수 없다(28개 → 24개로 줄임).
      if (dayOfWeek(d) === 0) continue;
      const rel = relDay(today, d);
      options.push({ date: d, label: `${formatShort(d)}${rel ? ` ${rel}` : ""}` });
    }
    view.move = { value: s.moveDue, options };
    if (!s.moveDue) return view;
  }

  const live = liveHolds(engine, input.holds, nowMs);
  const svc = engine.rules.services[resolved.service];
  const surgery = svc.earliest === "surgery";
  const baseDays = surgery ? engine.rules.searchDays.surgery : engine.rules.searchDays.default;
  const found = findSlots(engine, {
    service: svc.key,
    nowMs,
    schedule,
    holds: live,
    ...(resolved.mode === "move" && s.moveDue ? { moveDue: s.moveDue } : { days: baseDays + s.extraDays }),
  });
  if (!found.ok) {
    view.errors.push(...found.errors);
    return view;
  }
  const filter = { dows: s.dows, bands: s.bands, ...(s.jump ? { from: s.jump } : {}) };
  const filtered = applyFilter(found, filter);
  const suggestions = suggestSlots(engine, filtered.slots);
  const readout = suggestions.length > 0 ? composeReadout(engine, { service: svc.key, slots: suggestions, today }) : null;
  const mine = live.filter((h) => h.service === svc.key);

  // 수술은 기준일 + surgeryMinDaysAhead일 전 날들을 줄로 늘어놓지 않는다(모두 "아직 이름" 줄이라 첫 칸을 화면 아래로 민다).
  // 그 사실은 결과 머리의 earliestText("수술은 9/28(월)부터[가정]") 한 줄로 알린다.
  const surgeryFrom = addDays(today, engine.rules.surgeryMinDaysAhead);
  const shownDays = surgery ? filtered.days.filter((d) => d.date >= surgeryFrom) : filtered.days;
  const lines: LineView[] = dayLines(shownDays).map((l) => {
    const held = mine
      .filter((h) => h.date >= l.from && h.date <= l.to)
      .sort((x, y) => (x.date === y.date ? (x.start < y.start ? -1 : 1) : x.date < y.date ? -1 : 1))
      .map((h) => ({ holdId: h.id, date: h.date, start: h.start, label: l.from === l.to ? h.start : `${formatShort(h.date)} ${h.start}`, state: holdState(engine, h, nowMs) }));
    return {
      key: `${l.kind}-${l.from}`,
      kind: l.kind,
      text: l.text,
      rel: l.kind === "slots" ? relDay(today, l.from) : null,
      slots: l.slots,
      tags: commonTags(l.slots),
      held,
      say:
        l.kind === "closed"
          ? composeClosed(engine, { from: l.from, to: l.to, reason: l.reason, next: filtered.slots.find((x) => x.date > l.to) ?? null, today })
          : null,
    };
  });

  const fb = firstBookable(engine, nowMs);
  const isFiltered = s.dows.length > 0 || s.bands.length > 0 || s.jump !== null;
  const firstShown = filtered.slots[0];
  // 거른 결과나 회차 옮기기 창에 "첫 가능 9/21 11:00"이 남으면 그 칸이 조건 안에 있는 것처럼 읽힌다(상담실장 점검 6).
  const earliestText =
    isFiltered || resolved.mode === "move"
      ? firstShown
        ? `첫 칸 ${formatShort(firstShown.date)} ${firstShown.start}`
        : null
      : surgery
        ? `수술은 ${formatShort(surgeryFrom)}부터[가정]`
        : `첫 가능 ${formatShort(fb.date)} ${fb.time}`;
  const days = baseDays + s.extraDays + engine.rules.searchDays.more;
  // 수술은 첫 가능일 전 날들을 줄로 보이지 않으니, 기간도 첫 가능일부터 적는다.
  const rangeFrom = surgery && surgeryFrom > found.range.from ? surgeryFrom : found.range.from;
  const rangeDays = found.range.days > 0 && rangeFrom <= found.range.to ? diffDays(rangeFrom, found.range.to) + 1 : 0;
  // 거르개는 이 안건에 쓸모 있는 것만: 시작 시각이 정해진 안건(수술)은 시간대 칩을 빼고, 수술 없는 요일(V02 토요일)은 요일 칩에서 뺀다.
  const dowChoices = FILTER_DOWS.filter((d) => !surgery || !engine.hours.noSurgeryDays.includes(d));
  const bandChoices = svc.starts === "grid" ? FILTER_BANDS : [];
  const account = accountNote(engine, svc.key);

  view.result = {
    service: { key: svc.key, label: svc.label, minutes: svc.minutes, surgery },
    redirect: resolved.redirect,
    warnings: resolved.answerNotes,
    notes: resolved.serviceNotes,
    deposit: svc.deposit !== null,
    accountNote: account,
    hint: resolved.hint,
    rangeText: rangeDays > 0 ? `${formatShort(rangeFrom)}~${formatShort(found.range.to)} · ${rangeDays}일` : "찾을 날이 없습니다",
    earliestText,
    lines,
    count: filtered.slots.length,
    totalCount: found.slots.length,
    emptyText: filtered.emptyText,
    windowNote: found.windowNote ?? null,
    suggestions,
    readout,
    dows: dowChoices.map((d) => ({ key: d, label: dowLabel(d), pressed: s.dows.includes(d) })),
    bands: bandChoices.map((x) => ({ key: x, label: BAND_LABEL[x], pressed: s.bands.includes(x) })),
    filtered: isFiltered,
    jump: {
      value: s.jump,
      // 휴진일도 고를 수 있게 둔다("그날 되나요?" → 휴진 줄과 그 뒤 첫 칸이 맨 위로).
      options: found.days
        .filter((d) => d.kind === "slots" || d.kind === "closed")
        .filter((d) => !surgery || d.date >= surgeryFrom)
        .map((d) => ({ date: d.date, label: `${formatShort(d.date)}${relDay(today, d.date) ? ` ${relDay(today, d.date)}` : ""}${d.kind === "closed" ? " 휴진" : ""}`, closed: d.kind === "closed" })),
    },
    more: resolved.mode === "move" || days > 180 ? null : { days: engine.rules.searchDays.more },
  };

  if (s.selected) view.sheet = sheetFor(input, svc.key, found.slots, live, s.selected);
  return view;
}

/**
 * 누른 칸의 시트. 빈 칸이면 가예약 전, 이 기기의 가예약 칸이면 가예약 뒤(옮길 한 줄·되돌리기).
 * 가예약 칸의 안내 문장은 그 가예약을 뺀 채로 다시 찾은 칸으로 만든다(입금 즉시 확인 필요 같은 표시가 같게).
 * 둘 다 아니면(거르개를 바꿔 사라진 칸 등) null.
 */
function sheetFor(input: CallInput, service: string, freeSlots: Slot[], live: Hold[], sel: { date: LocalDate; start: string }): SheetView | null {
  const { engine, schedule, nowMs } = input;
  const today = kstDateOf(nowMs);
  const svc = engine.rules.services[service];
  const hold = live.find((h) => h.service === service && h.date === sel.date && h.start === sel.start) ?? null;
  let slot = freeSlots.find((x) => x.date === sel.date && x.start === sel.start) ?? null;
  if (!slot && hold) {
    const again = findSlots(engine, { service, nowMs, schedule, holds: live.filter((h) => h.id !== hold.id), days: Math.max(1, diffDays(today, sel.date) + 1) });
    if (again.ok) slot = again.slots.find((x) => x.date === sel.date && x.start === sel.start) ?? null;
  }
  if (!slot) return null;
  const draft: Hold = hold ?? { id: "-", service, date: sel.date, start: sel.start, createdAt: formatKstIso(nowMs), memo: "" };
  return {
    date: sel.date,
    start: sel.start,
    end: endOf(engine, service, sel.start),
    title: `${formatShort(sel.date)} ${sel.start}~${endOf(engine, service, sel.start)}`,
    rel: relDay(today, sel.date),
    serviceLabel: svc.label,
    deposit: svc.deposit !== null,
    accountNote: accountNote(engine, service),
    free: hold === null,
    hold,
    holdState: hold ? holdState(engine, hold, nowMs) : null,
    holdUntil: hold ? formatExpiry(engine, hold) : "",
    tags: slot.tags,
    readout: composeReadout(engine, { service, slots: [slot], today }),
    confirmation: composeConfirmation(engine, { service, date: sel.date, start: sel.start }),
    holdLine: hold ? composeHoldLine(engine, hold) : null,
    wouldHoldUntil: formatExpiry(engine, draft),
  };
}

// ── 이 기기의 가예약 목록 ────────────────────────────────────────

export interface HoldRow {
  hold: Hold;
  serviceLabel: string;
  when: string;
  state: HoldState;
  until: string;
  line: Composed;
}

/** 기준 시각에 살아 있는 가예약(곧 풀림 포함), 날짜·시각 순. */
export function holdRows(engine: Engine, holds: Hold[], nowMs: number): HoldRow[] {
  return liveHolds(engine, holds, nowMs)
    .slice()
    .sort((a, b) => (a.date === b.date ? (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) : a.date < b.date ? -1 : 1))
    .map((h) => ({
      hold: h,
      serviceLabel: engine.rules.services[h.service]?.label ?? h.service,
      when: `${formatShort(h.date)} ${h.start}`,
      state: holdState(engine, h, nowMs),
      until: formatExpiry(engine, h),
      line: composeHoldLine(engine, h),
    }));
}

// ── 조작 수(PRD 7절, 설계상 값) ──────────────────────────────────

export interface PressPath {
  /** "상담 → 예, 처음" */
  path: string;
  service: string;
  redirect: boolean;
  /** 버튼을 누르기 시작해 첫 빈 시간이 보일 때까지 누름 수. */
  presses: number;
}

/**
 * B01 intake의 모든 버튼·하위 칩·대답 길을 실제 callReducer로 눌러 보며, 빈 시간 목록이 처음 보일 때까지의 누름 수를 센다.
 * 회차 옮기기는 예정일 고르기(오늘 + 7일)를 한 번 더 누른다.
 */
export function pressPaths(input: CallInput): PressPath[] {
  const { engine } = input;
  const out: PressPath[] = [];
  const today = kstDateOf(input.nowMs);
  const run = (actions: CallAction[], labels: string[]) => {
    let s = INITIAL_CALL;
    let presses = 0;
    let view = callView(input, s);
    for (const a of actions) {
      if (view.result) break;
      s = callReducer(s, a);
      presses++;
      view = callView(input, s);
    }
    if (!view.result && view.move) {
      s = callReducer(s, { type: "moveDue", date: addDays(today, 7) });
      presses++;
      view = callView(input, s);
    }
    out.push({ path: labels.join(" → "), service: view.result?.service.label ?? "(목록 없음)", redirect: Boolean(view.result?.redirect), presses: view.result ? presses : -1 });
  };
  for (const b of engine.rules.intake) {
    if (b.subs) {
      for (const sub of b.subs) for (const a of sub.answers) run([{ type: "button", key: b.key }, { type: "sub", key: sub.key }, { type: "answer", key: a.key }], [b.label, sub.label, a.label]);
    } else {
      for (const a of b.answers ?? []) run([{ type: "button", key: b.key }, { type: "answer", key: a.key }], [b.label, a.label]);
    }
  }
  return out;
}
