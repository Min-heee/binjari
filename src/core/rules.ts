/**
 * B01 '예약 칸 규칙' json 읽기·검증(PRD F2, 5절).
 *
 * 받는 모양만 받고 나머지는 거부한다. 기본값을 채우지 않는다: 값이 빠진 규칙으로 빈 시간을 내면
 * "왜 이 시간이 떴나"를 문서로 따라갈 수 없다. 오류는 모아서 한 번에 돌려준다(한 번 고치고 다시 돌려 보는 일을 줄이려고).
 *
 * 이 파일은 모양만 본다. 다른 문서와 맞는지(예약금 키가 V03에 있는지, 문장 틀이 광고 표현 검사를 통과하는지)는 engine.ts가 본다.
 */

import { DOW_KEYS, parseHhmm, type DowKey } from "./calendar";

export const REASON_KEYS = [
  "closed",
  "holiday-unknown",
  "no-surgery-day",
  "next-day-closed",
  "no-d7-open-day",
  "outside-window",
  "before-earliest",
  "after-last-entry",
  "past-close",
  "lunch",
  "daily-max",
  "held",
  "resource",
] as const;
export type ReasonKey = (typeof REASON_KEYS)[number];

/** 문장 틀에 쓸 수 있는 칸. 모르는 칸이 든 틀은 거부한다(빈칸이 그대로 고객에게 읽히지 않게). */
export const TEMPLATE_SLOTS = ["slot1", "slot2", "minutes", "deposit", "range", "reason", "date", "start", "end", "service", "until", "memo", "time", "clinicPhone", "nextDay"] as const;
export type TemplateSlot = (typeof TEMPLATE_SLOTS)[number];

export interface Phase {
  from: number;
  to: number;
  use: Record<string, number>;
}

export interface ServiceRule {
  key: string;
  label: string;
  /** false면 버튼으로 잡지 않는다(기존 예약의 자원 점유를 셀 때만 쓴다 — 수술 후 경과 진료). */
  bookable: boolean;
  minutes: number;
  phases: Phase[];
  /** "grid"면 여는 시각 기준 slotMinutes 격자, 목록이면 그 시각들만(수술). */
  starts: "grid" | string[];
  /** "avoid"면 점심과 겹치는 칸을 내지 않고, "through"면 점심을 가로질러 진행한다(수술). */
  lunch: "avoid" | "through";
  /** "lead"면 기준 시각 + leadMinutes 이후, "surgery"면 기준일 + surgeryMinDaysAhead일 이후 + 수술 날 조건. */
  earliest: "lead" | "surgery";
  /** V03 가격표의 예약금 키. 없으면 null. */
  deposit: string | null;
  notes: string[];
}

export interface IntakeAnswer {
  key: string;
  label: string;
  service: string;
  /** 있으면 "첫 상담으로 바뀜" — 화면에 이 까닭을 보인다(F1). */
  redirect?: string;
  /** 고를 수 있는 수술 크기(첫 값이 기본값). */
  sizes?: string[];
  /** "move"면 두피 주사 회차 옮기기(예정일 앞뒤 창). */
  mode?: "move";
  notes: string[];
}

export interface IntakeQuestion {
  key: string;
  label: string;
  question: string;
  answers: IntakeAnswer[];
}

export interface IntakeButton {
  key: string;
  label: string;
  hint?: string;
  /** 버튼을 누르면 바로 묻는 질문(상담·재시술). */
  question?: string;
  answers?: IntakeAnswer[];
  /** 하위 선택(시술 → 수술·주사·관리). */
  subs?: IntakeQuestion[];
}

export interface SlotRules {
  clinicPhone: string;
  slotMinutes: number;
  leadMinutes: number;
  surgeryMinDaysAhead: number;
  searchDays: { default: number; surgery: number; more: number };
  bands: { morningBefore: string; eveningFrom: string };
  resources: Record<string, string>;
  capacity: {
    base: Record<string, number>;
    overrides: { days: DowKey[]; from: string; to: string; set: Record<string, number> }[];
  };
  buffers: Record<string, { before: number; after: number }>;
  services: Record<string, ServiceRule>;
  surgeryFollowUps: { nextDayMustBeOpen: boolean; d7Window: { from: number; to: number } };
  surgeryCancelNoticeDays: number;
  dailyMax: { service: string; max: number; counts: string[] }[];
  injectionMoveWindow: { before: number; after: number; outsideNote: string };
  injectionProgram: { intervalDays: number; sessions: number };
  hold: { until: "next-open-day-close"; capAtSlotStart: boolean; warnMinutesBefore: number };
  businessDaysIncludeSaturday: boolean;
  suggestCount: number;
  reasonOrder: ReasonKey[];
  scopeLine: string;
  intake: IntakeButton[];
  templates: Record<string, string>;
}

