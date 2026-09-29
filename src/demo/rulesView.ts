/**
 * 규칙 보기 화면의 값(읽기 전용). 엔진이 **실제로 읽은 값**을 사람이 읽는 줄로 바꾼다 — 화면이 볼트 원문을 다시 해석하지 않게.
 * 원문은 화면 아래에 문서째 싣는다(값과 근거 문장을 나란히 보려고).
 */

import { DOW_KEYS, DOW_KO, formatShort, type DowKey } from "@/core/calendar";
import type { Engine } from "@/core/engine";
import { parseVaultFile } from "@/core/vault";
import { formatWon } from "@/core/message";
import { REASON_LABEL } from "@/core/slots";

const dow = (d: DowKey) => DOW_KO[DOW_KEYS.indexOf(d)];

export interface DocRow {
  id: string;
  title: string;
  path: string;
  status: string;
  assumption: boolean;
  approvedBy: string;
  use: string;
  raw: string;
}

/** 각 문서를 이 도구가 어디에 쓰는지(PRD 5.1). */
const USE: Record<string, string> = {
  B01: "예약 칸 규칙 — 소요 시간 단계, 사람·방 수, 준비 시간, 하루 최대, 첫 예약 가능 시각, 찾는 기간, 가예약, 버튼·질문, 문장 틀",
  B02: "공휴일 목록과 확인 기간(다시봄 D01에서 옮김)",
  V02: "진료시간, 점심, 접수 마감, 토요일 수술 없음, 휴진·임시 휴진",
  V03: "예약금 금액",
  V15: "광고 표현 검사(문장 틀)",
};

export function docRows(files: { path: string; raw: string }[]): DocRow[] {
  const rows: DocRow[] = [];
  for (const f of files) {
    const p = parseVaultFile(f.path, f.raw);
    if (!p.ok) continue;
    const m = p.doc.meta;
    rows.push({
      id: m.id,
      title: m.title,
      path: f.path,
      status: m.status,
      assumption: m.assumption,
      approvedBy: m.approvedBy ?? "",
      use: USE[m.id] ?? "근거 인용(안내 문장·칸 옆 안내)",
      raw: f.raw,
    });
  }
  return rows.sort((a, b) => (a.id[0] === b.id[0] ? (a.id < b.id ? -1 : 1) : a.id[0] === "B" ? -1 : 1));
}

export function hoursRows(engine: Engine): [string, string][] {
  const h = engine.hours;
  const weekly = DOW_KEYS.map((d) => {
    const x = h.weekly[d];
    return `${dow(d)} ${x ? `${x.open}~${x.close}` : "휴진"}`;
  }).join(" · ");
  return [
    ["요일별 진료", weekly],
    ["점심(접수·전화 응대 없음)", `${h.lunch.start}~${h.lunch.end} · ${h.lunch.days.map(dow).join("")}요일 (그 밖의 요일은 점심 없음)`],
    ["접수 마감", `진료 종료 ${h.lastEntryMinutesBeforeClose}분 전까지 시작(포함)`],
    ["수술 없는 요일", h.noSurgeryDays.map((d) => `${dow(d)}요일`).join(", ") || "없음"],
    ["법정 공휴일", h.closedOnPublicHolidays ? "휴진" : "진료"],
    ["임시 휴진", h.extraClosed.map((x) => `${formatShort(x.date)} ${x.reason}`).join(", ") || "없음"],
  ];
}

export interface ServiceRow {
  key: string;
  label: string;
  bookable: boolean;
  minutes: string;
  phases: string;
  starts: string;
  lunch: string;
  deposit: string;
}

export function serviceRows(engine: Engine): ServiceRow[] {
  const r = engine.rules;
  return Object.values(r.services).map((s) => ({
    key: s.key,
    label: s.label,
    bookable: s.bookable,
    minutes: `${s.minutes}분`,
    phases: s.phases
      .map((p) => `${Object.entries(p.use).map(([k, n]) => `${r.resources[k]}${n > 1 ? ` ${n}` : ""}`).join("+")} ${p.from}~${p.to}분`)
      .join(" · "),
    starts: s.starts === "grid" ? `${r.slotMinutes}분 격자` : s.starts.join(", "),
    lunch: s.lunch === "avoid" ? "점심과 겹치면 안 됨" : "점심을 가로질러 진행",
    deposit: s.deposit === null ? "없음" : `${formatWon(engine.prices[s.deposit]?.price ?? 0)}(${s.deposit})`,
  }));
}

