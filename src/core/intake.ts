/**
 * 안건 버튼 → 확인 질문 → 찾을 안건(PRD F1, 3절 표). 버튼·질문·대답은 B01 intake에서 읽는다.
 *
 * 버튼 셋만으로는 첫 상담과 재진, 처음인 주사·관리 고객을 가르지 못해(예약금 3만 원을 잘못 안내하거나 처음 오는 분에게 주사 칸을 냄)
 * 질문을 하나 더 묻는다(PRD 6절). 대답이 "첫 상담으로 바뀜"이면 그 까닭(redirect)을 함께 돌려준다.
 */

import type { Engine } from "./engine";
import type { IntakeAnswer, IntakeButton } from "./rules";

export interface IntakeChoice {
  button: string;
  /** 시술 하위 선택(수술·주사·관리). 상담·재시술은 없음. */
  sub?: string;
  answer: string;
  /** 수술 크기(answer.sizes 안에서). 없으면 기본값(첫 값 = 하루). */
  size?: string;
}

export interface Resolved {
  service: string;
  label: string;
  redirect: string | null;
  /** 이 대답에 붙는 안내 + 안건 안내. */
  notes: string[];
  /** 이 대답에만 붙는 안내(재시술 "담당(집도) 의료진 일정은 예약표에서 확인" 등). 화면은 경고로 결과 위에 보인다. */
  answerNotes: string[];
  /** 안건 안내(B01 services.*.notes). */
  serviceNotes: string[];
  mode: "search" | "move";
  /** 고를 수 있는 수술 크기(수술일 때). */
  sizes: { key: string; label: string }[];
  hint: string | null;
}

export type ResolveResult = { ok: true; resolved: Resolved } | { ok: false; error: string };

export function findButton(engine: Engine, key: string): IntakeButton | undefined {
  return engine.rules.intake.find((b) => b.key === key);
}

export function questionFor(engine: Engine, button: string, sub?: string): { question: string; answers: IntakeAnswer[] } | null {
  const b = findButton(engine, button);
  if (!b) return null;
  if (b.subs) {
    const s = b.subs.find((x) => x.key === sub);
    return s ? { question: s.question, answers: s.answers } : null;
  }
  return b.question && b.answers ? { question: b.question, answers: b.answers } : null;
}

export function resolveIntake(engine: Engine, c: IntakeChoice): ResolveResult {
  const b = findButton(engine, c.button);
  if (!b) return { ok: false, error: `모르는 버튼입니다: ${c.button}` };
  const q = questionFor(engine, c.button, c.sub);
  if (!q) return { ok: false, error: b.subs ? `하위 선택을 고르세요: ${b.subs.map((s) => s.label).join(" · ")}` : "질문이 없습니다" };
  const a = q.answers.find((x) => x.key === c.answer);
  if (!a) return { ok: false, error: `모르는 대답입니다: ${c.answer}` };
  let service = a.service;
  if (c.size !== undefined) {
    if (!a.sizes || !a.sizes.includes(c.size)) return { ok: false, error: `고를 수 없는 크기입니다: ${c.size}` };
    service = c.size;
  }
  const svc = engine.rules.services[service];
  return {
    ok: true,
    resolved: {
      service,
      label: svc.label,
      redirect: a.redirect ?? null,
      notes: [...a.notes, ...svc.notes],
      answerNotes: [...a.notes],
      serviceNotes: [...svc.notes],
      mode: a.mode === "move" ? "move" : "search",
      sizes: (a.sizes ?? []).map((k) => ({ key: k, label: engine.rules.services[k].label })),
      hint: b.hint ?? null,
    },
  };
}
