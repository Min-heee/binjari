#!/usr/bin/env python3
"""
빈자리 대조 계산기 — 앱 엔진(TypeScript)과 따로 만든 파이썬 계산(PRD 7절 "별도 구현 대조").

왜 따로 만드나: 엔진이 맞는지 보려면 엔진과 같은 코드로 만든 답을 쓰면 안 된다. 여기서는 앱 코드를 쓰지 않고
볼트 문서 셋의 json(vault/booking-slots.md B01, vault/hours-location.md V02, vault/holidays.md B02)과
data/bookings.json만 다시 읽어, 모든 시작 후보를 분 단위로 검사한다(자원은 매 분 동시 사용량 ≤ 수량).

결과는 "AI가 계산, 사람 검수 전"이다. 같은 AI가 같은 문서를 읽고 썼으므로 구현 실수는 잡아도
해석 실수(접수 마감 포함 여부, 점심과 맞닿기, 60분 리드 올림)는 못 잡는다. 그건 사람 손 검수 몫이다.

실행(저장소 루트에서): python3 data/scripts/slots_expected.py
출력: data/expected-slots.json — src/core/expected.test.ts가 엔진 결과와 한 행씩 비교한다.
"""
import datetime as dt
import json
import re
from pathlib import Path

REPO = str(Path(__file__).resolve().parents[2])
# PRD 7절 평가 기준 시각 5개(KST).
BASES = ["2026-09-21 10:00", "2026-09-23 12:50", "2026-09-28 11:00", "2026-10-01 20:10", "2026-10-06 10:00"]
SERVICES = ["first-consult", "revisit-consult", "injection", "scalp-care", "surgery-full", "surgery-half"]


def jblock(path):
    txt = open(path, encoding="utf-8").read()
    m = re.findall(r"```json\n(.*?)\n```", txt, re.S)
    assert len(m) == 1, path
    return json.loads(m[0])


B01 = jblock(f"{REPO}/vault/booking-slots.md")
V02 = jblock(f"{REPO}/vault/hours-location.md")
B02 = jblock(f"{REPO}/vault/holidays.md")
DATA = json.load(open(f"{REPO}/data/bookings.json", encoding="utf-8"))

WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
HOL = {h["date"]: h["name"] for h in B02["holidays"]}
COV = B02["holidaysCoverage"]
EXTRA = {e["date"]: e["reason"] for e in V02["extraClosedDates"]}


def hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def fmt(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def D(s):
    return dt.date.fromisoformat(s)


def day_status(date):
    """return (open, close) or reason string"""
    ds = date.isoformat()
    if not (COV["from"] <= ds <= COV["to"]):
        return "holiday-unknown"
    wk = V02["weekly"][WD[date.weekday()]]
    if wk is None or ds in HOL or ds in EXTRA:
        return "closed"
    return (hm(wk["open"]), hm(wk["close"]))


def is_open(date):
    return isinstance(day_status(date), tuple)


def capacity(date, t):
    wd = WD[date.weekday()]
    cap = dict(B01["capacity"]["base"])
    for o in B01["capacity"]["overrides"]:
        if wd in o["days"] and hm(o["from"]) <= t < hm(o["to"]):
            cap.update(o["set"])
    for e in DATA["exceptions"]:
        if e["date"] == date.isoformat():
            cap[e["resource"]] = cap.get(e["resource"], 0) + e["delta"]
    return cap


def usage_intervals(service, start):
    """list of (resource, from, to, qty) absolute minutes, buffers applied."""
    out = []
    for ph in B01["services"][service]["phases"]:
        for r, q in ph["use"].items():
            buf = B01["buffers"].get(r, {"before": 0, "after": 0})
            out.append((r, start + ph["from"] - buf["before"], start + ph["to"] + buf["after"], q))
    return out


BOOK_BY_DATE = {}
for b in DATA["bookings"]:
    BOOK_BY_DATE.setdefault(b["date"], []).append(b)


def day_usage(date):
    """minute -> resource -> used"""
    u = {}
    for b in BOOK_BY_DATE.get(date.isoformat(), []):
        for r, a, z, q in usage_intervals(b["service"], hm(b["start"])):
            for t in range(a, z):
                u.setdefault(t, {}).setdefault(r, 0)
                u[t][r] += q
    return u


def lunch_days():
    return V02["lunch"]["days"]


def evaluate(service, base_date, base_min):
    svc = B01["services"][service]
    surgery = svc["earliest"] == "surgery"
    ndays = B01["searchDays"]["surgery" if surgery else "default"]
    earliest_abs = base_min + B01["leadMinutes"]
    slot = B01["slotMinutes"]
    rows = []
    for i in range(ndays):
        date = base_date + dt.timedelta(days=i)
        ds = date.isoformat()
        st = day_status(date)
        if not isinstance(st, tuple):
            rows.append({"date": ds, "start": None, "ok": False, "reasons": [st]})
            continue
        op, cl = st
        wd = WD[date.weekday()]
        day_reasons = []
        if surgery:
            if wd in V02["noSurgeryDays"]:
                day_reasons.append("no-surgery-day")
            fu = B01["surgeryFollowUps"]
            if fu["nextDayMustBeOpen"] and not is_open(date + dt.timedelta(days=1)):
                day_reasons.append("next-day-closed")
            w = fu["d7Window"]
            if not any(is_open(date + dt.timedelta(days=k)) for k in range(w["from"], w["to"] + 1)):
                day_reasons.append("no-d7-open-day")
            starts = [hm(s) for s in svc["starts"]]
        else:
            starts = list(range(op, cl, slot))  # all grid points from open, before close
        usage = day_usage(date)
        # daily max
        dm_hit = False
        for rule in B01["dailyMax"]:
            if rule["service"] == service:
                cnt = sum(1 for b in BOOK_BY_DATE.get(ds, []) if b["service"] in rule["counts"])
                if cnt >= rule["max"]:
                    dm_hit = True
        last_entry = cl - V02["lastEntryMinutesBeforeClose"]
        for s in starts:
            reasons = list(day_reasons)
            if surgery:
                if (date - base_date).days < B01["surgeryMinDaysAhead"]:
                    reasons.append("before-earliest")
            else:
                if i == 0 and s < earliest_abs:
                    # rounding up to grid is implied since s is on grid
                    reasons.append("before-earliest")
            ivs = usage_intervals(service, s)
            end = max(z for _, _, z, _ in ivs)
            if s > last_entry:
                reasons.append("after-last-entry")
            if end > cl:
                reasons.append("past-close")
            if svc["lunch"] == "avoid" and wd in lunch_days():
                la, lz = hm(V02["lunch"]["start"]), hm(V02["lunch"]["end"])
                if s < lz and s + svc["minutes"] > la:
                    reasons.append("lunch")
            if dm_hit:
                reasons.append("daily-max")
            res_bad = False
            for r, a, z, q in ivs:
                for t in range(a, z):
                    if usage.get(t, {}).get(r, 0) + q > capacity(date, t).get(r, 0):
                        res_bad = True
                        break
                if res_bad:
                    break
            # need to sum overlapping phases of the candidate itself on same resource
            if not res_bad:
                need = {}
                for r, a, z, q in ivs:
                    for t in range(a, z):
                        need.setdefault(t, {}).setdefault(r, 0)
                        need[t][r] += q
                for t, rs in need.items():
                    cap = capacity(date, t)
                    for r, q in rs.items():
                        if usage.get(t, {}).get(r, 0) + q > cap.get(r, 0):
                            res_bad = True
            if res_bad:
                reasons.append("resource")
            rows.append({"date": ds, "start": fmt(s), "ok": not reasons, "reasons": reasons})
    return rows


if __name__ == "__main__":
    out = {
        "status": "AI가 계산, 사람 검수 전",
        "source": "data/scripts/slots_expected.py (앱 코드를 쓰지 않음)",
        "bases": {},
    }
    for base in BASES:
        bd, bt = base.split()
        base_date, base_min = D(bd), hm(bt)
        # 행: [날짜, 시작(휴진일이면 null), 떨어진 까닭 목록(빈 목록이면 빈 칸)]
        out["bases"][f"{bd}T{bt}:00+09:00"] = {
            s: [[r["date"], r["start"], sorted(r["reasons"])] for r in evaluate(s, base_date, base_min)] for s in SERVICES
        }
    path = Path(REPO) / "data" / "expected-slots.json"
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    # 행마다 줄을 바꿔 diff가 읽히게 한다.
    text = text.replace("],[", "],\n[")
    path.write_text(text + "\n", encoding="utf-8")
    rows = sum(len(v) for b in out["bases"].values() for v in b.values())
    free = sum(1 for b in out["bases"].values() for v in b.values() for r in v if r[1] is not None and not r[2])
    print(f"기준 시각 {len(BASES)} × 안건 {len(SERVICES)}: 행 {rows}, 빈 칸 {free} → {path.relative_to(REPO)}")