export function capacityRows(engine: Engine): { when: string; values: string }[] {
  const r = engine.rules;
  const fmt = (set: Record<string, number>) =>
    Object.entries(set)
      .map(([k, n]) => `${r.resources[k]} ${n}`)
      .join(" · ");
  return [
    { when: "기본(평일 낮·토요일)", values: fmt(r.capacity.base) },
    ...r.capacity.overrides.map((o) => ({ when: `${o.days.map(dow).join("")}요일 ${o.from}~${o.to}`, values: fmt(o.set) })),
  ];
}

export function otherRows(engine: Engine): [string, string][] {
  const r = engine.rules;
  return [
    ["칸 단위", `${r.slotMinutes}분, 여는 시각 기준`],
    ["첫 예약 가능 시각(수술 외)", `기준 시각 + ${r.leadMinutes}분을 칸 격자로 올림`],
    ["수술 첫 가능일", `기준일 + ${r.surgeryMinDaysAhead}일`],
    ["찾는 기간", `일반 ${r.searchDays.default}일 · 수술 ${r.searchDays.surgery}일 · 더 보기 ${r.searchDays.more}일`],
    ["시간대", `${r.bands.morningBefore} 전 오전 · ${r.bands.eveningFrom}부터 저녁 · 그 사이 낮·오후`],
    ["준비 시간", Object.entries(r.buffers).map(([k, b]) => `${r.resources[k]} 앞 ${b.before}분·뒤 ${b.after}분`).join(", ") || "없음"],
    ["하루 최대", r.dailyMax.map((d) => `${r.services[d.service].label} ${d.max}건(세는 안건: ${d.counts.map((c) => r.services[c].label).join(", ")})`).join(" · ")],
    [
      "수술 뒤따르는 내원",
      `${r.surgeryFollowUps.nextDayMustBeOpen ? "다음 날이 진료일이어야 함" : "다음 날 조건 없음"} · D+${r.surgeryFollowUps.d7Window.from}~D+${r.surgeryFollowUps.d7Window.to}에 진료일 하나 이상`,
    ],
    ["수술 취소·변경 안내 표시", `수술일이 기준일 + ${r.surgeryCancelNoticeDays}일 안`],
    ["주사 회차 옮기기 창", `예정일 앞 ${r.injectionMoveWindow.before}일 · 뒤 ${r.injectionMoveWindow.after}일`],
    ["가예약 유지", `다음 영업일 진료 종료까지${r.hold.capAtSlotStart ? ", 칸 시작을 넘지 않음" : ""} · 풀리기 ${r.hold.warnMinutesBefore}분 전 경고`],
    ["영업일", r.businessDaysIncludeSaturday ? "진료일(토요일 포함)" : "진료일(토요일 제외)"],
    ["제안 칸", `${r.suggestCount}칸 — 가장 빠른 칸, 그다음 날짜나 시간대가 다른 가장 빠른 칸`],
    ["떨어진 까닭 순서", r.reasonOrder.map((k) => REASON_LABEL[k]).join(" > ")],
  ];
}

export interface IntakeRow {
  path: string;
  question: string;
  answer: string;
  service: string;
  note: string;
}

export function intakeRows(engine: Engine): IntakeRow[] {
  const r = engine.rules;
  const out: IntakeRow[] = [];
  for (const b of r.intake) {
    const groups = b.subs ? b.subs.map((s) => ({ path: `${b.label} → ${s.label}`, question: s.question, answers: s.answers })) : [{ path: b.label, question: b.question ?? "", answers: b.answers ?? [] }];
    for (const g of groups) {
      for (const a of g.answers) {
        out.push({
          path: g.path,
          question: g.question,
          answer: a.label,
          service: a.sizes ? a.sizes.map((k) => r.services[k].label).join(" / ") + "(첫 값이 기본)" : r.services[a.service].label + (a.mode === "move" ? " — 회차 옮기기(예정일 앞뒤 창)" : ""),
          note: [a.redirect, ...a.notes].filter(Boolean).join(" · "),
        });
      }
    }
  }
  return out;
}

export function holidayRows(engine: Engine): string[] {
  return engine.calendar.holidays.map((h) => `${formatShort(h.date)} ${h.name}`);
}
