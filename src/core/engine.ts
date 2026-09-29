/**
 * 볼트 문서 → 계산에 쓰는 값 한 묶음(Engine). PRD F2.
 *
 * 규칙은 볼트 문서 json에서만 읽는다: 진료시간·점심·휴진(V02), 예약 칸 규칙(B01), 공휴일(B02), 예약금(V03), 광고 표현(V15).
 * 근거로 인용하는 문서(V01·V04~V09)도 승인 상태여야 한다. 하나라도 없거나 깨지면 전체를 멈춘다 —
 * 일부 규칙만으로 빈 시간을 내면 "빠진 규칙 때문에 잘못 낸 칸"이 보이지 않는다.
 *
 * B01만 `status: draft` + `assumption: true` 예외로 받는다(PRD 5.1). 그때 assumptionRules = true이고 화면은 [가정] 띠를 붙인다.
 * 파일 읽기와 오늘 날짜(asOf)는 호출하는 쪽 몫이다.
 */

import { checkAdExpressions, parseAdConfig, type AdConfig } from "./adcheck";
import { buildCalendar, isLocalDate, parseClinicHours, type ClinicCalendar, type ClinicHours, type Holiday, type LocalDate } from "./calendar";
import { parseRules, type SlotRules } from "./rules";
import { activeJson, loadVault } from "./vault";

export interface Price {
  key: string;
  label: string;
  price: number;
}

export interface Engine {
  rules: SlotRules;
  calendar: ClinicCalendar;
  hours: ClinicHours;
  prices: Record<string, Price>;
  ad: AdConfig;
  /** B01이 [가정] 초안 예외로 들어왔나(화면 위 "[가정] 규칙 — 병원 확인 전" 띠). */
  assumptionRules: boolean;
  holidaysCheckedOn: LocalDate;
}

export type EngineResult = { ok: true; engine: Engine } | { ok: false; errors: string[] };

