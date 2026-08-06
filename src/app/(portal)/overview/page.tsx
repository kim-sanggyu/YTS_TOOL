// 시스템 개요 — 연말정산 지원툴 기능맵.
// 원본: D:\00 연말정산진행업무(26년하반기)\연말정산지원툴기능맵.pptx (2슬라이드)를 웹 화면으로 재구성.
// 업무 흐름도는 PPT 원본 이미지를 그대로 사용(public/overview/*.png). 텍스트·범례는 HTML.
// 정적 프레젠테이션(상호작용 없음)이라 서버 컴포넌트.

// ── 섹션 래퍼 ─────────────────────────────────────────────────
function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary text-[13px] font-bold text-primary-foreground">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="ml-1 space-y-1.5 text-sm leading-relaxed text-foreground">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

// 다이어그램 하단 범례(①②③④ 설명)
function Legend({ items }: { items: { k: string; lead: string; desc: string }[] }) {
  return (
    <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
      {items.map((it) => (
        <li key={it.k}>
          <span className="font-semibold text-foreground">{it.k} {it.lead}</span>
          <span>: {it.desc}</span>
        </li>
      ))}
    </ul>
  )
}

// 업무 흐름도 — PPT 원본 이미지
function DiagramImage({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      {/* 정적 로컬 다이어그램이라 next/image 대신 img 사용 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={width} height={height} className="mx-auto h-auto w-full max-w-3xl" />
    </div>
  )
}

export default function OverviewPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-9 pb-12">
        {/* 표지 */}
        <header className="space-y-1 border-b pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">연말정산 지원툴 기능맵</h1>
          <p className="text-sm text-muted-foreground">작년(2025년) 귀속 데이터를 원천으로 다음 해(2026년) 연말정산시스템 수정·검증을 지원하는 도구 모음</p>
        </header>

        {/* 1. 시스템 개요 */}
        <Section n="1" title="시스템 개요">
          <Bullets items={[
            "작년(2025년) 귀속 연말정산 데이터를 원천으로 다음 해(2026년) 연말정산시스템 수정을 위한 데이터를 생성한다.",
            "주로 다음 해 개정세법에 맞게 세액계산 프로그램을 수정한 후 세액계산 오류를 검증하는 데 활용한다.",
          ]} />
        </Section>

        {/* 2. 제공 서비스 */}
        <Section n="2" title="제공 서비스">
          <Bullets items={[
            <><span className="font-medium text-foreground">(2026년 개정세법이 나오기 전까지)</span> 2026년 세액계산 소스를 수정할 때 2025년 데이터를 골든마스터로 확정하고 회귀검증 기능을 제공한다.</>,
            <><span className="font-medium text-foreground">(2026년 개정세법이 나온 후)</span> 2026년 세액계산 소스를 수정한 후 국세청 모의계산을 원격 호출하여 세액계산 결과를 검증한다. 또한 2026년 전산매체 제출요령 문서를 근거로 2025년 전산매체 생성 프로그램 수정을 지원하는 툴을 제공한다.</>,
          ]} />
        </Section>

        {/* 3. 세부 서비스 — 개정세법 이전 */}
        <Section n="3" title="세부 서비스 (개정세법 공고 이전, ~07.31)">
          <p className="ml-1 text-sm text-muted-foreground">— 개정세법 이전까지 2026년 세액계산 프로그램을 수정하고 회귀검증할 수 있는 환경을 제공</p>
          <DiagramImage src="/overview/service-before.png" alt="개정세법 공고 이전 업무 흐름도" width={849} height={340} />
          <Legend items={[
            { k: "①", lead: "경계나이 생성", desc: "차년이 되면 부양가족 나이 증가로 공제요건이 변경될 수 있는데, 이를 방지하기 위해 나이 하나 작은 주민번호로 치환하는 작업" },
            { k: "②", lead: "차년 데이터 생성", desc: "연도+1 등 다음 연도에 맞게 데이터를 수정하여 생성" },
            { k: "③", lead: "세액계산(YTS)", desc: "차년 데이터를 대상으로 2026년 세액계산 소스를 2025년 세법으로 세액계산(아직 차년 개정세법이 미공지된 시점)" },
            { k: "④", lead: "회귀검증", desc: "2026년 세액계산 SW를 리팩토링했을 때 골든마스터와 동일한지 비교 → 리팩토링에 의한 side effect 유무를 확인" },
          ]} />
        </Section>

        {/* 4. 세부 서비스 — 개정세법 이후 */}
        <Section n="4" title="세부 서비스 (개정세법 공고 이후, 08.01~)">
          <p className="ml-1 text-sm text-muted-foreground">— 개정세법에 맞게 2026년 세액계산 프로그램을 수정하고 국세청 모의계산 및 전산매체 기능으로 검증할 수 있는 환경을 제공</p>
          <DiagramImage src="/overview/service-after.png" alt="개정세법 공고 이후 업무 흐름도" width={886} height={365} />
          <Legend items={[
            { k: "①", lead: "세액계산(YTS)", desc: "2026년 개정세법에 맞게 세액계산 프로그램을 수정하여 2026년 데이터를 대상으로 일괄 세액계산 작업을 수행" },
            { k: "②", lead: "모의계산 비교", desc: "2026년 세법으로 계산된 연말정산 데이터를 국세청 모의계산으로 원격 실행하여 둘 간 결과를 비교" },
            { k: "③", lead: "전산매체 소스수정", desc: "2025년 소스와 2026년 전산매체 제출요령 문서를 비교하여 2025년 전산매체 생성 프로그램을 생성" },
            { k: "④", lead: "전산매체 파일생성 및 업로드(YTS)", desc: "2026년 전산매체를 생성하여 국세청 전산매체 제출 사이트에 업로드(2026년 연말정산의 최종 검증 기능)" },
          ]} />
        </Section>
      </div>
    </div>
  )
}
