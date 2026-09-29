"""
합성 기존 예약 생성기(PRD F8). 가상 의원 '샘플의원'의 2026-09-21(월)~10-19(월) 일반 예약과 ~11-02(월) 수술 예약,
그리고 자원 일정(9/30 의료진 1명 휴무)을 만든다. 실제 환자·병원과 관계없다. 이름·연락처 칸은 없다.

왜 파이썬으로 따로 짜나: 앱 엔진(src/core, TypeScript)을 쓰지 않고 볼트 json(V02·B01·B02)을 다시 읽어 **따로 구현한**
점유 검사로 예약을 놓는다. 앱 시험(src/core/data.test.ts)이 이 데이터를 앱 엔진으로 다시 검사하므로, 두 구현이 서로를 한 번 확인한다.
(같은 AI가 같은 문서를 해석했으므로 해석 실수는 잡지 못한다 — PRD 7절.)

만드는 순서:
  1. 손으로 정한 것(심은 사례): 자원 일정, 수술 예약, 수술 뒤따르는 경과 진료, 9/30 '예약 꽉 참'을 만드는 재진 상담 1건.
  2. 시드 고정 난수로 나머지 예약을 채운다. 한 건 놓을 때마다 규칙(진료일·접수 마감·진료 종료·점심·하루 최대·자원)을 지키는지,
     그리고 **지켜야 할 칸**(PRD 7절 심은 경계 사례·시연 장면의 칸)을 막지 않는지 본다. 막으면 그 예약은 버린다.
  3. 끝나고 심은 사례의 의도(가능·불가)를 다시 확인한다. 어긋나면 멈춘다.

실행: python3 data/scripts/generate_bookings.py  (저장소 루트에서). 두 번 돌려도 같은 파일이 나온다(시드 20260921).
"""

from __future__ import annotations

import datetime as dt
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = 20260921
GENERAL_FROM = dt.date(2026, 9, 21)
GENERAL_TO = dt.date(2026, 10, 19)
SURGERY_TO = dt.date(2026, 11, 2)
DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]  # date.weekday() 순서


def vault_json(name: str):
    raw = (ROOT / "vault" / name).read_text(encoding="utf8")
    blocks = re.findall(r"^```json[ \t]*\n(.*?)\n```[ \t]*$", raw, flags=re.S | re.M)
    assert len(blocks) == 1, f"{name}: json 코드블록이 하나가 아님"
    return json.loads(blocks[0])


V02 = vault_json("hours-location.md")
B01 = vault_json("booking-slots.md")
B02 = vault_json("holidays.md")


def d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


HOLIDAYS = {d(h["date"]): h["name"] for h in B02["holidays"]}
EXTRA = {d(x["date"]): x["reason"] for x in V02["extraClosedDates"]}
COVER_TO = d(B02["holidaysCoverage"]["to"])


def dow(day: dt.date) -> str:
    return DOW[day.weekday()]


def is_open(day: dt.date) -> bool:
    return V02["weekly"][dow(day)] is not None and day not in HOLIDAYS and day not in EXTRA and day <= COVER_TO


def hours(day: dt.date) -> tuple[int, int]:
    w = V02["weekly"][dow(day)]
    return hm(w["open"]), hm(w["close"])


SERVICES = B01["services"]
RESOURCES = list(B01["resources"].keys())


def usage(svc: str, start: int) -> list[tuple[str, int, int, int]]:
    """(자원, 시작, 끝, 수) — 단계 + 자원별 준비 시간. 준비 시간은 그 자원을 쓰는 첫 단계 앞, 마지막 단계 뒤에 붙는다."""
    out = []
    span: dict[str, list[int]] = {}
    for p in SERVICES[svc]["phases"]:
        for r, n in p["use"].items():
            out.append((r, start + p["from"], start + p["to"], n))
            if r in span:
                s = span[r]
                span[r] = [min(s[0], p["from"]), max(s[1], p["to"]), max(s[2], n)]
            else:
                span[r] = [p["from"], p["to"], n]
    for r, (f, t, n) in span.items():
        b = B01["buffers"].get(r)
        if not b:
            continue
        if b["before"]:
            out.append((r, start + f - b["before"], start + f, n))
        if b["after"]:
            out.append((r, start + t, start + t + b["after"], n))
    return out


def capacity(day: dt.date, r: str, m: int, exceptions: list[dict]) -> int:
    c = B01["capacity"]["base"][r]
    for o in B01["capacity"]["overrides"]:
        if dow(day) in o["days"] and r in o["set"] and hm(o["from"]) <= m < hm(o["to"]):
            c = o["set"][r]
    for x in exceptions:
        if d(x["date"]) == day and x["resource"] == r and hm(x.get("from", "00:00")) <= m < (hm(x["to"]) if "to" in x else 1440):
            c += x["delta"]
    return max(0, c)


