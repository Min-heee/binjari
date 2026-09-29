/**
 * 읽어 줄 안내 문장·확정 문자·예약 프로그램에 옮길 한 줄(PRD F6·F7).
 *
 * 문장은 B01 templates(AI가 새로 쓴 [가정] 문장)에 **칸만** 채운다. 없는 칸은 오류다 — 빈칸이나 "{{slot1}}"이 그대로 읽히는 것보다
 * 만들지 않는 편이 낫다. 금액은 V03 가격표 값만 쓴다. 칸을 채운 **뒤의** 전체 문장을 광고 표현 검사(V15)에 한 번 더 넣는다.
 *
 * 안내 문장은 "비어 있는 시간 안내"이지 확정이 아니다: 첫 줄은 "지금 비어 있는 시간을 말씀드릴게요", 끝에는 V04의 확정 조건을 붙인다.
 * '가예약'이라는 말은 고객에게 읽는 문장에 넣지 않는다(시험으로 확인). 확정 문자는 입금을 확인한 사람이 보낸다(보내지 않는다).
 */

import { checkAdExpressions, type AdCheckResult } from "./adcheck";
import { addDays, dayOfWeek, diffDays, DOW_KO, formatShort, parseHhmm, type LocalDate } from "./calendar";
import type { Engine } from "./engine";
import { formatExpiry, type Hold } from "./holds";
import { maskPii } from "./mask";
import { templateSlots, TEMPLATE_SLOTS, type TemplateSlot } from "./rules";
import type { Slot } from "./slots";

export type SlotValues = Partial<Record<TemplateSlot, string>>;
export type FillResult = { ok: true; text: string } | { ok: false; errors: string[] };

