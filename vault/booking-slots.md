---
id: B01
title: 예약 칸 규칙(빈자리)
type: policy
version: 1
status: draft
effective: 2026-09-01
owner: 원무팀
fictional: true
assumption: true
approvedBy: none
---

# 예약 칸 규칙(빈자리)

## 이 문서의 지위

이 문서는 병원이 승인한 문서가 아닙니다. 전화 예약 빈 시간 찾기 도구 '빈자리'를 만들면서 AI(Claude Code)가 쓴 [가정] 문서입니다. 볼트의 승인 문서에 있는 사실(진료시간, 점심, 접수 마감, 소요 시간, 예약금)은 그 문서에서 읽고, 이 문서는 볼트에 없는 값만 정합니다. 그래서 `status: draft`, `assumption: true`, `approvedBy: none`으로 두고, 이 문서를 쓰는 모든 화면 위에 "[가정] 규칙 — 병원 확인 전" 띠를 붙입니다. 병원이 값을 확인하면 값과 근거 문장을 고치고 승인 문서로 바꿉니다.

값이 빠지거나 모양이 틀리면 빈자리는 빈 시간을 내지 않고 멈춥니다. 기본값을 채우지 않습니다. 멈추면 직원은 지금처럼 예약표를 보면 되고, 틀린 빈 시간을 말하는 쪽이 더 나쁘다고 보았습니다.

## 볼트에서 읽는 값(이 문서에 적지 않음)

- 진료시간·점심·접수 마감·휴진·토요일 수술 없음: [[hours-location]](V02). 평일 10:00~19:00, 목요일 21:00까지, 점심 13:00~14:00(평일, 접수·전화 응대 없음), 접수 마감은 진료 종료 30분 전, 토요일 10:00~15:00 점심 없음, 토요일 수술 없음, 일요일·법정 공휴일·2026-10-16 휴진.
- 법정 공휴일: [[holidays]](B02).
- 예약금 금액: [[price-list]](V03)의 `deposit-consult` 30,000원, `deposit-surgery` 500,000원. 두피 관리 예약금은 [[booking-policy]](V04) "두피 관리를 예약할 때도 같은 금액의 예약금을 받고"에 따라 첫 상담 예약금과 같은 값을 씁니다.
- 확정 조건: V04 "직원이 카카오 채널 메시지나 문자로 확정 연락을 보낸 뒤에 예약이 확정됩니다", "예약금 입금을 확인하면 1영업일 안에 확정 연락을 보냅니다".

## 안건과 걸리는 시간

- 첫 상담 60분: [[consultation-guide]](V05) "첫 상담은 진단을 포함해 약 60분 걸립니다". 흐름(문진·촬영 → 의료진 진찰 → 코디네이터 안내)도 V05에 있습니다. 60분을 0~20분 간호 1(문진·촬영), 20~40분 의료진 1(진찰), 40~60분 코디 1(일정·비용 안내)로 나누고 상담실 1은 60분 내내 쓰는 것은 [가정]입니다. 단계 나눔은 60분을 통째로 묶는 것보다 덜 보수적이라, 나눔이 틀리면 빈 시간을 더 내는 쪽으로 틀립니다.
- 의료진 재진 상담 30분: 의료진 1 + 상담실 1 내내 [가정]. 재진 고객과 이 병원에서 수술한 재시술(리터치) 문의에 씁니다. 볼트에 재시술 문서가 없고 치료 결정은 의료진 진찰 뒤라는 원칙([[about]] V01)이 있어, 재시술은 바로 수술이 아니라 이 상담부터 잡습니다[가정]. 예약금은 없고[가정] 비용은 방문 때 안내합니다.
- 두피 주사 30분: [[injection-program]](V08) "한 회차는 접수부터 귀가까지 약 30분 걸립니다". 간호 1 + 처치실 1 내내, 의료진 1은 처음 10분[가정].
- 두피 관리 60분: [[scalp-care]](V09) "한 번에 약 60분 걸립니다". 간호 1 + 관리실 1 내내[가정].
- 모발이식 수술: [[surgery-prep]](V06) "수술은 모수에 따라 반나절에서 하루가 걸립니다". 하루 480분, 반나절 240분, 의료진 1 + 간호 2 + 수술실 1 내내, 점심을 가로질러 진행[가정]. 시작은 하루 10:00, 반나절 10:00·14:30만[가정]. 수술 크기를 모르면 하루로 찾습니다(빈 시간을 적게 보이는 쪽)[가정].
- 수술 후 경과 진료 30분: 기존 예약에만 쓰고 버튼으로는 잡지 않습니다(예약 변경·경과 진료는 이 도구 밖). 의료진 1은 처음 10분, 간호 1 + 상담실 1 내내[가정].

