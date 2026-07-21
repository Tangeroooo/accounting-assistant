import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, FolderOpen, LoaderCircle, ReceiptText, Sparkles } from "lucide-react";
import { useState } from "react";

import type { IncomeType, ProjectData } from "../types";

interface ProjectOnboardingProps {
  project: ProjectData;
  projectFilePath?: string;
  requiresDirectory: boolean;
  webMode: boolean;
  updateProject: (updater: (project: ProjectData) => ProjectData) => void;
  onChooseDirectory: () => Promise<boolean>;
  onFinish: () => void;
  onOpen: () => void;
}

const steps = [
  { title: "팀 기본정보", description: "보고서 제목과 활동 기간을 먼저 정합니다." },
  { title: "수입 입력", description: "회비 단가와 인원수, 지원금을 입력합니다." },
  { title: "저장 위치", description: ".barun 파일을 저장할 폴더와 이름을 선택합니다." },
];

export default function ProjectOnboarding({ project, projectFilePath, requiresDirectory, webMode, updateProject, onChooseDirectory, onFinish, onOpen }: ProjectOnboardingProps) {
  const [step, setStep] = useState(0);
  const [choosingStorage, setChoosingStorage] = useState(false);
  const meta = project.meta;
  const setMeta = (key: keyof ProjectData["meta"], value: string | number) => updateProject((current) => ({ ...current, meta: { ...current.meta, [key]: value } }));
  const incomeAmount = (type: IncomeType) => project.incomes.filter((income) => income.type === type).reduce((sum, income) => sum + income.amount, 0);
  const setIncomeAmount = (type: IncomeType, amount: number) => updateProject((current) => {
    const existing = current.incomes.find((income) => income.type === type);
    if (existing) return { ...current, incomes: current.incomes.map((income) => income.id === existing.id ? { ...income, amount } : income) };
    return { ...current, incomes: [...current.incomes, { id: crypto.randomUUID(), type, amount, receivedAt: "", memo: "" }] };
  });
  const basicReady = Boolean(meta.community.trim() && meta.teamName.trim());
  const duesTotal = Math.max(0, project.duesPerPerson) * Math.max(0, meta.headcount);
  const totalIncome = duesTotal + incomeAmount("teamSupport") + incomeAmount("flowing");
  const storageReady = !requiresDirectory || Boolean(projectFilePath);
  const visibleSteps = webMode
    ? steps.map((item, index) => index === 2 ? { title: "저장과 백업", description: "자동 복구와 .barun 백업을 확인합니다." } : item)
    : steps;
  const chooseStorage = async () => {
    setChoosingStorage(true);
    try {
      await onChooseDirectory();
    } finally {
      setChoosingStorage(false);
    }
  };

  return <main className="onboarding-shell">
    <div className="onboarding-brand"><span><ReceiptText size={20} /></span><div><strong>아웃리치 회계</strong><small>처음 회계해도 순서대로</small></div></div>
    <section className="onboarding-card">
      <div className="onboarding-aside">
        <div><span className="eyebrow">NEW PROJECT</span><h1>회계 프로젝트를<br />함께 준비해 볼게요.</h1><p>지금 입력한 내용은 나중에 언제든 수정할 수 있습니다.</p></div>
        <ol>{visibleSteps.map((item, index) => <li className={`${index === step ? "active" : ""} ${index < step ? "done" : ""}`} key={item.title}><span>{index < step ? <Check size={15} /> : index + 1}</span><div><strong>{item.title}</strong><small>{item.description}</small></div></li>)}</ol>
        <button className="onboarding-open" onClick={onOpen}><FolderOpen size={18} /><span><strong>기존 .barun 프로젝트 열기</strong><small>저장해 둔 *.barun 파일을 선택합니다</small></span></button>
      </div>
      <div className="onboarding-content">
        {step === 0 && <>
          <div className="onboarding-heading"><span>1 / 3</span><h2>어느 팀의 회계인가요?</h2><p>공동체와 팀 이름은 공식 보고서 제목에 사용됩니다.</p></div>
          <div className="onboarding-fields">
            <OnboardingField label="공동체" value={meta.community} placeholder="예: SNS CROSS" onChange={(value) => setMeta("community", value)} />
            <OnboardingField label="팀 이름" value={meta.teamName} placeholder="예: 강릉팀" onChange={(value) => setMeta("teamName", value)} />
            <OnboardingField label="그룹" value={meta.groupName} placeholder="선택 입력" onChange={(value) => setMeta("groupName", value)} />
            <OnboardingField label="사역지" value={meta.destination} placeholder="예: 강원도 강릉" onChange={(value) => setMeta("destination", value)} />
            <OnboardingField label="인원수" type="number" value={String(meta.headcount || "")} placeholder="예: 12" onChange={(value) => setMeta("headcount", Math.max(0, Number(value) || 0))} />
            <OnboardingField label="출발일" type="date" value={meta.startDate} onChange={(value) => setMeta("startDate", value)} />
            <OnboardingField label="도착일" type="date" value={meta.endDate} onChange={(value) => setMeta("endDate", value)} />
          </div>
          {!basicReady && <p className="onboarding-hint">공동체와 팀 이름만 입력하면 다음으로 갈 수 있습니다.</p>}
        </>}
        {step === 1 && <>
          <div className="onboarding-heading"><span>2 / 3</span><h2>사용할 수 있는 재정은 얼마인가요?</h2><p>회비는 1인당 금액과 인원수를 곱해 계산합니다. 나중에 회계 입력·검토 화면에서 바꿀 수 있습니다.</p></div>
          <div className="income-onboarding-list">
            <DuesIncomeRow value={project.duesPerPerson} headcount={meta.headcount} onChange={(amount) => updateProject((current) => ({ ...current, duesPerPerson: amount }))} />
            <IncomeRow number="2" title="팀별사역지원금" description="교회에서 팀에 지원한 사역비" value={incomeAmount("teamSupport")} onChange={(amount) => setIncomeAmount("teamSupport", amount)} />
            <IncomeRow number="3" title="재정플로잉" description="추가로 흘려보내 받은 재정" value={incomeAmount("flowing")} onChange={(amount) => setIncomeAmount("flowing", amount)} />
          </div>
          <div className="onboarding-total"><span>현재 총수입</span><strong>{totalIncome.toLocaleString("ko-KR")}원</strong></div>
        </>}
        {step === 2 && webMode && <>
          <div className="onboarding-heading"><span>3 / 3 · 저장과 백업</span><h2>작업은 이 기기에 자동 복구됩니다.</h2><p>서버로 전송하지 않고 브라우저 안에 저장합니다. 다른 기기로 옮길 때는 <strong>.barun 백업 파일</strong> 하나만 보관하세요.</p></div>
          <div className="web-storage-summary">
            <span className="storage-destination-icon"><Check size={27} /></span>
            <div><span>브라우저 자동 복구</span><strong>입력 내용과 첨부 이미지까지 이 기기에 저장</strong><small>브라우저 데이터를 지우기 전까지 다음 방문 때 자동으로 이어서 시작합니다.</small></div>
          </div>
          <button className="web-backup-action" onClick={chooseStorage} disabled={choosingStorage}>
            <FolderOpen size={22} />
            <span><strong>{choosingStorage ? "백업 파일 만드는 중" : ".barun 백업 파일 미리 저장"}</strong><small>선택 사항 · 모든 이미지가 들어 있는 파일 하나를 다운로드합니다.</small></span>
            <ArrowRight size={17} />
          </button>
          <div className="onboarding-output-preview"><div><FileSpreadsheet size={22} /><span><strong>회계보고서 Excel</strong><small>프로젝트에서 생성</small></span></div><ArrowRight size={16} /><div><ReceiptText size={22} /><span><strong>영수증철 PDF / Word</strong><small>원하는 형식으로 생성</small></span></div></div>
          <div className="safe-note"><Sparkles size={18} /><span><strong>주요 작업 뒤에는 .barun 백업을 권장합니다.</strong><small>홈 화면 위쪽의 ‘.barun 백업 저장’을 누르면 언제든 새 백업 파일을 받을 수 있습니다.</small></span></div>
        </>}
        {step === 2 && !webMode && <>
          <div className="onboarding-heading"><span>3 / 3 · 저장 위치</span><h2>프로젝트 파일을 어디에 저장할까요?</h2><p>아래 버튼을 누르면 저장할 폴더와 <strong>.barun 파일 이름</strong>을 고르는 창이 열립니다.</p></div>
          <div className={`storage-destination ${projectFilePath ? "selected" : ""}`}>
            <span className="storage-destination-icon">{projectFilePath ? <Check size={27} /> : <FolderOpen size={27} />}</span>
            <div className="storage-destination-copy">
              <span>프로젝트 파일 저장 경로</span>
              <strong>{projectFilePath ? "저장 위치를 선택했습니다" : "저장할 위치와 파일 이름을 선택해 주세요"}</strong>
              <small>{projectFilePath ? "변경하려면 오른쪽의 ‘저장 위치 변경’을 누르세요." : "예: 문서/강릉팀 회계.barun · 입력 내용과 영수증 이미지가 이 파일 하나에 저장됩니다."}</small>
              {projectFilePath && <div className="selected-storage-path"><FolderOpen size={15} /><span><small>선택한 경로</small><code>{projectFilePath}</code></span></div>}
            </div>
            <button className={`button ${projectFilePath ? "secondary" : "accent"} storage-browse-button`} onClick={chooseStorage} disabled={choosingStorage}>
              {choosingStorage ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />}
              {choosingStorage ? "저장 창 여는 중" : projectFilePath ? "저장 위치 변경" : "저장 위치 선택"}
            </button>
          </div>
          <div className="storage-choice-guide"><span>1</span><strong>저장 위치 선택</strong><ArrowRight size={15} /><span>2</span><strong>폴더·파일 이름 지정</strong><ArrowRight size={15} /><span>3</span><strong>회계 입력 시작</strong></div>
          <div className="onboarding-output-preview"><div><FileSpreadsheet size={22} /><span><strong>회계보고서 Excel</strong><small>프로젝트에서 생성</small></span></div><ArrowRight size={16} /><div><ReceiptText size={22} /><span><strong>영수증철 PDF / Word</strong><small>원하는 형식으로 생성</small></span></div></div>
          <div className="safe-note"><Sparkles size={18} /><span><strong>{projectFilePath ? "이 위치에 자동 저장됩니다." : "저장 위치는 한 번만 선택하면 됩니다."}</strong><small>{projectFilePath ? "회계 입력을 시작한 뒤 변경한 내용과 첨부 이미지가 자동으로 저장됩니다." : "선택한 .barun 파일 하나에 입력 내용과 첨부 이미지를 함께 보관합니다."}</small></span></div>
        </>}
        <div className="onboarding-actions">
          {step > 0 ? <button className="button ghost" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={17} /> 이전</button> : <span />}
          {step < 2 ? <button className="button accent" disabled={step === 0 && !basicReady} onClick={() => setStep((current) => current + 1)}>다음 <ArrowRight size={17} /></button> : <button className="button accent" disabled={!storageReady || choosingStorage} onClick={onFinish}><Check size={17} /> {storageReady ? "회계 입력 시작" : "저장 위치를 먼저 선택하세요"}</button>}
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

function DuesIncomeRow({ value, headcount, onChange }: { value: number; headcount: number; onChange: (value: number) => void }) {
  return <label className="income-onboarding-row dues-onboarding-row"><span>1</span><div><strong>회비</strong><small>1인당 회비 × {headcount.toLocaleString("ko-KR")}명</small></div><div className="dues-onboarding-input"><div className="money-input"><input type="number" min="0" value={value || ""} placeholder="1인당 금액" onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} /><em>원</em></div><strong>= {(value * headcount).toLocaleString("ko-KR")}원</strong></div></label>;
}