class Book:
    def __init__(self, exceptions: list[dict]):
        self.items: list[dict] = []
        self.exceptions = exceptions

    def used(self, day: dt.date) -> dict[str, list[int]]:
        u = {r: [0] * 1440 for r in RESOURCES}
        for b in self.items:
            if d(b["date"]) != day:
                continue
            for r, f, t, n in usage(b["service"], hm(b["start"])):
                for m in range(max(0, f), min(1440, t)):
                    u[r][m] += n
        return u

    def fits(self, svc: str, day: dt.date, start: int, extra: dict | None = None) -> tuple[bool, str]:
        """svc를 day·start에 놓을 수 있나. extra가 있으면 그 예약을 더한 상태로 본다(지켜야 할 칸 확인용)."""
        if not is_open(day):
            return False, "휴진"
        o, c = hours(day)
        s = SERVICES[svc]
        end = start + s["minutes"]
        if start > c - V02["lastEntryMinutesBeforeClose"]:
            return False, "접수 마감 뒤"
        us = usage(svc, start)
        if min([start] + [x[1] for x in us]) < o or max([end] + [x[2] for x in us]) > c:
            return False, "진료 종료 넘김"
        lunch = V02["lunch"]
        if s["lunch"] == "avoid" and dow(day) in lunch["days"] and start < hm(lunch["end"]) and end > hm(lunch["start"]):
            return False, "점심"
        if s["earliest"] == "surgery":
            if dow(day) in V02["noSurgeryDays"]:
                return False, "토요일 수술"
            if not is_open(day + dt.timedelta(days=1)):
                return False, "다음 날 휴진"
            w = B01["surgeryFollowUps"]["d7Window"]
            if not any(is_open(day + dt.timedelta(days=k)) for k in range(w["from"], w["to"] + 1)):
                return False, "D+7 창"
        items = self.items + ([extra] if extra else [])
        for rule in B01["dailyMax"]:
            if rule["service"] == svc:
                n = sum(1 for b in items if d(b["date"]) == day and b["service"] in rule["counts"])
                if n >= rule["max"]:
                    return False, "하루 최대"
        u = self.used(day)
        if extra and d(extra["date"]) == day:
            for r, f, t, n in usage(extra["service"], hm(extra["start"])):
                for m in range(max(0, f), min(1440, t)):
                    u[r][m] += n
        for r, f, t, n in us:
            for m in range(f, t):
                if u[r][m] + n > capacity(day, r, m, self.exceptions):
                    return False, f"자원({r})"
        return True, ""

    def add(self, svc: str, day: dt.date, start: int, **extra) -> dict:
        b = {"service": svc, "date": day.isoformat(), "start": fmt(start), **extra}
        self.items.append(b)
        return b


# ── 1. 손으로 정한 것 ───────────────────────────────────────────────

EXCEPTIONS = [{"date": "2026-09-30", "resource": "doctor", "delta": -1, "note": "의료진 1명 휴무(합성)"}]
book = Book(EXCEPTIONS)

# 수술(하루 = surgery-full 10:00, 반나절 = surgery-half 10:00·14:30). 9/28·10/1·10/23은 비워 둔다(심은 '수술 가능' 사례).
SURGERIES = [
    ("2026-09-22", "surgery-full", "10:00", "의료진 A"),
    ("2026-09-29", "surgery-half", "10:00", "의료진 B"),
    ("2026-09-30", "surgery-full", "10:00", "의료진 A"),  # 9/30 의료진 1명 휴무와 겹쳐 첫 상담 '예약 꽉 참'
    ("2026-10-06", "surgery-full", "10:00", "의료진 B"),
    ("2026-10-07", "surgery-half", "14:30", "의료진 A"),
    ("2026-10-13", "surgery-half", "10:00", "의료진 A"),
    ("2026-10-13", "surgery-half", "14:30", "의료진 B"),
    ("2026-10-19", "surgery-full", "10:00", "의료진 A"),
    ("2026-10-20", "surgery-full", "10:00", "의료진 B"),
    ("2026-10-21", "surgery-half", "10:00", "의료진 A"),
    ("2026-10-22", "surgery-full", "10:00", "의료진 B"),
    ("2026-10-26", "surgery-full", "10:00", "의료진 A"),
    ("2026-10-28", "surgery-half", "14:30", "의료진 B"),
    ("2026-10-29", "surgery-full", "10:00", "의료진 A"),
    ("2026-10-30", "surgery-full", "10:00", "의료진 B"),
    ("2026-11-02", "surgery-full", "10:00", "의료진 A"),
]
# 창 밖(9/21 전)에 한 수술. 그 D+7 경과 진료만 창 안에 들어온다.
PAST_SURGERIES = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]