## 사람과 방

자원은 이름 없는 수량입니다. 누가 무엇을 맡는지는 V01("의료진은 진찰과 치료 결정", "간호팀은 촬영, 시술 보조", "코디네이터와 CS 담당은 예약, 비용 안내")에 있고, 수량은 모두 [가정]입니다. 평일 낮·토요일은 의료진 2, 코디 2, 간호 3, 상담실 2, 처치실 1, 관리실 1, 수술실 1입니다. 목요일 19:00~21:00은 의료진 1, 코디 1, 간호 1이고 방은 같습니다.

앞뒤 준비 시간은 자원별로 둡니다. 수술실은 수술 뒤 정리 30분, 나머지는 0분입니다[가정]. 준비 시간도 진료 종료 안에 들어가야 합니다.

## 칸을 내는 규칙

- 칸 단위 30분, 격자는 그날 여는 시각 기준[가정]. 수술만 위의 시작 후보 목록을 씁니다.
- 첫 예약 가능 시각: 수술 외 모든 안건은 기준 시각 + 60분 이후의 첫 격자부터[가정]. 당일 칸도 냅니다. V04의 "1영업일"은 확정 연락 기한이지 방문 가능일의 제한이 아니라고 읽었습니다. 오늘과 다음 영업일 칸에는 "입금 즉시 확인 필요"를 붙입니다.
- 수술 첫 가능일: 기준일 + 7일(그날 포함)[가정]. 볼트에 최소 간격 규정이 없어, V06의 "수술 7일 전 안내"가 나갈 수 있는 간격을 하한으로 둔 것뿐입니다.
- 수술 뒤따르는 내원: [[postop-care]](V07)의 D+1 내원과 D+7 내원(D+6~D+9에서 옮길 수 있음)에 맞춰, 다음 날(D+1)이 진료일이고 D+6~D+9에 진료일이 하나 이상 있을 때만 수술 칸을 냅니다[가정]. 두 내원이 쓰는 사람·방은 보지 않습니다.
- 점심(평일 13:00~14:00)과 겹치는 칸은 내지 않습니다. V02는 점심에 접수·전화 응대가 없다고만 적었고, 진료도 쉰다는 것은 추론입니다. 수술만 점심을 가로질러 진행합니다[가정].
- 접수 마감은 포함으로 읽습니다(평일 18:30 시작 가능)[추론].
- 하루 최대: 첫 상담 6건(기존 예약 + 가예약, 재진은 세지 않음)[가정].
- 찾는 기간: 일반 14일, 수술 28일(기준일 포함), "14일 더 보기"로 14일씩 늘립니다[가정].
- 두피 주사 회차 옮기기는 예정일 앞뒤 3일 안의 칸만 냅니다(V08 "두피 주사 예정일 앞뒤 3일 안에서는 직원이 바로 날짜를 옮길 수 있습니다").
- 가예약은 입금 기한까지 유지합니다: 가예약한 날의 다음 진료일 진료 종료까지, 단 칸 시작 시각을 넘지 않습니다. 풀리기 60분 전부터 "곧 풀림"을 보입니다[가정]. 영업일에는 토요일이 들어갑니다[가정].
- 제안 칸: 가장 빠른 칸 하나, 그다음 날짜가 다르거나 같은 날이면 시간대 묶음이 다른 가장 빠른 칸 하나[가정]. 시간대 묶음은 오전(12:00 전 시작), 낮·오후(12:00~17:59), 저녁(18:00 이후)입니다[가정].
- 떨어진 까닭이 여럿이면 아래 값의 reasonOrder 순서로 대표 까닭 하나를 보입니다[가정].

## 문장 틀

아래 값의 templates는 AI가 새로 쓴 [가정] 문장입니다. 볼트 원문이 아닙니다. 칸({{…}})만 채우고, 볼트 읽기 때 광고 표현 검사([[ad-expression-guide]], V15)를 한 번 통과해야 합니다. 고객에게 읽는 문장에는 '가예약'이라는 말을 넣지 않습니다. 입금 계좌는 문장에 넣지 않고, 화면에서 문장 밖에 "입금 안내는 예약 프로그램 문구 사용" 표시만 따로 둡니다(그대로 읽어 버리지 않게). 확정 조건은 한 문장으로 한 번만 말합니다: 예약금 안건은 입금 확인 → 1영업일 안 확정 연락(오늘·다음 영업일 칸이면 "가까운 날짜라 입금을 바로 확인"), 수술은 입금과 의료진 일정 확인, 예약금 없는 안건은 확정 연락. 휴진을 묻는 전화에는 휴진 한 줄에서 "○일은 휴진입니다(사유). 가장 가까운 빈 시간은 …" 문장을 씁니다. 확정 문자는 사람이 보냅니다.

