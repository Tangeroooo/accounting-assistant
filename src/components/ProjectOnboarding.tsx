import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, FolderOpen, ReceiptText, Sparkles } from "lucide-react";
import { useState } from "react";

import type { IncomeType, ProjectData } from "../types";

interface ProjectOnboardingProps {
  project: ProjectData;
  requiresDirectory: boolean;
  updateProject: (updater: (project: ProjectData) => ProjectData) => void;
  onChooseDirectory: () => Promise<boolean>;
  onFinish: () => void;
  onOpen: () => void;
}

const steps = [
  { title: "팀 기본정보", description: "보고서 제목과 활동 기간을 먼저 정합니다." },
  { title: "들어온 재정", description: "회비와 지원금처럼 사용할 수 있는 돈을 입력합니다." },
  { title: "저장 준비", description: "영수증과 프로젝트가 보관될 폴더를 정합니다." },
];

export default function ProjectOnboarding({ project, requiresDirectory, updateProject, onChooseDirectory, onFinish, onOpen }: ProjectOnboardingProps) {
  const [step, setStep] = useState(0);
  const meta = project.meta;
  const setMeta = (key: keyof ProjectData["meta"], value: string | number) => updateProject((current) => ({ ...current, meta: { ...current.meta, [key]: value } }));
  const incomeAmount = (type: IncomeType) => project.incomes.filter((income) => income.type === type).reduce((sum, income) => sum + income.amount, 0);
  const setIncomeAmount = (type: IncomeType, amount: number) => updateProject((current) => {
    const existing = current.incomes.find((income) => income.type === type);
    if (existing) return { ...current, incomes: current.incomes.map((income) => income.id === existing.id ? { ...income, amount } : income) };
    return { ...current, incomes: [...current.incomes, { id: crypto.randomUUID(), type, amount, receivedAt: "", memo: "" }] };
  });
  const basicReady = Boolean(meta.community.trim() && meta.teamName.trim());
  const storageReady = !requiresDirectory || Boolean(project.projectDirectory);

  return <main className="onboarding-shell">
    <div className="onboarding-brand"><span><ReceiptText size={20} /></span><div><strong>바른장부</strong><small>처음 회계해도 순서대로</small></div></div>
    <section className="onboarding-card">
      <div className="onboarding-aside">
        <div><span className="eyebrow">NEW PROJECT</span><h1>회계 프로젝트를<br />함께 준비해 볼게요.</h1><p>지금 입력한 내용은 나중에 언제든 수정할 수 있습니다.</p></div>
        <ol>{steps.map((item, index) => <li className={`${index === step ? "active" : ""} ${index < step ? "done" : ""}`} key={item.title}><span>{index < step ? <Check size={15} /> : index + 1}</span><div><strong>{item.title}</strong><small>{item.description}</small></div></li>)}</ol>
        <button className="onboarding-open" onClick={onOpen}><FolderOpen size={16} /> 기존 프로젝트 열기</button>
      </div>
      <div className="onboarding-content">
        {step === 0 && <>
          <div className="onboarding-heading"><span>1 / 3</span><h2>어느 팀의 회계인가요?</h2><p>공동체와 팀 이름은 공식 보고서 제목에 사용됩니다.</p></div>
          <div className="onboarding-fields">
            <OnboardingField label="공동체" value={meta.community} placeholder="예: 여호수아" onChange={(value) => setMeta("community", value)} />
            <OnboardingField label="팀 이름" value={meta.teamName} placeholder="예: 강릉팀" onChange={(value) => setMeta("teamName", value)} />
            <OnboardingField label="그룹" value={meta.groupName} placeholder="선택 입력" onChange={(value) => setMeta("groupName", value)} />
            <OnboardingField label="사역지" value={meta.destination} placeholder="예: 강원도 강릉" onChange={(value) => setMeta("destination", value)} />
            <OnboardingField label="출발일" type="date" value={meta.startDate} onChange={(value) => setMeta("startDate", value)} />
            <OnboardingField label="귀국일" type="date" value={meta.endDate} onChange={(value) => setMeta("endDate", value)} />
          </div>
          {!basicReady && <p className="onboarding-hint">공동체와 팀 이름만 입력하면 다음으로 갈 수 있습니다.</p>}
        </>}
        {step === 1 && <>
          <div className="onboarding-heading"><span>2 / 3</span><h2>사용할 수 있는 재정은 얼마인가요?</h2><p>아직 모르면 비워 두고 나중에 프로젝트 설정에서 입력해도 됩니다.</p></div>
          <div className="income-onboarding-list">
            <IncomeRow number="1" title="회비" description="팀원들이 낸 회비" value={incomeAmount("dues")} onChange={(amount) => setIncomeAmount("dues", amount)} />
            <IncomeRow number="2" title="팀별사역지원금" description="교회에서 팀에 지원한 사역비" value={incomeAmount("teamSupport")} onChange={(amount) => setIncomeAmount("teamSupport", amount)} />
            <IncomeRow number="3" title="재정플로잉" description="추가로 흘려보내 받은 재정" value={incomeAmount("flowing")} onChange={(amount) => setIncomeAmount("flowing", amount)} />
          </div>
          <div className="onboarding-total"><span>현재 총수입</span><strong>{(incomeAmount("dues") + incomeAmount("teamSupport") + incomeAmount("flowing")).toLocaleString("ko-KR")}원</strong></div>
        </>}
        {step === 2 && <>
          <div className="onboarding-heading"><span>3 / 3</span><h2>프로젝트를 어디에 보관할까요?</h2><p>이 폴더 안에 프로젝트 파일과 영수증 사본이 함께 정리됩니다.</p></div>
          <button className={`storage-choice ${project.projectDirectory ? "selected" : ""}`} onClick={onChooseDirectory}>
            <span><FolderOpen size={27} /></span><div><strong>{project.projectDirectory ? "저장 폴더 선택 완료" : "저장 폴더 선택"}</strong><small>{project.projectDirectory || "문서 폴더 안에 팀 전용 폴더를 새로 만드는 것을 권장합니다."}</small></div>{project.projectDirectory && <Check size={21} />}
          </button>
          <div className="onboarding-output-preview"><div><FileSpreadsheet size={22} /><span><strong>회계보고서 Excel</strong><small>원본 양식의 복사본</small></span></div><ArrowRight size={16} /><div><ReceiptText size={22} /><span><strong>영수증철</strong><small>인쇄 또는 PDF 저장</small></span></div></div>
          <div className="safe-note"><Sparkles size={18} /><span><strong>이후부터는 자동 저장됩니다.</strong><small>입력할 때마다 선택한 폴더의 `회계프로젝트.json`이 안전하게 갱신됩니다.</small></span></div>
        </>}
        <div className="onboarding-actions">
          {step > 0 ? <button className="button ghost" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={17} /> 이전</button> : <span />}
          {step < 2 ? <button className="button accent" disabled={step === 0 && !basicReady} onClick={() => setStep((current) => current + 1)}>다음 <ArrowRight size={17} /></button> : <button className="button accent" disabled={!storageReady} onClick={onFinish}><Check size={17} /> 프로젝트 시작</button>}
        </div>
      </div>
    </section>
  </main>;
}

function OnboardingField({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function IncomeRow({ number, title, description, value, onChange }: { number: string; title: string; description: string; value: number; onChange: (value: number) => void }) {
  return <label className="income-onboarding-row"><span>{number}</span><div><strong>{title}</strong><small>{description}</small></div><div className="money-input"><input type="number" min="0" value={value || ""} placeholder="0" onChange={(event) => onChange(Number(event.target.value))} /><em>원</em></div></label>;
}