def d7_day(surgery: dt.date) -> dt.date | None:
    """D+7 내원일: D+7이 진료일이면 그날, 아니면 V07 창(D+6~D+9) 안의 뒤 진료일, 없으면 앞 진료일."""
    for k in (7, 8, 9, 6):
        day = surgery + dt.timedelta(days=k)
        if is_open(day):
            return day
    return None


# ── 지켜야 할 칸: (서비스, 날짜, 시각, 까닭) ─────────────────────────
PROTECT = [
    ("first-consult", "2026-09-21", "11:00", "시연: 오늘 첫 칸"),
    ("injection", "2026-09-21", "11:00", "첫 예약 가능 시각(기준 10:00)"),
    ("injection", "2026-09-21", "12:00", "첫 예약 가능 시각(기준 11:00)"),
    ("first-consult", "2026-09-22", "12:00", "점심과 맞닿기만 함"),
    ("injection", "2026-09-22", "12:30", "30분 주사는 점심 전 끝남"),
    ("first-consult", "2026-09-22", "14:00", "점심 직후"),
    ("first-consult", "2026-09-22", "18:00", "마지막 60분 칸"),
    ("injection", "2026-09-22", "18:30", "접수 마감 포함"),
    ("injection", "2026-09-23", "14:00", "첫 예약 가능 시각(기준 12:50)"),
    ("surgery-full", "2026-09-28", "10:00", "수술 가능, 정리 18:00~18:30"),
    ("injection", "2026-09-28", "12:00", "첫 예약 가능 시각(기준 9/28 11:00)"),
    ("surgery-full", "2026-10-01", "10:00", "수술 가능(D+1 10/2 진료)"),
    ("first-consult", "2026-10-01", "20:00", "목 야간 자원 안"),
    ("injection", "2026-10-01", "20:30", "목 접수 마감 포함"),
    ("injection", "2026-10-02", "10:00", "첫 예약 가능 시각(기준 10/1 20:10)"),
    ("first-consult", "2026-10-10", "14:00", "토요일 마지막 60분 칸"),
    ("injection", "2026-10-10", "14:30", "토요일 접수 마감 포함"),
    ("surgery-full", "2026-10-23", "10:00", "수술 가능(D+1 토요일 진료)"),
    # 수술 칸이 무작위 채우기에 모두 먹히지 않게(실제로는 수술 날을 먼저 잡고 다른 예약을 그 둘레에 둔다[추론]).
    # 반나절 칸을 따로 지켜 수술 크기 선택이 결과를 바꾸게 한다(PRD 6절).
    ("surgery-full", "2026-10-12", "10:00", "빈 수술 날"),
    ("surgery-full", "2026-10-14", "10:00", "빈 수술 날"),
    ("surgery-full", "2026-10-27", "10:00", "빈 수술 날(기준 10/6)"),
    ("surgery-half", "2026-09-29", "14:30", "오전 반나절 수술 뒤 오후 반나절"),
    ("surgery-half", "2026-10-07", "10:00", "오후 반나절 수술 앞 오전 반나절"),
    ("surgery-half", "2026-10-21", "14:30", "오전 반나절 수술 뒤 오후 반나절(기준 10/6)"),
]


def protected_ok(extra: dict | None) -> bool:
    for svc, day, start, _ in PROTECT:
        ok, _why = book.fits(svc, d(day), hm(start), extra)
        if not ok:
            return False
    return True


assert protected_ok(None), "빈 예약표에서도 지켜야 할 칸이 막힘 — 규칙이나 목록을 확인"

for day, svc, start, who in SURGERIES:
    ok, why = book.fits(svc, d(day), hm(start))
    assert ok, f"수술 {day} {start}: {why}"
    b = {"service": svc, "date": day, "start": start, "assigned": {"doctor": who}}
    assert protected_ok(b), f"수술 {day}가 지켜야 할 칸을 막음"
    book.items.append(b)

# 9/30: 의료진 1명 휴무 + 하루 수술로 의료진이 18:00까지 없다. 18:00 재진 상담 한 건으로 마지막 첫 상담 칸(18:00)까지 막는다.
cand = {"service": "revisit-consult", "date": "2026-09-30", "start": "18:00"}
assert book.fits("revisit-consult", d("2026-09-30"), hm("18:00"))[0]
book.items.append(cand)

rng = random.Random(SEED)
MORNING = [hm(x) for x in ["10:00", "10:30", "11:00", "11:30"]]