export type RulesResult = { ok: true; rules: SlotRules } | { ok: false; errors: string[] };

const TOP_KEYS = [
  "timezone",
  "clinicPhone",
  "slotMinutes",
  "leadMinutes",
  "surgeryMinDaysAhead",
  "searchDays",
  "bands",
  "resources",
  "capacity",
  "buffers",
  "services",
  "surgeryFollowUps",
  "surgeryCancelNoticeDays",
  "dailyMax",
  "injectionMoveWindow",
  "injectionProgram",
  "hold",
  "businessDaysIncludeSaturday",
  "suggestCount",
  "reasonOrder",
  "scopeLine",
  "intake",
  "templates",
] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** 모양 검사 도우미: 키 목록이 정확히 맞는지(빠진 키·모르는 키 모두 오류). optional은 없어도 된다. */
function keysExactly(o: Record<string, unknown>, required: readonly string[], where: string, errors: string[], optional: readonly string[] = []) {
  for (const k of required) if (!(k in o)) errors.push(`${where}.${k}가 없습니다`);
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) errors.push(`${where} 모르는 키입니다: ${k}`);
}

export function templateSlots(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]);
}

/** 반드시 있어야 하는 문장 틀. 안건별 틀은 parseRules가 services를 보고 더 요구한다. */
export const REQUIRED_TEMPLATES = [
  "readout-open",
  "readout-two",
  "readout-one",
  "readout-close-deposit",
  "readout-close-deposit-near",
  "readout-close-no-deposit",
  "readout-close-surgery",
  "readout-closed",
  "readout-closed-none",
  "account-placeholder",
  "hold-line",
  "hold-line-no-deposit",
] as const;

function parseCounts(v: unknown, where: string, resources: Set<string>, errors: string[], allowZero: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v) || Object.keys(v).length === 0) {
    errors.push(`${where}는 비어 있지 않은 { 자원: 수 }여야 합니다`);
    return out;
  }
  for (const [k, n] of Object.entries(v)) {
    if (!resources.has(k)) errors.push(`${where} 모르는 자원입니다: ${k}`);
    else if (!isInt(n, allowZero ? 0 : 1, 99)) errors.push(`${where}.${k}는 ${allowZero ? 0 : 1}~99 정수여야 합니다: ${String(n)}`);
    else out[k] = n;
  }
  return out;
}

function parseService(key: string, v: unknown, resources: Set<string>, errors: string[]): ServiceRule | null {
  const where = `services.${key}`;
  if (!isObj(v)) {
    errors.push(`${where}가 객체가 아닙니다`);
    return null;
  }
  const n0 = errors.length;
  keysExactly(v, ["label", "bookable", "minutes", "phases", "starts", "lunch", "earliest", "deposit", "notes"], where, errors);
  if (!isText(v.label)) errors.push(`${where}.label이 비었습니다`);
  if (typeof v.bookable !== "boolean") errors.push(`${where}.bookable은 true/false여야 합니다`);
  if (!isInt(v.minutes, 5, 720)) errors.push(`${where}.minutes는 5~720 정수여야 합니다: ${String(v.minutes)}`);
  const minutes = isInt(v.minutes, 5, 720) ? v.minutes : 0;

  const phases: Phase[] = [];
  if (!Array.isArray(v.phases) || v.phases.length === 0) errors.push(`${where}.phases가 비어 있습니다`);
  else {
    v.phases.forEach((p, i) => {
      const pw = `${where}.phases[${i}]`;
      if (!isObj(p)) return errors.push(`${pw}가 객체가 아닙니다`);
      keysExactly(p, ["from", "to", "use"], pw, errors);
      if (!isInt(p.from, 0, 720) || !isInt(p.to, 1, 720) || p.from >= p.to || p.to > minutes) {
        return errors.push(`${pw} 구간이 틀렸습니다(0 ≤ from < to ≤ minutes): ${String(p.from)}~${String(p.to)}`);
      }
      phases.push({ from: p.from, to: p.to, use: parseCounts(p.use, `${pw}.use`, resources, errors, false) });
    });
  }

  let starts: ServiceRule["starts"] = "grid";
  if (v.starts === "grid") starts = "grid";
  else if (Array.isArray(v.starts) && v.starts.length > 0 && v.starts.every((s) => typeof s === "string" && parseHhmm(s) !== null)) {
    const list = v.starts as string[];
    if (new Set(list).size !== list.length || list.some((s, i) => i > 0 && s <= list[i - 1])) errors.push(`${where}.starts는 겹치지 않고 오름차순이어야 합니다`);
    starts = list;
  } else errors.push(`${where}.starts는 "grid"나 "HH:MM" 목록이어야 합니다`);

  if (v.lunch !== "avoid" && v.lunch !== "through") errors.push(`${where}.lunch는 avoid 또는 through여야 합니다: ${String(v.lunch)}`);
  if (v.earliest !== "lead" && v.earliest !== "surgery") errors.push(`${where}.earliest는 lead 또는 surgery여야 합니다: ${String(v.earliest)}`);
  if (v.deposit !== null && !isText(v.deposit)) errors.push(`${where}.deposit은 V03 가격 키이거나 null이어야 합니다`);
  if (!Array.isArray(v.notes) || !v.notes.every(isText)) errors.push(`${where}.notes는 글자 배열이어야 합니다`);
  if (errors.length > n0) return null;
  return {
    key,
    label: v.label as string,
    bookable: v.bookable as boolean,
    minutes,
    phases,
    starts,
    lunch: v.lunch as ServiceRule["lunch"],
    earliest: v.earliest as ServiceRule["earliest"],
    deposit: v.deposit as string | null,
    notes: v.notes as string[],
  };
}