export const RULES_DOC_ID = "B01";
export const HOLIDAYS_DOC_ID = "B02";
/** 문장·안내에서 근거로 인용하는 문서. json 값을 읽지 않아도 승인 상태여야 인용할 수 있다. */
export const EVIDENCE_DOC_IDS = ["V01", "V04", "V05", "V06", "V07", "V08", "V09"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type HolidaysResult =
  | { ok: true; holidays: Holiday[]; coverage: { from: LocalDate; to: LocalDate; checkedOn: LocalDate } }
  | { ok: false; errors: string[] };

/** B02 json: { timezone, holidaysCoverage: { from, to, checkedOn }, holidays: [{ date, name }] }. */
export function parseHolidays(json: unknown): HolidaysResult {
  const errors: string[] = [];
  if (!isObj(json)) return { ok: false, errors: ["B02 json이 객체가 아닙니다"] };
  for (const k of Object.keys(json)) if (!["timezone", "holidaysCoverage", "holidays"].includes(k)) errors.push(`B02 모르는 키입니다: ${k}`);
  if (json.timezone !== "Asia/Seoul") errors.push(`B02 timezone은 Asia/Seoul이어야 합니다: ${String(json.timezone)}`);
  const hc = json.holidaysCoverage;
  let coverage = { from: "" as LocalDate, to: "" as LocalDate, checkedOn: "" as LocalDate };
  if (!isObj(hc) || !isLocalDate(hc.from) || !isLocalDate(hc.to) || !isLocalDate(hc.checkedOn) || hc.from > hc.to || Object.keys(hc).length !== 3) {
    errors.push("B02 holidaysCoverage는 { from ≤ to, checkedOn } 날짜여야 합니다");
  } else coverage = { from: hc.from, to: hc.to, checkedOn: hc.checkedOn };
  const holidays: Holiday[] = [];
  if (!Array.isArray(json.holidays) || json.holidays.length === 0) errors.push("B02 holidays가 비어 있습니다");
  else {
    const seen = new Set<string>();
    json.holidays.forEach((h, i) => {
      if (!isObj(h) || !isLocalDate(h.date) || typeof h.name !== "string" || h.name.trim() === "" || Object.keys(h).length !== 2) {
        return errors.push(`B02 holidays[${i}]는 { date, name }이어야 합니다`);
      }
      if (seen.has(h.date)) errors.push(`B02 holidays에 같은 날짜가 두 번 있습니다: ${h.date}`);
      seen.add(h.date);
      if (coverage.from !== "" && (h.date < coverage.from || h.date > coverage.to)) errors.push(`B02 holidays[${i}] ${h.date}가 확인 기간 밖입니다`);
      holidays.push({ date: h.date, name: h.name });
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, holidays: [...holidays].sort((a, b) => (a.date < b.date ? -1 : 1)), coverage };
}

/** V03 가격표 json(배열). 키가 겹치거나 금액이 정수가 아니면 거부한다. */
export function parsePrices(json: unknown): { ok: true; prices: Record<string, Price> } | { ok: false; errors: string[] } {
  if (!Array.isArray(json)) return { ok: false, errors: ["V03 json이 배열이 아닙니다"] };
  const prices: Record<string, Price> = {};
  const errors: string[] = [];
  json.forEach((p, i) => {
    if (!isObj(p) || typeof p.key !== "string" || typeof p.label !== "string" || typeof p.price !== "number" || !Number.isInteger(p.price) || p.price < 0) {
      return errors.push(`V03 [${i}] 모양이 틀렸습니다`);
    }
    if (p.key in prices) errors.push(`V03 키가 겹칩니다: ${p.key}`);
    prices[p.key] = { key: p.key, label: p.label, price: p.price };
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, prices };
}

export function loadEngine(files: { path: string; raw: string }[], asOf: LocalDate): EngineResult {
  const vault = loadVault(files, { asOf, allowAssumptionDraft: [RULES_DOC_ID] });
  const errors = [...vault.errors];

  for (const id of EVIDENCE_DOC_IDS) if (!vault.active.some((d) => d.meta.id === id)) errors.push(`${id}: 승인된 문서가 없습니다`);

  const v02 = activeJson(vault, "V02");
  const b01 = activeJson(vault, RULES_DOC_ID);
  const b02 = activeJson(vault, HOLIDAYS_DOC_ID);
  const v03 = activeJson(vault, "V03");
  const v15 = activeJson(vault, "V15");
  for (const j of [v02, b01, b02, v03, v15]) if (!j.ok) errors.push(j.error);
  if (!v02.ok || !b01.ok || !b02.ok || !v03.ok || !v15.ok) return { ok: false, errors };

  const hours = parseClinicHours(v02.value);
  const rules = parseRules(b01.value);
  const hol = parseHolidays(b02.value);
  const prices = parsePrices(v03.value);
  const ad = parseAdConfig(v15.value);
  if (!hours.ok) errors.push(...hours.errors);
  if (!rules.ok) errors.push(...rules.errors.map((e) => `B01: ${e}`));
  if (!hol.ok) errors.push(...hol.errors);
  if (!prices.ok) errors.push(...prices.errors);
  if (!ad.ok) errors.push(ad.error);
  if (errors.length > 0 || !hours.ok || !rules.ok || !hol.ok || !prices.ok || !ad.ok) return { ok: false, errors };

  // 문서끼리 맞는지: 예약금 키가 V03에 있는가, 문장 틀·안내가 광고 표현 검사를 통과하는가(PRD F6).
  for (const s of Object.values(rules.rules.services)) {
    if (s.deposit !== null && !(s.deposit in prices.prices)) errors.push(`B01: services.${s.key}.deposit ${s.deposit}가 V03 가격표에 없습니다`);
  }
  const texts: [string, string][] = [
    ...Object.entries(rules.rules.templates).map(([k, t]) => [`templates.${k}`, t] as [string, string]),
    ...Object.values(rules.rules.services).flatMap((s) => s.notes.map((n, i) => [`services.${s.key}.notes[${i}]`, n] as [string, string])),
    ["scopeLine", rules.rules.scopeLine],
  ];
  for (const [where, t] of texts) {
    const r = checkAdExpressions(t, ad.config);
    // 주의 표현(warn)도 멈춘다: 틀은 고정 문장이라 사람이 보고 고칠 수 있고, 통화 중에 직원이 확인할 틈이 없다.
    if (r.level !== "clean") errors.push(`B01: ${where}에 광고 표현이 있습니다(${r.hits.map((h) => h.matchedText).join(", ")})`);
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    engine: {
      rules: rules.rules,
      calendar: buildCalendar(hours.hours, hol.holidays, { from: hol.coverage.from, to: hol.coverage.to }),
      hours: hours.hours,
      prices: prices.prices,
      ad: ad.config,
      assumptionRules: vault.assumed.includes(RULES_DOC_ID),
      holidaysCheckedOn: hol.coverage.checkedOn,
    },
  };
}