def place_postop(day: dt.date, note: str) -> None:
    if not (GENERAL_FROM <= day <= GENERAL_TO):
        return
    starts = MORNING + [hm("14:00"), hm("14:30"), hm("15:00"), hm("16:00")]
    rng.shuffle(starts)
    # 선호 시각이 모두 막히면(9/30처럼 의료진이 저녁에만 비는 날) 그날 격자 전체를 본다.
    o, c = hours(day)
    starts += [m for m in range(o, c, B01["slotMinutes"]) if m not in starts]
    for s in starts:
        ok, _ = book.fits("postop-visit", day, s)
        cand = {"service": "postop-visit", "date": day.isoformat(), "start": fmt(s)}
        if ok and protected_ok(cand):
            book.items.append(cand)
            return
    raise SystemExit(f"경과 진료를 놓을 칸이 없음: {day} ({note})")


for day, svc, start, who in SURGERIES:
    sd = d(day)
    place_postop(sd + dt.timedelta(days=1), f"{day} 수술 D+1")
    d7 = d7_day(sd)
    if d7:
        place_postop(d7, f"{day} 수술 D+7")
for day in PAST_SURGERIES:
    d7 = d7_day(d(day))
    if d7:
        place_postop(d7, f"{day} 수술 D+7")


# ── 2. 시드 고정 난수로 채우기 ───────────────────────────────────────
# 요일별 목표 건수(시도 수). 빈 시간이 드문드문하게 남도록 넉넉히 시도하고, 못 놓으면 건너뛴다.
TARGET = {
    "weekday": {"first-consult": 6, "revisit-consult": 6, "injection": 9, "scalp-care": 4, "postop-visit": 3},
    "thu": {"first-consult": 6, "revisit-consult": 7, "injection": 11, "scalp-care": 5, "postop-visit": 3},
    "sat": {"first-consult": 5, "revisit-consult": 3, "injection": 5, "scalp-care": 3, "postop-visit": 2},
}

day = GENERAL_FROM
while day <= GENERAL_TO:
    if is_open(day):
        kind = "sat" if dow(day) == "sat" else "thu" if dow(day) == "thu" else "weekday"
        o, c = hours(day)
        grid = list(range(o, c, B01["slotMinutes"]))
        jobs = [svc for svc, n in sorted(TARGET[kind].items()) for _ in range(n)]
        rng.shuffle(jobs)
        for svc in jobs:
            starts = grid[:]
            rng.shuffle(starts)
            for s in starts[:8]:
                ok, _ = book.fits(svc, day, s)
                if not ok:
                    continue
                cand = {"service": svc, "date": day.isoformat(), "start": fmt(s)}
                if protected_ok(cand):
                    book.items.append(cand)
                    break
    day += dt.timedelta(days=1)

# ── 3. 심은 사례 확인 ───────────────────────────────────────────────
for svc, dd, start, why in PROTECT:
    ok, reason = book.fits(svc, d(dd), hm(start))
    assert ok, f"지켜야 할 칸이 막힘: {svc} {dd} {start} ({why}) — {reason}"

sep30 = d("2026-09-30")
assert not any(book.fits("first-consult", sep30, s)[0] for s in range(hm("10:00"), hm("19:00"), 30)), "9/30 첫 상담이 '예약 꽉 참'이 아님"
assert all(b["date"] <= GENERAL_TO.isoformat() or b["service"].startswith("surgery") for b in book.items), "일반 예약이 10/19 뒤에 있음"
assert all(b["date"] <= SURGERY_TO.isoformat() for b in book.items)

items = sorted(book.items, key=lambda b: (b["date"], b["start"], b["service"]))
out = []
for i, b in enumerate(items, 1):
    row = {"id": f"B{i:04d}", "service": b["service"], "date": b["date"], "start": b["start"]}
    if "assigned" in b:
        row["assigned"] = b["assigned"]
    out.append(row)

counts: dict[str, int] = {}
for b in out:
    counts[b["service"]] = counts.get(b["service"], 0) + 1

doc = {
    "meta": {
        "fictional": True,
        "note": "가상 의원 '샘플의원'의 합성 기존 예약. 실제 환자·병원과 관계없음. 생성기 data/scripts/generate_bookings.py(시드 20260921).",
        "generalRange": [GENERAL_FROM.isoformat(), GENERAL_TO.isoformat()],
        "surgeryRange": [GENERAL_FROM.isoformat(), SURGERY_TO.isoformat()],
        "counts": dict(sorted(counts.items())),
    },
    "bookings": out,
    "exceptions": EXCEPTIONS,
}
(ROOT / "data" / "bookings.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
print(f"예약 {len(out)}건 {dict(sorted(counts.items()))} → data/bookings.json", file=sys.stderr)