function parseAnswers(v: unknown, where: string, services: Record<string, ServiceRule>, errors: string[]): IntakeAnswer[] {
  const out: IntakeAnswer[] = [];
  if (!Array.isArray(v) || v.length < 2) {
    errors.push(`${where}.answers는 둘 이상이어야 합니다`);
    return out;
  }
  const seen = new Set<string>();
  v.forEach((a, i) => {
    const aw = `${where}.answers[${i}]`;
    if (!isObj(a)) return errors.push(`${aw}가 객체가 아닙니다`);
    keysExactly(a, ["key", "label", "service"], aw, errors, ["redirect", "sizes", "mode", "notes"]);
    if (!isText(a.key) || seen.has(a.key)) errors.push(`${aw}.key가 비었거나 겹칩니다`);
    else seen.add(a.key);
    if (!isText(a.label)) errors.push(`${aw}.label이 비었습니다`);
    const svc = typeof a.service === "string" ? services[a.service] : undefined;
    if (!svc || !svc.bookable) errors.push(`${aw}.service가 버튼으로 잡는 안건이 아닙니다: ${String(a.service)}`);
    if (a.redirect !== undefined && !isText(a.redirect)) errors.push(`${aw}.redirect가 비었습니다`);
    if (a.sizes !== undefined) {
      if (!Array.isArray(a.sizes) || a.sizes.length < 2 || a.sizes[0] !== a.service || !a.sizes.every((s) => typeof s === "string" && services[s]?.bookable)) {
        errors.push(`${aw}.sizes는 둘 이상의 안건이고 첫 값이 service(기본값)여야 합니다`);
      }
    }
    if (a.mode !== undefined && a.mode !== "move") errors.push(`${aw}.mode는 move만 받습니다: ${String(a.mode)}`);
    if (a.notes !== undefined && (!Array.isArray(a.notes) || !a.notes.every(isText))) errors.push(`${aw}.notes는 글자 배열이어야 합니다`);
    out.push({
      key: String(a.key),
      label: String(a.label),
      service: String(a.service),
      ...(a.redirect !== undefined ? { redirect: String(a.redirect) } : {}),
      ...(Array.isArray(a.sizes) ? { sizes: a.sizes as string[] } : {}),
      ...(a.mode === "move" ? { mode: "move" as const } : {}),
      notes: Array.isArray(a.notes) ? (a.notes as string[]) : [],
    });
  });
  return out;
}