## 병원에 물을 질문

소요 시간 단계 나눔, 재시술을 무엇으로 잡는지, 사람·방 수, 점심을 걸치는 예약, 당일 예약과 수술 최소 간격, 하루 최대, 예약표 내보내기와 여러 직원 동시 응대, 입금 기한과 계좌 안내, 정밀 진단을 첫 상담 안에서 하는지, 수술 뒤따르는 내원 조건. 자세한 질문은 PRD 9절에 있습니다.

## 기계가 읽는 값

```json
{
  "timezone": "Asia/Seoul",
  "clinicPhone": "02-000-0000",
  "slotMinutes": 30,
  "leadMinutes": 60,
  "surgeryMinDaysAhead": 7,
  "searchDays": { "default": 14, "surgery": 28, "more": 14 },
  "bands": { "morningBefore": "12:00", "eveningFrom": "18:00" },
  "resources": {
    "doctor": "의료진",
    "coordinator": "코디",
    "nurse": "간호",
    "consultRoom": "상담실",
    "treatmentRoom": "처치실",
    "careRoom": "관리실",
    "surgeryRoom": "수술실"
  },
  "capacity": {
    "base": { "doctor": 2, "coordinator": 2, "nurse": 3, "consultRoom": 2, "treatmentRoom": 1, "careRoom": 1, "surgeryRoom": 1 },
    "overrides": [
      { "days": ["thu"], "from": "19:00", "to": "21:00", "set": { "doctor": 1, "coordinator": 1, "nurse": 1 } }
    ]
  },
  "buffers": { "surgeryRoom": { "before": 0, "after": 30 } },
  "services": {
    "first-consult": {
      "label": "첫 상담",
      "bookable": true,
      "minutes": 60,
      "phases": [
        { "from": 0, "to": 20, "use": { "nurse": 1 } },
        { "from": 20, "to": 40, "use": { "doctor": 1 } },
        { "from": 40, "to": 60, "use": { "coordinator": 1 } },
        { "from": 0, "to": 60, "use": { "consultRoom": 1 } }
      ],
      "starts": "grid",
      "lunch": "avoid",
      "earliest": "lead",
      "deposit": "deposit-consult",
      "notes": ["대기 시간이 생길 수 있어 여유 있게 오시도록 안내(V05)"]
    },
    "revisit-consult": {
      "label": "의료진 재진 상담",
      "bookable": true,
      "minutes": 30,
      "phases": [{ "from": 0, "to": 30, "use": { "doctor": 1, "consultRoom": 1 } }],
      "starts": "grid",
      "lunch": "avoid",
      "earliest": "lead",
      "deposit": null,
      "notes": ["바로 수술 아님 — 의료진 상담 뒤 수술은 '시술 → 모발이식 수술'로 잡음"]
    },
    "injection": {
      "label": "두피 주사",
      "bookable": true,
      "minutes": 30,
      "phases": [
        { "from": 0, "to": 10, "use": { "doctor": 1 } },
        { "from": 0, "to": 30, "use": { "nurse": 1, "treatmentRoom": 1 } }
      ],
      "starts": "grid",
      "lunch": "avoid",
      "earliest": "lead",
      "deposit": null,
      "notes": []
    },
    "scalp-care": {
      "label": "두피 관리",
      "bookable": true,
      "minutes": 60,
      "phases": [{ "from": 0, "to": 60, "use": { "nurse": 1, "careRoom": 1 } }],
      "starts": "grid",
      "lunch": "avoid",
      "earliest": "lead",
      "deposit": "deposit-consult",
      "notes": ["수술 받은 분은 4주 경과 진료 확인 뒤부터, 주사 당일 불가(V09)", "두피 상태가 걱정되면 정밀 진단 안내(V09·V03)"]
    },
    "surgery-full": {
      "label": "모발이식 수술(하루)",
      "bookable": true,
      "minutes": 480,
      "phases": [{ "from": 0, "to": 480, "use": { "doctor": 1, "nurse": 2, "surgeryRoom": 1 } }],
      "starts": ["10:00"],
      "lunch": "through",
      "earliest": "surgery",
      "deposit": "deposit-surgery",
      "notes": ["수술 전 검사 날짜는 따로 안내(V06)"]
    },
    "surgery-half": {
      "label": "모발이식 수술(반나절)",
      "bookable": true,
      "minutes": 240,
      "phases": [{ "from": 0, "to": 240, "use": { "doctor": 1, "nurse": 2, "surgeryRoom": 1 } }],
      "starts": ["10:00", "14:30"],
      "lunch": "through",
      "earliest": "surgery",
      "deposit": "deposit-surgery",
      "notes": ["수술 전 검사 날짜는 따로 안내(V06)"]
    },
    "postop-visit": {
      "label": "수술 후 경과 진료",
      "bookable": false,
      "minutes": 30,
      "phases": [
        { "from": 0, "to": 10, "use": { "doctor": 1 } },
        { "from": 0, "to": 30, "use": { "nurse": 1, "consultRoom": 1 } }
      ],
      "starts": "grid",
      "lunch": "avoid",
      "earliest": "lead",
      "deposit": null,
      "notes": []
    }
  },
  "surgeryFollowUps": { "nextDayMustBeOpen": true, "d7Window": { "from": 6, "to": 9 } },
  "surgeryCancelNoticeDays": 14,
  "dailyMax": [{ "service": "first-consult", "max": 6, "counts": ["first-consult"] }],
  "injectionMoveWindow": { "before": 3, "after": 3, "outsideNote": "4~14일 늦어지면 간호팀 확인, 14일 넘으면 의료진 진료 뒤 다시 시작(V08)" },
  "injectionProgram": { "intervalDays": 14, "sessions": 10 },
  "hold": { "until": "next-open-day-close", "capAtSlotStart": true, "warnMinutesBefore": 60 },
  "businessDaysIncludeSaturday": true,
  "suggestCount": 2,
  "reasonOrder": [
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
    "resource"
  ],
  "scopeLine": "예약 변경·수술 후 경과 진료 → 예약표에서 확인(이 도구 밖)",
  "intake": [
    {
      "key": "consult",
      "label": "상담",
      "question": "처음 오시나요?",
      "answers": [
        { "key": "first", "label": "예, 처음", "service": "first-consult" },
        { "key": "returning", "label": "아니오, 재진", "service": "revisit-consult" }
      ]
    },
    {
      "key": "procedure",
      "label": "시술",
      "subs": [
        {
          "key": "surgery",
          "label": "모발이식 수술",
          "question": "첫 상담을 받으셨나요?",
          "answers": [
            { "key": "yes", "label": "예", "service": "surgery-full", "sizes": ["surgery-full", "surgery-half"] },
            { "key": "no", "label": "아니오", "service": "first-consult", "redirect": "처음 오시는 분은 첫 상담부터(V05)" }
          ]
        },
        {
          "key": "injection",
          "label": "두피 주사",
          "question": "어떤 주사 예약인가요?",
          "answers": [
            { "key": "new", "label": "처음(진찰 전)", "service": "first-consult", "redirect": "처음 오시는 분은 첫 상담부터(V05·V08)" },
            { "key": "start", "label": "시작·다음 회차", "service": "injection", "notes": ["첫 회차는 진찰 뒤에만(V08)"] },
            { "key": "move", "label": "회차 옮기기", "service": "injection", "mode": "move" }
          ]
        },
        {
          "key": "scalp-care",
          "label": "두피 관리",
          "question": "처음이세요?",
          "answers": [
            { "key": "first", "label": "예, 처음", "service": "first-consult", "redirect": "처음 오시는 분은 첫 상담부터(V05)" },
            { "key": "returning", "label": "아니오", "service": "scalp-care" }
          ]
        }
      ]
    },
    {
      "key": "retouch",
      "label": "재시술",
      "hint": "보강 · 추가 이식 · 재수술",
      "question": "여기서 수술 받으셨나요?",
      "answers": [
        { "key": "here", "label": "예, 여기서", "service": "revisit-consult", "notes": ["담당(집도) 의료진 일정은 예약표에서 확인"] },
        { "key": "elsewhere", "label": "다른 병원", "service": "first-consult", "redirect": "다른 병원에서 수술 받은 분은 첫 상담부터[가정]" }
      ]
    }
  ],
  "templates": {
    "readout-open": "지금 비어 있는 시간을 말씀드릴게요.",
    "readout-two": "{{slot1}}, 또는 {{slot2}}에 자리가 있습니다.",
    "readout-one": "{{slot1}}에 자리가 있습니다.",
    "readout-service-first-consult": "첫 상담은 진단을 포함해 약 {{minutes}}분 걸리고, 대기 시간이 생길 수 있어 여유 있게 오시면 됩니다.",
    "readout-service-revisit-consult": "의료진 상담은 약 {{minutes}}분 걸립니다. 상담 비용은 방문하실 때 안내드립니다.",
    "readout-service-injection": "두피 주사는 접수부터 귀가까지 약 {{minutes}}분 걸립니다.",
    "readout-service-scalp-care": "두피 관리는 약 {{minutes}}분 걸립니다.",
    "readout-service-surgery-full": "수술 다음 날에도 내원하셔야 합니다.",
    "readout-service-surgery-half": "수술 다음 날에도 내원하셔야 합니다.",
    "readout-deposit-first-consult": "예약금은 {{deposit}}이고, 방문하시면 상담비로 전환됩니다.",
    "readout-deposit-scalp-care": "예약금은 {{deposit}}이고, 방문하시면 관리비로 전환됩니다.",
    "readout-deposit-surgery-full": "수술 예약금은 {{deposit}}이고, 수술비에 포함됩니다.",
    "readout-deposit-surgery-half": "수술 예약금은 {{deposit}}이고, 수술비에 포함됩니다.",
    "readout-close-deposit": "예약금 입금을 확인하면 1영업일 안에 확정 연락(카카오 채널이나 문자)을 드리고, 그때 예약이 확정됩니다.",
    "readout-close-deposit-near": "가까운 날짜라 입금을 바로 확인해야 하고, 확정 연락(카카오 채널이나 문자)을 드려야 예약이 확정됩니다.",
    "readout-close-no-deposit": "확정 연락(카카오 채널이나 문자)을 드려야 예약이 확정됩니다.",
    "readout-close-surgery": "예약금 입금과 의료진 일정 확인이 끝나면 확정 연락(카카오 채널이나 문자)을 드리고, 수술 전 검사 날짜는 따로 안내드립니다.",
    "readout-closed": "{{range}} 휴진입니다({{reason}}). 가장 가까운 빈 시간은 {{slot1}}입니다.",
    "readout-closed-none": "{{range}} 휴진입니다({{reason}}).",
    "account-placeholder": "입금 안내는 예약 프로그램 문구 사용",
    "hold-line": "{{date}} {{start}}~{{end}} {{service}} · 입금 대기(빈자리 가예약, {{until}}까지) · 메모: {{memo}}",
    "hold-line-no-deposit": "{{date}} {{start}}~{{end}} {{service}} · 확정 연락 대기(빈자리 가예약, {{until}}까지) · 메모: {{memo}}",
    "confirm-first-consult": "안녕하세요, 샘플의원입니다. {{date}} {{time}} 첫 상담 예약이 확정되었습니다. 상담은 진단을 포함해 약 {{minutes}}분 걸립니다. 복용 중인 약과 영양제 이름을 적어 오시고, 머리를 감고 스타일링 제품 없이 와 주세요. 예약 변경은 방문 1일 전 오후 6시까지 할 수 있습니다. 문의는 {{clinicPhone}}으로 해 주세요. 감사합니다.",
    "confirm-revisit-consult": "안녕하세요, 샘플의원입니다. {{date}} {{time}} 의료진 상담 예약이 확정되었습니다. 예약 변경은 방문 1일 전 오후 6시까지 할 수 있습니다. 문의는 {{clinicPhone}}으로 해 주세요. 감사합니다.",
    "confirm-injection": "안녕하세요, 샘플의원입니다. {{date}} {{time}} 두피 주사 예약이 확정되었습니다. 주사를 맞은 날에는 머리를 감지 않고 다음 날부터 감으시면 됩니다. 일정을 바꾸셔야 하면 {{clinicPhone}}으로 연락 주세요. 감사합니다.",
    "confirm-scalp-care": "안녕하세요, 샘플의원입니다. {{date}} {{time}} 두피 관리 예약이 확정되었습니다. 관리는 약 {{minutes}}분 걸립니다. 예약 변경은 방문 1일 전 오후 6시까지 할 수 있습니다. 문의는 {{clinicPhone}}으로 해 주세요. 감사합니다.",
    "confirm-surgery-full": "안녕하세요, 샘플의원입니다. {{date}} {{time}} 모발이식 수술 일정이 확정되었습니다. 수술 다음 날 {{nextDay}}에도 내원하셔야 합니다. 수술 7일 전과 1일 전에 수술 전 안내를 따로 보내드립니다. 문의는 {{clinicPhone}}으로 해 주세요. 감사합니다.",
    "confirm-surgery-half": "안녕하세요, 샘플의원입니다. {{date}} {{time}} 모발이식 수술 일정이 확정되었습니다. 수술 다음 날 {{nextDay}}에도 내원하셔야 합니다. 수술 7일 전과 1일 전에 수술 전 안내를 따로 보내드립니다. 문의는 {{clinicPhone}}으로 해 주세요. 감사합니다."
  }
}
```

가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.
