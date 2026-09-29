/** 볼트 규칙·예약 파일이 깨졌을 때(PRD F2). 기본값으로 빈 시간을 내지 않고, 직원이 할 일(예약표 확인)과 무엇이 틀렸는지를 보인다. */
export function ErrorPanel({ errors, title = "규칙 오류 — 예약표에서 직접 확인" }: { errors: string[]; title?: string }) {
  return (
    <div className="card alert" role="alert">
      <h2>{title}</h2>
      <p>규칙 값이 빠지거나 깨지면 추측해서 빈 시간을 내지 않고 멈춥니다. 통화 중이면 지금 하던 대로 예약표를 보세요.</p>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