function parseIntake(v: unknown, services: Record<string, ServiceRule>, errors: string[]): IntakeButton[] {
  const out: IntakeButton[] = [];
  if (!Array.isArray(v) || v.length === 0) {
    errors.push("intake가 비어 있습니다");
    return out;
  }
  const seen = new Set<string>();
  v.forEach((b, i) => {
    const bw = `intake[${i}]`;
    if (!isObj(b)) return errors.push(`${bw}가 객체가 아닙니다`);
    keysExactly(b, ["key", "label"], bw, errors, ["hint", "question", "answers", "subs"]);
    if (!isText(b.key) || seen.has(b.key)) errors.push(`${bw}.key가 비었거나 겹칩니다`);
    else seen.add(b.key);
    if (!isText(b.label)) errors.push(`${bw}.label이 비었습니다`);
    if (b.hint !== undefined && !isText(b.hint)) errors.push(`${bw}.hint가 비었습니다`);
    const hasQ = b.question !== undefined || b.answers !== undefined;
    if (hasQ === (b.subs !== undefined)) return errors.push(`${bw}는 question+answers와 subs 중 하나만 있어야 합니다`);
    const button: IntakeButton = { key: String(b.key), label: String(b.label), ...(b.hint !== undefined ? { hint: String(b.hint) } : {}) };
    if (hasQ) {
      if (!isText(b.question)) errors.push(`${bw}.question이 비었습니다`);
      button.question = String(b.question);
      button.answers = parseAnswers(b.answers, bw, services, errors);
    } else {
      if (!Array.isArray(b.subs) || b.subs.length === 0) return errors.push(`${bw}.subs가 비어 있습니다`);
      button.subs = [];
      b.subs.forEach((s, j) => {
        const sw = `${bw}.subs[${j}]`;
        if (!isObj(s)) return errors.push(`${sw}가 객체가 아닙니다`);
        keysExactly(s, ["key", "label", "question", "answers"], sw, errors);
        if (!isText(s.key) || !isText(s.label) || !isText(s.question)) errors.push(`${sw}의 key·label·question이 비었습니다`);
        button.subs!.push({ key: String(s.key), label: String(s.label), question: String(s.question), answers: parseAnswers(s.answers, sw, services, errors) });
      });
    }
    out.push(button);
  });
  return out;
}