export function fillTemplate(template: string, values: SlotValues): FillResult {
  const errors: string[] = [];
  for (const slot of templateSlots(template)) {
    if (!(TEMPLATE_SLOTS as readonly string[]).includes(slot)) errors.push(`모르는 칸입니다: {{${slot}}}`);
    else {
      const v = values[slot as TemplateSlot];
      if (v === undefined || v.trim() === "") errors.push(`칸 값이 없습니다: {{${slot}}}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, text: template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, slot: string) => values[slot as TemplateSlot]!) };
}

/** "30,000원" */
export function formatWon(n: number): string {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

/**
 * "오전 10시 30분" · "낮 12시" · "오후 2시" · (eveningFrom을 주면 그 시각부터) "저녁 8시"(PRD 5.2 시각 읽기[가정]).
 * 저녁 경계는 B01 bands.eveningFrom을 받는다 — 말로는 "오후 8시"보다 "저녁 8시"가 자연스럽다(상담실장 점검).
 */
export function readTime(hhmm: string, eveningFrom?: string): string {
  const m = parseHhmm(hhmm);
  if (m === null) throw new Error(`시각 형식이 틀렸습니다: ${hhmm}`);
  const ef = eveningFrom === undefined ? null : parseHhmm(eveningFrom);
  if (eveningFrom !== undefined && ef === null) throw new Error(`저녁 경계 형식이 틀렸습니다: ${eveningFrom}`);
  const h = Math.floor(m / 60);
  const mi = m % 60;
  const head = h < 12 ? `오전 ${h}시` : h === 12 ? "낮 12시" : ef !== null && m >= ef ? `저녁 ${h - 12}시` : `오후 ${h - 12}시`;
  return mi === 0 ? head : `${head} ${mi}분`;
}

/** "내일 9월 22일 화요일" — 오늘·내일·모레는 앞에 붙인다(달력 날짜 기준). */
export function readDate(today: LocalDate, d: LocalDate): string {
  const rel = ["오늘", "내일", "모레"][diffDays(today, d)];
  const body = `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 ${DOW_KO[dayOfWeek(d)]}요일`;
  return rel ? `${rel} ${body}` : body;
}

/** "9월 22일(화)" — 확정 문자처럼 글로 보내는 날짜. */
export function writeDate(d: LocalDate): string {
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일(${DOW_KO[dayOfWeek(d)]})`;
}

export type Composed = { ok: true; text: string; lines: string[]; ad: AdCheckResult } | { ok: false; errors: string[] };

function tpl(engine: Engine, key: string, values: SlotValues): FillResult {
  const t = engine.rules.templates[key];
  if (t === undefined) return { ok: false, errors: [`문장 틀이 없습니다: ${key}`] };
  return fillTemplate(t, values);
}

function finish(engine: Engine, parts: FillResult[]): Composed {
  const errors = parts.flatMap((p) => (p.ok ? [] : p.errors));
  if (errors.length > 0) return { ok: false, errors };
  const lines = parts.map((p) => (p as { text: string }).text);
  const text = lines.join(" ");
  return { ok: true, text, lines, ad: checkAdExpressions(text, engine.ad) };
}

/**
 * 읽어 줄 안내 문장(F6). 칸은 suggestSlots로 고른 칸(1~2개). 순서:
 * 첫 줄 → 비어 있는 시간 → 안건 안내 → (예약금 안건) 예약금 → 확정 조건 **한 문장**.
 * 확정 조건: 수술은 입금 + 의료진 일정 확인, 예약금 안건은 입금 확인 뒤 1영업일 안 확정 연락(오늘·다음 영업일 칸이 있으면
 * "가까운 날짜라 입금을 바로 확인"), 예약금 없는 안건은 확정 연락. 같은 뜻을 두 번 읽지 않게 한 문장으로 합쳤다(상담실장 점검).
 * 입금 계좌 자리표시는 문장에 넣지 않는다 — 화면이 문장 밖에 따로 보인다(accountNote).
 */
export function composeReadout(engine: Engine, args: { service: string; slots: Slot[]; today: LocalDate }): Composed {
  const s = engine.rules.services[args.service];
  if (!s || !s.bookable) return { ok: false, errors: [`모르는 안건입니다: ${args.service}`] };
  if (args.slots.length === 0) return { ok: false, errors: ["제안할 빈 시간이 없습니다"] };
  const ef = engine.rules.bands.eveningFrom;
  const say = (x: Slot) => sayTime(engine, args.today, x);
  const parts: FillResult[] = [tpl(engine, "readout-open", {})];
  if (args.slots.length >= 2) {
    const [a, b] = args.slots;
    // 같은 날 두 칸이면 날짜를 두 번 읽지 않는다("…오전 11시, 또는 같은 날 오후 2시").
    parts.push(tpl(engine, "readout-two", { slot1: say(a), slot2: a.date === b.date ? `같은 날 ${readTime(b.start, ef)}` : say(b) }));
  } else parts.push(tpl(engine, "readout-one", { slot1: say(args.slots[0]) }));
  parts.push(tpl(engine, `readout-service-${s.key}`, { minutes: String(s.minutes) }));
  if (s.deposit !== null) {
    const price = engine.prices[s.deposit];
    if (!price) return { ok: false, errors: [`V03 가격표에 ${s.deposit}가 없습니다`] };
    parts.push(tpl(engine, `readout-deposit-${s.key}`, { deposit: formatWon(price.price) }));
    // 수술은 의료진 확인까지 한 문장. 그 밖에는 오늘·다음 영업일 칸이 하나라도 있으면 "1영업일 안에"를 빼고 가까운 날짜 문장(PRD F6·C4).
    const close = s.earliest === "surgery" ? "readout-close-surgery" : args.slots.some((x) => x.urgentDeposit) ? "readout-close-deposit-near" : "readout-close-deposit";
    parts.push(tpl(engine, close, {}));
  } else parts.push(tpl(engine, "readout-close-no-deposit", {}));
  return finish(engine, parts);
}

/** "내일 9월 22일 화요일 오전 10시 30분" */
export function sayTime(engine: Engine, today: LocalDate, x: { date: LocalDate; start: string }): string {
  return `${readDate(today, x.date)} ${readTime(x.start, engine.rules.bands.eveningFrom)}`;
}

/** 입금 계좌 자리표시(문장 밖에 따로 보임). 예약금 없는 안건은 null. */
export function accountNote(engine: Engine, service: string): string | null {
  const s = engine.rules.services[service];
  return s && s.deposit !== null ? engine.rules.templates["account-placeholder"] : null;
}

/**
 * 휴진 줄에서 읽어 줄 한 문장("추석 중에 되나요?"에 답하기). 휴진 구간과 사유, 그 뒤 가장 가까운 빈 시간(없으면 뺌).
 * "9월 24일 목요일부터 9월 27일 일요일까지는 휴진입니다(추석 연휴·일요일). 가장 가까운 빈 시간은 9월 28일 월요일 오전 10시입니다."
 */
export function composeClosed(engine: Engine, args: { from: LocalDate; to: LocalDate; reason: string; next: { date: LocalDate; start: string } | null; today: LocalDate }): Composed {
  const range = args.from === args.to ? `${readDate(args.today, args.from)}은` : `${readDate(args.today, args.from)}부터 ${readDate(args.today, args.to)}까지는`;
  if (!args.next) return finish(engine, [tpl(engine, "readout-closed-none", { range, reason: args.reason })]);
  return finish(engine, [tpl(engine, "readout-closed", { range, reason: args.reason, slot1: sayTime(engine, args.today, args.next) })]);
}

/** 확정 문자(입금 확인 뒤 사람이 보냄). 칸: 날짜·시각·소요 분·병원 전화·(수술) 다음 날 내원일. */
export function composeConfirmation(engine: Engine, args: { service: string; date: LocalDate; start: string }): Composed {
  const s = engine.rules.services[args.service];
  if (!s || !s.bookable) return { ok: false, errors: [`모르는 안건입니다: ${args.service}`] };
  const values: SlotValues = {
    date: writeDate(args.date),
    time: readTime(args.start, engine.rules.bands.eveningFrom),
    minutes: String(s.minutes),
    clinicPhone: engine.rules.clinicPhone,
    ...(s.earliest === "surgery" ? { nextDay: writeDate(addDays(args.date, 1)) } : {}),
  };
  return finish(engine, [tpl(engine, `confirm-${s.key}`, values)]);
}

/** 예약 프로그램에 옮겨 적을 한 줄(직원용, F7). 메모는 한 번 더 가린다. */
export function composeHoldLine(engine: Engine, hold: Hold): Composed {
  const s = engine.rules.services[hold.service];
  if (!s) return { ok: false, errors: [`모르는 안건입니다: ${hold.service}`] };
  const start = parseHhmm(hold.start)!;
  const end = start + s.minutes;
  const memo = maskPii(hold.memo).masked.trim();
  return finish(engine, [
    tpl(engine, s.deposit === null ? "hold-line-no-deposit" : "hold-line", {
      date: `${hold.date}(${formatShort(hold.date).slice(-2, -1)})`,
      start: hold.start,
      end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      service: s.label,
      until: formatExpiry(engine, hold),
      memo: memo === "" ? "-" : memo,
    }),
  ]);
}