export function parseRules(json: unknown): RulesResult {
  const errors: string[] = [];
  if (!isObj(json)) return { ok: false, errors: ["B01 json이 객체가 아닙니다"] };
  keysExactly(json, TOP_KEYS, "B01", errors);
  if (json.timezone !== "Asia/Seoul") errors.push(`timezone은 Asia/Seoul이어야 합니다: ${String(json.timezone)}`);
  if (!isText(json.clinicPhone)) errors.push("clinicPhone이 비었습니다");
  if (!isInt(json.slotMinutes, 5, 120) || 60 % (json.slotMinutes as number) !== 0) errors.push(`slotMinutes는 60을 나누는 5~60 정수여야 합니다: ${String(json.slotMinutes)}`);
  if (!isInt(json.leadMinutes, 0, 24 * 60)) errors.push(`leadMinutes는 0~1440 정수여야 합니다: ${String(json.leadMinutes)}`);
  if (!isInt(json.surgeryMinDaysAhead, 0, 90)) errors.push(`surgeryMinDaysAhead는 0~90 정수여야 합니다: ${String(json.surgeryMinDaysAhead)}`);

  const sd = json.searchDays;
  if (!isObj(sd) || !isInt(sd.default, 1, 120) || !isInt(sd.surgery, 1, 120) || !isInt(sd.more, 1, 120) || Object.keys(sd).length !== 3) {
    errors.push("searchDays는 { default, surgery, more } 1~120 정수여야 합니다");
  }
  const bands = json.bands;
  if (!isObj(bands) || typeof bands.morningBefore !== "string" || typeof bands.eveningFrom !== "string" || Object.keys(bands).length !== 2) {
    errors.push("bands는 { morningBefore, eveningFrom }여야 합니다");
  } else {
    const mb = parseHhmm(bands.morningBefore);
    const ef = parseHhmm(bands.eveningFrom);
    if (mb === null || ef === null || mb >= ef) errors.push(`bands 시각이 틀렸습니다: ${bands.morningBefore}, ${bands.eveningFrom}`);
  }

  // 자원
  const resources: Record<string, string> = {};
  if (!isObj(json.resources) || Object.keys(json.resources).length === 0) errors.push("resources가 비어 있습니다");
  else {
    for (const [k, label] of Object.entries(json.resources)) {
      if (!/^[a-z][A-Za-z]*$/.test(k)) errors.push(`resources 키 형식이 틀렸습니다: ${k}`);
      else if (!isText(label)) errors.push(`resources.${k} 이름이 비었습니다`);
      else resources[k] = label;
    }
  }
  const rset = new Set(Object.keys(resources));

  const capacity: SlotRules["capacity"] = { base: {}, overrides: [] };
  const cap = json.capacity;
  if (!isObj(cap)) errors.push("capacity가 객체가 아닙니다");
  else {
    keysExactly(cap, ["base", "overrides"], "capacity", errors);
    capacity.base = parseCounts(cap.base, "capacity.base", rset, errors, true);
    // 모든 자원에 수량이 있어야 한다 — 빠진 자원을 0으로 읽으면 그 자원을 쓰는 안건이 조용히 모두 빠진다.
    for (const r of rset) if (isObj(cap.base) && !(r in cap.base)) errors.push(`capacity.base에 ${r} 수량이 없습니다`);
    if (!Array.isArray(cap.overrides)) errors.push("capacity.overrides가 배열이 아닙니다");
    else {
      cap.overrides.forEach((o, i) => {
        const ow = `capacity.overrides[${i}]`;
        if (!isObj(o)) return errors.push(`${ow}가 객체가 아닙니다`);
        keysExactly(o, ["days", "from", "to", "set"], ow, errors);
        const days = o.days;
        if (!Array.isArray(days) || days.length === 0 || !days.every((d) => (DOW_KEYS as readonly string[]).includes(d as string))) errors.push(`${ow}.days가 요일 배열이 아닙니다`);
        const f = typeof o.from === "string" ? parseHhmm(o.from) : null;
        const t = typeof o.to === "string" ? parseHhmm(o.to) : null;
        if (f === null || t === null || f >= t) errors.push(`${ow} 시각이 틀렸습니다`);
        capacity.overrides.push({ days: days as DowKey[], from: String(o.from), to: String(o.to), set: parseCounts(o.set, `${ow}.set`, rset, errors, true) });
      });
    }
  }

  const buffers: SlotRules["buffers"] = {};
  if (!isObj(json.buffers)) errors.push("buffers가 객체가 아닙니다");
  else {
    for (const [k, b] of Object.entries(json.buffers)) {
      if (!rset.has(k)) errors.push(`buffers 모르는 자원입니다: ${k}`);
      else if (!isObj(b) || !isInt(b.before, 0, 240) || !isInt(b.after, 0, 240) || Object.keys(b).length !== 2) errors.push(`buffers.${k}는 { before, after } 0~240 정수여야 합니다`);
      else buffers[k] = { before: b.before, after: b.after };
    }
  }

  const services: Record<string, ServiceRule> = {};
  if (!isObj(json.services) || Object.keys(json.services).length === 0) errors.push("services가 비어 있습니다");
  else {
    for (const [k, v] of Object.entries(json.services)) {
      if (!/^[a-z][a-z0-9-]*$/.test(k)) {
        errors.push(`services 키 형식이 틀렸습니다: ${k}`);
        continue;
      }
      const s = parseService(k, v, rset, errors);
      if (s) services[k] = s;
    }
  }
  // 버퍼·단계를 붙인 안건이 진료시간(가장 긴 날 11시간)보다 길면 어느 날에도 칸이 없다. 문서 오류로 본다.
  for (const s of Object.values(services)) if (s.minutes > 11 * 60) errors.push(`services.${s.key}.minutes가 하루 진료시간보다 깁니다`);

  const fu = json.surgeryFollowUps;
  if (!isObj(fu) || typeof fu.nextDayMustBeOpen !== "boolean" || !isObj(fu.d7Window) || !isInt(fu.d7Window.from, 1, 30) || !isInt(fu.d7Window.to, 1, 30) || fu.d7Window.from > fu.d7Window.to) {
    errors.push("surgeryFollowUps는 { nextDayMustBeOpen, d7Window: { from ≤ to } }여야 합니다");
  }
  if (!isInt(json.surgeryCancelNoticeDays, 0, 90)) errors.push(`surgeryCancelNoticeDays는 0~90 정수여야 합니다: ${String(json.surgeryCancelNoticeDays)}`);

  const dailyMax: SlotRules["dailyMax"] = [];
  if (!Array.isArray(json.dailyMax)) errors.push("dailyMax가 배열이 아닙니다");
  else {
    json.dailyMax.forEach((d, i) => {
      const dw = `dailyMax[${i}]`;
      if (!isObj(d)) return errors.push(`${dw}가 객체가 아닙니다`);
      keysExactly(d, ["service", "max", "counts"], dw, errors);
      if (typeof d.service !== "string" || !services[d.service]) errors.push(`${dw}.service가 모르는 안건입니다: ${String(d.service)}`);
      if (!isInt(d.max, 1, 99)) errors.push(`${dw}.max는 1~99 정수여야 합니다`);
      if (!Array.isArray(d.counts) || d.counts.length === 0 || !d.counts.every((c) => typeof c === "string" && services[c])) errors.push(`${dw}.counts가 모르는 안건을 셉니다`);
      dailyMax.push({ service: String(d.service), max: d.max as number, counts: (d.counts as string[]) ?? [] });
    });
  }

  const iw = json.injectionMoveWindow;
  if (!isObj(iw) || !isInt(iw.before, 0, 14) || !isInt(iw.after, 0, 14) || !isText(iw.outsideNote) || Object.keys(iw).length !== 3) {
    errors.push("injectionMoveWindow는 { before, after, outsideNote }여야 합니다");
  }
  const ip = json.injectionProgram;
  if (!isObj(ip) || !isInt(ip.intervalDays, 1, 60) || !isInt(ip.sessions, 1, 30) || Object.keys(ip).length !== 2) errors.push("injectionProgram은 { intervalDays, sessions }여야 합니다");

  const hold = json.hold;
  if (!isObj(hold) || hold.until !== "next-open-day-close" || typeof hold.capAtSlotStart !== "boolean" || !isInt(hold.warnMinutesBefore, 0, 24 * 60) || Object.keys(hold).length !== 3) {
    errors.push("hold는 { until: next-open-day-close, capAtSlotStart, warnMinutesBefore }여야 합니다");
  }
  if (typeof json.businessDaysIncludeSaturday !== "boolean") errors.push("businessDaysIncludeSaturday는 true/false여야 합니다");
  if (!isInt(json.suggestCount, 1, 3)) errors.push(`suggestCount는 1~3 정수여야 합니다: ${String(json.suggestCount)}`);

  // 까닭 순서는 아는 까닭을 빠짐없이, 겹치지 않게 모두 적어야 한다(빠진 까닭은 대표 까닭으로 뽑힐 수 없게 된다).
  const ro = json.reasonOrder;
  if (!Array.isArray(ro) || ro.length !== REASON_KEYS.length || new Set(ro).size !== ro.length || !ro.every((r) => (REASON_KEYS as readonly unknown[]).includes(r))) {
    errors.push(`reasonOrder는 ${REASON_KEYS.join(", ")}를 한 번씩 모두 적어야 합니다`);
  }
  if (!isText(json.scopeLine)) errors.push("scopeLine이 비었습니다");

  const intake = parseIntake(json.intake, services, errors);

  const templates: Record<string, string> = {};
  if (!isObj(json.templates)) errors.push("templates가 객체가 아닙니다");
  else {
    for (const [k, t] of Object.entries(json.templates)) {
      if (!isText(t)) {
        errors.push(`templates.${k}가 비었습니다`);
        continue;
      }
      for (const slot of templateSlots(t)) if (!(TEMPLATE_SLOTS as readonly string[]).includes(slot)) errors.push(`templates.${k} 모르는 칸입니다: {{${slot}}}`);
      templates[k] = t;
    }
    const need: string[] = [...REQUIRED_TEMPLATES];
    for (const s of Object.values(services)) {
      if (!s.bookable) continue;
      need.push(`readout-service-${s.key}`, `confirm-${s.key}`);
      if (s.deposit !== null) need.push(`readout-deposit-${s.key}`);
    }
    for (const k of need) if (!(k in templates)) errors.push(`templates.${k}가 없습니다`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    rules: {
      clinicPhone: json.clinicPhone as string,
      slotMinutes: json.slotMinutes as number,
      leadMinutes: json.leadMinutes as number,
      surgeryMinDaysAhead: json.surgeryMinDaysAhead as number,
      searchDays: sd as SlotRules["searchDays"],
      bands: bands as SlotRules["bands"],
      resources,
      capacity,
      buffers,
      services,
      surgeryFollowUps: fu as SlotRules["surgeryFollowUps"],
      surgeryCancelNoticeDays: json.surgeryCancelNoticeDays as number,
      dailyMax,
      injectionMoveWindow: iw as SlotRules["injectionMoveWindow"],
      injectionProgram: ip as SlotRules["injectionProgram"],
      hold: hold as SlotRules["hold"],
      businessDaysIncludeSaturday: json.businessDaysIncludeSaturday as boolean,
      suggestCount: json.suggestCount as number,
      reasonOrder: ro as ReasonKey[],
      scopeLine: json.scopeLine as string,
      intake,
      templates,
    },
  };
}
