import {
  AlertCircle,
  Archive,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileCheck2,
  FileImage,
  FileSpreadsheet,
  FolderOpen,
  Fuel,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Save,
  ScanLine,
  Settings,
  Sparkles,
  Trash2,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CATEGORY_DEFINITIONS,
  createEmptyProject,
  getCategory,
  type Attachment,
  type CategoryId,
  type Expense,
  type IncomeType,
  type ProjectData,
} from "./types";
import {
  applyDerivedState,
  assignPayerFromExpense,
  expenseTotals,
  incomeTotals,
  settlementSummaries,
  validateProject,
} from "./lib/accounting";
import {
  attachmentAssetUrl,
  chooseProjectDirectory,
  chooseProjectFile,
  clearClovaConfig,
  getClovaStatus,
  importAttachment,
  isTauri,
  loadProjectFile,
  saveBinaryWithDialog,
  saveClovaConfig,
  saveProjectFile,
  type ClovaStatus,
} from "./lib/desktop";
import { createAccountingWorkbook } from "./lib/excel-export";
import { recognizeReceipt, type OcrSuggestion } from "./lib/ocr";
import ProjectOnboarding from "./components/ProjectOnboarding";

type ViewId = "overview" | "incomes" | "expenses" | "receipts" | "settlements" | "export" | "settings";

const navItems: { id: ViewId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "진행 현황", icon: LayoutDashboard },
  { id: "incomes", label: "1. 수입 관리", icon: CircleDollarSign },
  { id: "expenses", label: "2. 지출 입력", icon: WalletCards },
  { id: "receipts", label: "3. 영수증 준비", icon: ReceiptText },
  { id: "settlements", label: "4. 정산 확인", icon: Users },
  { id: "export", label: "5. 검토·산출물", icon: FileCheck2 },
  { id: "settings", label: "프로젝트 설정", icon: Settings },
];

const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;

const sampleProject = (): ProjectData => {
  const now = new Date().toISOString();
  return applyDerivedState({
    ...createEmptyProject(),
    meta: {
      community: "여호수아",
      groupName: "믿음그룹",
      teamName: "강릉팀",
      destination: "강원도 강릉",
      startDate: "2026-07-27",
      endDate: "2026-07-31",
      headcount: 12,
      leaderName: "홍길동",
      leaderPhone: "010-0000-0000",
      accountantName: "김회계",
      accountantPhone: "010-1111-1111",
      pastorName: "이교역자",
      submissionDate: "2026-08-05",
    },
    incomes: [
      { id: crypto.randomUUID(), type: "dues", amount: 1_200_000, receivedAt: "2026-07-20", memo: "팀 회비" },
      { id: crypto.randomUUID(), type: "teamSupport", amount: 300_000, receivedAt: "2026-07-20", memo: "팀별 사역비" },
    ],
    people: [
      { id: "person-1", name: "김회계", bankMemo: "국민은행" },
      { id: "person-2", name: "박팀원", bankMemo: "신한은행" },
    ],
    expenses: [
      {
        id: crypto.randomUUID(), createdOrder: 1, category: "transport", date: "2026-07-27",
        content: "강릉 왕복 주유", amount: 85_000, note: "", receiptMode: "offline-original",
        originalConfirmed: true, attachments: [], itemDetails: "", isFuel: true, paymentSource: "personal",
        payerId: "person-1", settlementTargetAmount: 85_000, settledAmount: 0, settlementStatus: "pending",
      },
      {
        id: crypto.randomUUID(), createdOrder: 2, category: "meals", date: "2026-07-27",
        content: "첫날 저녁 식사", amount: 144_000, note: "", receiptMode: "offline-original",
        originalConfirmed: true, attachments: [], mealHeadcount: 12, itemDetails: "", isFuel: false,
        paymentSource: "personal", payerId: "person-2", settlementTargetAmount: 144_000,
        settledAmount: 44_000, settlementStatus: "partial",
      },
      {
        id: crypto.randomUUID(), createdOrder: 3, category: "ministry", date: "2026-07-28",
        content: "어린이 사역 재료", amount: 71_000, note: "", receiptMode: "online-printable",
        originalConfirmed: false, attachments: [], itemDetails: "색지, 네임펜", isFuel: false,
        paymentSource: "team", settlementTargetAmount: 0, settledAmount: 0, settlementStatus: "not-applicable",
      },
    ],
    categoryEvidence: [],
    receiptNumbersFinalized: false,
    updatedAt: now,
  });
};

function App() {
  const [project, setProject] = useState<ProjectData>(() => {
    const cached = localStorage.getItem("accounting-assistant-project");
    if (cached) {
      try {
        return applyDerivedState(JSON.parse(cached) as ProjectData);
      } catch {
        // 손상된 브라우저 미리보기 캐시는 무시합니다.
      }
    }
    return isTauri() ? createEmptyProject() : sampleProject();
  });
  const persistedSnapshotRef = useRef(JSON.stringify(project));
  const [view, setView] = useState<ViewId>("overview");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [clovaStatus, setClovaStatus] = useState<ClovaStatus>({ configured: false });
  const [showOnboarding, setShowOnboarding] = useState(
    isTauri() && !project.projectDirectory && !project.meta.teamName && project.expenses.length === 0,
  );

  useEffect(() => {
    const serialized = JSON.stringify(project);
    localStorage.setItem("accounting-assistant-project", serialized);
    if (!project.projectDirectory || serialized === persistedSnapshotRef.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        await saveProjectFile(project.projectDirectory!, JSON.stringify(project, null, 2));
        persistedSnapshotRef.current = serialized;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    getClovaStatus().then(setClovaStatus).catch(() => setClovaStatus({ configured: false }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const issues = useMemo(() => validateProject(project), [project]);
  const totals = useMemo(() => expenseTotals(project.expenses), [project.expenses]);
  const incomes = useMemo(() => incomeTotals(project), [project]);
  const settlements = useMemo(() => settlementSummaries(project), [project]);

  const updateProject = (updater: (current: ProjectData) => ProjectData) => {
    setProject((current) => applyDerivedState(updater(current)));
    setSaveState("idle");
  };

  const handleChooseDirectory = async () => {
    if (!isTauri()) return true;
    const projectDirectory = await chooseProjectDirectory();
    if (!projectDirectory) return false;
    updateProject((current) => ({ ...current, projectDirectory }));
    return true;
  };

  const handleSave = async () => {
    let projectDirectory = project.projectDirectory;
    if (!projectDirectory) {
      projectDirectory = (await chooseProjectDirectory()) ?? undefined;
      if (!projectDirectory) {
        setToast(isTauri() ? "저장할 폴더를 선택해 주세요." : "브라우저 미리보기에는 자동 저장되었습니다.");
        return;
      }
      setProject((current) => ({ ...current, projectDirectory }));
    }
    setSaveState("saving");
    try {
      const next = applyDerivedState({ ...project, projectDirectory });
      const serialized = JSON.stringify(next);
      await saveProjectFile(projectDirectory, JSON.stringify(next, null, 2));
      persistedSnapshotRef.current = serialized;
      setProject(next);
      setSaveState("saved");
      setToast("프로젝트를 안전하게 저장했습니다.");
    } catch (error) {
      setSaveState("error");
      setToast(error instanceof Error ? error.message : "저장하지 못했습니다.");
    }
  };

  const handleOpen = async () => {
    const path = await chooseProjectFile();
    if (!path) return;
    try {
      const opened = JSON.parse(await loadProjectFile(path)) as ProjectData;
      const next = applyDerivedState(opened);
      persistedSnapshotRef.current = JSON.stringify(next);
      setProject(next);
      setShowOnboarding(false);
      setView("overview");
      setSaveState("saved");
      setToast("프로젝트를 열었습니다.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "프로젝트를 열지 못했습니다.");
    }
  };

  const handleNew = () => {
    if (project.expenses.length > 0 && !window.confirm("현재 화면의 저장되지 않은 내용을 닫고 새 프로젝트를 시작할까요?")) return;
    const next = createEmptyProject();
    persistedSnapshotRef.current = JSON.stringify(next);
    setProject(next);
    setView("overview");
    setShowOnboarding(true);
    setSaveState("idle");
  };

  const handleFinishOnboarding = async () => {
    if (isTauri() && !project.projectDirectory) return;
    if (project.projectDirectory) {
      try {
        setSaveState("saving");
        const serialized = JSON.stringify(project);
        await saveProjectFile(project.projectDirectory, JSON.stringify(project, null, 2));
        persistedSnapshotRef.current = serialized;
        setSaveState("saved");
      } catch (error) {
        setSaveState("error");
        setToast(error instanceof Error ? error.message : "프로젝트를 저장하지 못했습니다.");
        return;
      }
    }
    setShowOnboarding(false);
    setView("overview");
    setToast("프로젝트가 준비됐습니다. 첫 지출을 등록해 보세요.");
  };

  if (showOnboarding) return <ProjectOnboarding project={project} requiresDirectory={isTauri()} updateProject={updateProject} onChooseDirectory={handleChooseDirectory} onFinish={handleFinishOnboarding} onOpen={handleOpen} />;

  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <div className="brand">
          <div className="brand-mark"><BookOpen size={21} /></div>
          <div><strong>바른장부</strong><span>아웃리치 회계 도우미</span></div>
        </div>
        <button className="project-switcher" onClick={() => setView("settings")}>
          <div className="project-avatar">{project.meta.teamName.slice(0, 1) || "팀"}</div>
          <div><strong>{project.meta.teamName || "새 회계 프로젝트"}</strong><span>{project.meta.community || "공동체 정보를 입력하세요"}</span></div>
          <ChevronDown size={16} />
        </button>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
                <Icon size={19} /><span>{item.label}</span>
                {item.id === "export" && issues.length > 0 && <em>{issues.length}</em>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-guide">
          <Sparkles size={18} />
          <strong>{incomes.total === 0 ? "첫 단계: 수입 입력" : project.expenses.length === 0 ? "다음 단계: 지출 입력" : issues.length ? `확인할 항목 ${issues.length}개` : "산출물 준비 완료"}</strong>
          <p>{incomes.total === 0 ? "회비와 지원금처럼 이번 프로젝트에 들어온 재정을 먼저 입력하세요." : project.expenses.length === 0 ? "첫 영수증을 보면서 날짜·내용·금액을 등록해 보세요." : issues.length ? "검토·산출물에서 누락된 정보를 순서대로 확인하세요." : "Excel과 영수증철을 만들 수 있습니다."}</p>
        </div>
        <div className="sidebar-footer">
          <span className={`status-dot ${clovaStatus.configured ? "online" : "fallback"}`} />
          <div><strong>{clovaStatus.configured ? "CLOVA OCR" : "오픈소스 OCR"}</strong><span>{clovaStatus.configured ? "보안 저장됨" : "자동 대체 모드"}</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar no-print">
          <div className="breadcrumb"><span>2026 여름 아웃리치</span><ArrowRight size={14} /><strong>{navItems.find((item) => item.id === view)?.label}</strong></div>
          <div className="top-actions">
            <button className="button ghost" onClick={handleNew}><Plus size={17} /> 새 프로젝트</button>
            <button className="button ghost" onClick={handleOpen}><FolderOpen size={17} /> 열기</button>
            <button className="button primary" onClick={handleSave} disabled={saveState === "saving"}>
              {saveState === "saving" ? <LoaderCircle className="spin" size={17} /> : saveState === "saved" ? <Check size={17} /> : <Save size={17} />}
              {!project.projectDirectory ? "저장 폴더 선택" : saveState === "saving" ? "자동 저장 중" : saveState === "saved" ? "자동 저장됨" : saveState === "error" ? "저장 다시 시도" : "지금 저장"}
            </button>
          </div>
        </header>

        {view === "overview" && (
          <Overview project={project} totals={totals} incomes={incomes} issues={issues} setView={setView} setEditingExpense={setEditingExpense} />
        )}
        {view === "incomes" && <IncomeView incomes={incomes} updateProject={updateProject} />}
        {view === "expenses" && (
          <ExpensesView project={project} onAdd={() => setEditingExpense(newExpense(project))} onEdit={setEditingExpense} onDelete={(id) => updateProject((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== id) }))} />
        )}
        {view === "receipts" && <ReceiptBookView project={project} updateProject={updateProject} />}
        {view === "settlements" && <SettlementView project={project} summaries={settlements} updateProject={updateProject} />}
        {view === "export" && <ExportView project={project} issues={issues} incomes={incomes} totals={totals} onToast={setToast} onPrintReceiptBook={() => { setView("receipts"); window.setTimeout(() => window.print(), 180); }} />}
        {view === "settings" && (
          <SettingsView project={project} updateProject={updateProject} clovaStatus={clovaStatus} setClovaStatus={setClovaStatus} onToast={setToast} />
        )}
      </main>

      {editingExpense && (
        <ExpenseEditor
          project={project}
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onSave={(expense, payerName) => {
            updateProject((current) => {
              const assigned = assignPayerFromExpense(current.people, expense, payerName);
              return {
                ...current,
                people: assigned.people,
                expenses: current.expenses.some((item) => item.id === assigned.expense.id)
                  ? current.expenses.map((item) => item.id === assigned.expense.id ? assigned.expense : item)
                  : [...current.expenses, assigned.expense],
              };
            });
            setEditingExpense(null);
            setToast("지출 내역을 반영했습니다. 프로젝트에 자동 저장됩니다.");
          }}
        />
      )}
      {toast && <div className="toast no-print"><BadgeCheck size={18} />{toast}</div>}
    </div>
  );
}

function Overview({ project, totals, incomes, issues, setView, setEditingExpense }: {
  project: ProjectData;
  totals: ReturnType<typeof expenseTotals>;
  incomes: ReturnType<typeof incomeTotals>;
  issues: ReturnType<typeof validateProject>;
  setView: (view: ViewId) => void;
  setEditingExpense: (expense: Expense) => void;
}) {
  const difference = incomes.total - totals.total;
  const completion = Math.max(8, Math.min(100, 100 - issues.filter((issue) => issue.severity === "error").length * 14 - issues.filter((issue) => issue.severity === "warning").length * 5));
  const incomeReady = incomes.total > 0;
  const expensesReady = project.expenses.length > 0;
  const receiptsReady = expensesReady
    && project.expenses.every((expense) => expense.receiptMode === "offline-original" ? expense.originalConfirmed : expense.attachments.length > 0)
    && (!project.expenses.some((expense) => expense.category === "transport" && expense.isFuel)
      || project.categoryEvidence.some((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation" && evidence.attachments.length > 0));
  const settlementReady = receiptsReady && settlementSummaries(project).every((summary) => summary.outstandingAmount === 0);
  const outputReady = receiptsReady && settlementReady && !issues.some((issue) => issue.severity === "error");
  const workflowSteps: { number: number; title: string; description: string; done: boolean; current: boolean; view: ViewId }[] = [
    { number: 1, title: "수입 관리", description: incomeReady ? `총 ${money(incomes.total)}을 등록했어요.` : "회비와 지원금을 입력하세요.", done: incomeReady, current: !incomeReady, view: "incomes" },
    { number: 2, title: "지출 입력", description: expensesReady ? `${project.expenses.length}건을 날짜순으로 정리했어요.` : "영수증을 보며 첫 지출을 등록하세요.", done: expensesReady, current: incomeReady && !expensesReady, view: "expenses" },
    { number: 3, title: "영수증 준비", description: receiptsReady ? "출력할 증빙이 준비됐어요." : expensesReady ? "원본 보관과 첨부를 확인하세요." : "지출을 입력하면 준비할 수 있어요.", done: receiptsReady, current: expensesReady && !receiptsReady, view: "receipts" },
    { number: 4, title: "정산 확인", description: settlementReady ? "개인 선결제 잔액을 확인했어요." : receiptsReady ? "돌려줄 금액을 확인하세요." : "영수증 준비 후 확인합니다.", done: settlementReady, current: receiptsReady && !settlementReady, view: "settlements" },
    { number: 5, title: "검토·산출물", description: outputReady ? "Excel과 영수증철을 만들 수 있어요." : "자동 검사 결과를 확인하세요.", done: false, current: receiptsReady && settlementReady, view: "export" },
  ];
  return (
    <section className="page page-overview">
      <div className="hero-row">
        <div><span className="eyebrow">ACCOUNTING WORKSPACE</span><h1>{project.meta.teamName || "회계 프로젝트"}, 오늘도 차근차근.</h1><p>입력한 내역은 항목별·날짜순으로 정리되고 영수증 번호가 자동으로 맞춰집니다.</p></div>
        <button className="button accent" onClick={() => setEditingExpense(newExpense(project))}><Plus size={18} /> 지출 등록</button>
      </div>
      <div className="workflow-strip">
        {workflowSteps.map((step) => <button key={step.number} className={`${step.done ? "done" : ""} ${step.current ? "current" : ""}`} onClick={() => step.view === "expenses" && !expensesReady ? setEditingExpense(newExpense(project)) : setView(step.view)}>
          <span className="workflow-number">{step.done ? <Check size={16} /> : step.number}</span>
          <span className="workflow-copy"><strong>{step.title}</strong><small>{step.description}</small></span>
          <ArrowRight size={15} />
        </button>)}
      </div>
      <div className="metric-grid">
        <Metric icon={CircleDollarSign} tone="navy" label="총수입" value={money(incomes.total)} sub="회비·팀별사역비·플로잉" />
        <Metric icon={WalletCards} tone="orange" label="총지출" value={money(totals.total)} sub={`${project.expenses.length}건의 영수증`} />
        <Metric icon={Archive} tone="green" label="현재 차액" value={money(difference)} sub={difference === 0 ? "수입과 지출 일치" : "환입액 포함 검산 필요"} />
        <div className="metric-card progress-card"><div className="progress-ring" style={{ "--progress": `${completion * 3.6}deg` } as React.CSSProperties}><strong>{completion}%</strong></div><div><span>제출 준비도</span><h3>{issues.length ? `${issues.length}개 확인 필요` : "검산 완료"}</h3><button onClick={() => setView("export")}>검사 결과 보기 <ArrowRight size={14} /></button></div></div>
      </div>
      <div className="overview-grid">
        <div className="panel spending-panel">
          <div className="panel-heading"><div><span className="eyebrow">EXPENSES</span><h2>항목별 지출</h2></div><button className="text-button" onClick={() => setView("expenses")}>전체 내역 <ArrowRight size={15} /></button></div>
          <div className="category-bars">
            {CATEGORY_DEFINITIONS.map((category) => {
              const amount = totals.byCategory[category.id];
              const width = totals.total ? Math.max(2, amount / totals.total * 100) : 2;
              return <div className="category-row" key={category.id}><span className={`category-index c${category.number}`}>{category.number}</span><strong>{category.label}</strong><div className="bar-track"><i style={{ width: `${width}%` }} /></div><b>{money(amount)}</b></div>;
            })}
          </div>
        </div>
        <div className="panel checklist-panel">
          <div className="panel-heading"><div><span className="eyebrow">CHECKLIST</span><h2>지금 확인할 것</h2></div><span className="issue-count">{issues.length}</span></div>
          <div className="issue-list">
            {issues.slice(0, 5).map((issue) => <div className="issue-item" key={issue.id}><span className={issue.severity}><AlertCircle size={17} /></span><div><strong>{issue.title}</strong><p>{issue.detail}</p></div></div>)}
            {issues.length === 0 && <div className="empty-state compact"><BadgeCheck size={28} /><strong>모든 핵심 검사를 통과했습니다</strong><span>출력 전 원본 영수증 순서만 다시 확인하세요.</span></div>}
          </div>
          {issues.length > 5 && <button className="full-link" onClick={() => setView("export")}>나머지 {issues.length - 5}개도 확인하기</button>}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, tone, label, value, sub }: { icon: typeof CircleDollarSign; tone: string; label: string; value: string; sub: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={21} /></div><div><span>{label}</span><h3>{value}</h3><p>{sub}</p></div></div>;
}

function IncomeView({ incomes, updateProject }: {
  incomes: ReturnType<typeof incomeTotals>;
  updateProject: (updater: (project: ProjectData) => ProjectData) => void;
}) {
  const setIncomeAmount = (type: IncomeType, amount: number) => updateProject((current) => {
    const existing = current.incomes.find((item) => item.type === type);
    if (existing) {
      return {
        ...current,
        incomes: current.incomes
          .map((item) => item.id === existing.id ? { ...item, amount } : item)
          .filter((item, index, items) => item.type !== type || items.findIndex((candidate) => candidate.type === type) === index),
      };
    }
    return { ...current, incomes: [...current.incomes, { id: crypto.randomUUID(), type, amount, receivedAt: "", memo: "" }] };
  });
  const sources: { type: IncomeType; number: number; title: string; description: string; amount: number }[] = [
    { type: "dues", number: 1, title: "회비", description: "팀원들이 낸 회비를 입력합니다.", amount: incomes.dues },
    { type: "teamSupport", number: 2, title: "팀별사역지원금", description: "교회에서 팀에 지원한 사역비를 입력합니다.", amount: incomes.teamSupport },
    { type: "flowing", number: 3, title: "재정플로잉", description: "추가로 흘려보내 받은 재정을 입력합니다.", amount: incomes.flowing },
  ];

  return <section className="page income-page">
    <PageHeading eyebrow="STEP 1 · INCOME" title="수입 관리" description="이번 프로젝트에 들어온 재정을 항목별로 입력합니다. 입력한 금액은 공식 회계보고서의 수입부와 총괄표에 반영됩니다." />
    <div className="panel income-summary-card">
      <div className="income-summary-icon"><CircleDollarSign size={28} /></div>
      <div><span>현재 등록된 총수입</span><strong>{money(incomes.total)}</strong><small>회비 + 팀별사역지원금 + 재정플로잉</small></div>
      <div className={`income-summary-status ${incomes.total > 0 ? "ready" : "empty"}`}>{incomes.total > 0 ? <Check size={17} /> : <AlertCircle size={17} />}{incomes.total > 0 ? "입력됨" : "입력 필요"}</div>
    </div>
    <div className="income-source-grid">
      {sources.map((source) => <div className="panel income-source-card" key={source.type}>
        <div className="income-source-head"><span className="income-source-number">{source.number}</span><CircleDollarSign size={21} /></div>
        <h2>{source.title}</h2>
        <p>{source.description}</p>
        <label className="income-amount-field">
          <span>금액</span>
          <div><input type="number" min="0" value={source.amount || ""} onChange={(event) => setIncomeAmount(source.type, Math.max(0, Number(event.target.value) || 0))} placeholder="0" /><em>원</em></div>
        </label>
        <div className={`income-source-status ${source.amount > 0 ? "ready" : "empty"}`}>{source.amount > 0 ? <Check size={14} /> : <span />}{source.amount > 0 ? money(source.amount) : "아직 입력하지 않음"}</div>
      </div>)}
    </div>
    <div className="privacy-note"><BadgeCheck size={17} /><div><strong>입력한 수입은 프로젝트에 자동 저장됩니다.</strong><span>금액을 바꾸면 총수입과 검산 결과, Excel 산출물에 즉시 반영됩니다.</span></div></div>
  </section>;
}

function ExpensesView({ project, onAdd, onEdit, onDelete }: { project: ProjectData; onAdd: () => void; onEdit: (expense: Expense) => void; onDelete: (id: string) => void }) {
  const [filter, setFilter] = useState<CategoryId | "all">("all");
  const expenses = project.expenses.filter((expense) => filter === "all" || expense.category === filter);
  return <section className="page"><PageHeading eyebrow="LEDGER" title="지출 내역" description="같은 항목 안에서 날짜순으로 정렬되고, 영수증 번호는 항목마다 1번부터 다시 시작합니다." action={<button className="button accent" onClick={onAdd}><Plus size={18} /> 지출 등록</button>} />
    <div className="filter-strip no-print"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 <b>{project.expenses.length}</b></button>{CATEGORY_DEFINITIONS.map((category) => <button key={category.id} className={filter === category.id ? "active" : ""} onClick={() => setFilter(category.id)}>{category.label} <b>{project.expenses.filter((expense) => expense.category === category.id).length}</b></button>)}</div>
    <div className="panel table-panel"><table className="ledger-table"><thead><tr><th>항목</th><th>날짜</th><th>내용</th><th className="numeric">금액</th><th>번호</th><th>증빙</th><th>내부 정산</th><th className="actions" /></tr></thead><tbody>
      {expenses.map((expense) => { const person = project.people.find((item) => item.id === expense.payerId); return <tr key={expense.id} onDoubleClick={() => onEdit(expense)}><td><span className={`category-pill c${getCategory(expense.category).number}`}>{getCategory(expense.category).label}</span></td><td>{expense.date}</td><td><strong>{expense.content}</strong><span>{expense.category === "meals" && expense.mealHeadcount ? `${expense.mealHeadcount}명 · ` : ""}{expense.itemDetails || expense.note}</span></td><td className="numeric"><strong>{money(expense.amount)}</strong></td><td><span className="receipt-number">{expense.receiptNumber}</span></td><td><span className={`evidence-badge ${expense.receiptMode === "offline-original" ? "offline" : "online"}`}>{expense.receiptMode === "offline-original" ? "실물 원본" : `온라인 ${expense.attachments.length}`}</span></td><td>{expense.paymentSource === "personal" ? <span className="internal-only">{person?.name || "미지정"} · {expense.settlementStatus === "settled" ? "완료" : "정산 전"}</span> : <span className="muted">팀비</span>}</td><td className="actions"><button aria-label="수정" onClick={() => onEdit(expense)}>수정</button><button aria-label="삭제" className="danger" onClick={() => onDelete(expense.id)}><Trash2 size={15} /></button></td></tr>; })}
      {expenses.length === 0 && <tr><td colSpan={8}><div className="empty-state"><ReceiptText size={34} /><strong>등록된 지출이 없습니다</strong><span>첫 영수증을 등록하면 자동으로 정렬해 드립니다.</span></div></td></tr>}
    </tbody></table></div>
    <div className="privacy-note"><BadgeCheck size={17} /><div><strong>결제자와 정산 상태는 앱 안에서만 사용됩니다.</strong><span>공식 금전출납부와 영수증철에는 출력하지 않습니다.</span></div></div>
  </section>;
}

function ReceiptBookView({ project, updateProject }: { project: ProjectData; updateProject: (updater: (project: ProjectData) => ProjectData) => void }) {
  const transportFuelEvidence = project.categoryEvidence.find((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation");
  const addFuelEvidence = async () => {
    if (!project.projectDirectory) return;
    const attachment = await importAttachment(project.projectDirectory);
    if (!attachment) return;
    updateProject((current) => {
      const existing = current.categoryEvidence.find((item) => item.category === "transport" && item.kind === "fuel-calculation");
      return { ...current, categoryEvidence: existing ? current.categoryEvidence.map((item) => item.id === existing.id ? { ...item, attachments: [...item.attachments, { ...attachment, kind: "other" }] } : item) : [...current.categoryEvidence, { id: crypto.randomUUID(), category: "transport", kind: "fuel-calculation", title: "교통비 공통 주유비 산정 증빙", attachments: [{ ...attachment, kind: "other" }] }] };
    });
  };
  return <section className="page receipt-page-wrap"><PageHeading eyebrow="RECEIPT BOOK" title="영수증철" description="공식 엑셀의 ‘영수증철’ 머리말을 기준으로, 금전출납부와 동일한 항목·날짜 순서로 출력합니다." action={<button className="button accent no-print" onClick={() => window.print()}><Printer size={18} /> 영수증철 인쇄</button>} />
    <div className="receipt-toolbar no-print"><div><span className="legend online" /><strong>온라인</strong><span>첨부 이미지 출력</span></div><div><span className="legend offline" /><strong>오프라인</strong><span>실물 원본 부착용 빈칸</span></div><div className="manual-reminder"><AlertCircle size={16} /> 날짜·금액 노란색 표시와 금액 옆 번호는 인쇄 후 직접</div></div>
    {project.expenses.map((expense) => {
      const baseAttachment = expense.receiptMode === "online-printable" ? expense.attachments[0] : undefined;
      const supporting = expense.receiptMode === "online-printable"
        ? expense.attachments.slice(1)
        : expense.attachments.filter((attachment) => attachment.kind !== "offline-preview");
      return <div className="receipt-group" key={expense.id}><ReceiptSheet project={project} expense={expense} attachment={baseAttachment} />{supporting.map((attachment) => <SupportingEvidenceSheet key={attachment.id} project={project} expense={expense} attachment={attachment} />)}</div>;
    })}
    {project.expenses.some((expense) => expense.category === "transport" && expense.isFuel) && <div className="receipt-sheet shared-evidence"><ReceiptHeader project={project} /><div className="receipt-meta"><span>교통비 공통 증빙</span><strong>주유비 산정 근거</strong><em>개별 영수증 번호와 연결하지 않는 항목 공통 자료</em></div>{transportFuelEvidence?.attachments.length ? <PrintableAttachment project={project} attachment={transportFuelEvidence.attachments[0]} alt="교통비 공통 주유비 산정 증빙" /> : <div className="attachment-placeholder no-print"><Fuel size={35} /><strong>주유비 산정 증빙 1건을 추가하세요</strong><span>주유 영수증마다 붙이지 않고 교통비 전체에 한 번만 첨부합니다.</span><button className="button secondary" onClick={addFuelEvidence} disabled={!project.projectDirectory}><Plus size={17} /> 증빙 선택</button>{!project.projectDirectory && <small>먼저 프로젝트를 저장해 주세요.</small>}</div>}</div>}
    {project.expenses.length === 0 && <div className="panel empty-state"><ReceiptText size={40} /><strong>영수증철에 배치할 내역이 없습니다</strong><span>지출을 등록하면 순서대로 출력 페이지가 만들어집니다.</span></div>}
  </section>;
}

function ReceiptHeader({ project }: { project: ProjectData }) {
  return <div className="official-receipt-header"><h2>{project.meta.community || "○○○"} 공동체 - 국내 {project.meta.teamName || "○○○팀"} - 영수증철</h2><p>※ 종이: A4용지 세로 · 금전출납부에 있는 순서대로 부착 · 영수증 번호는 금전출납부와 동일하게 직접 기입</p></div>;
}

function ReceiptSheet({ project, expense, attachment }: { project: ProjectData; expense: Expense; attachment?: Attachment }) {
  return <article className="receipt-sheet"><ReceiptHeader project={project} /><div className="receipt-meta"><span>{getCategory(expense.category).label}</span><strong>{expense.date} · {expense.content}</strong><em>금전출납부와 동일한 순서로 배치됨</em></div>
    {expense.receiptMode === "offline-original" ? <div className="physical-placeholder"><div className="corner-guide top-left" /><div className="corner-guide top-right" /><div className="corner-guide bottom-left" /><div className="corner-guide bottom-right" /><ReceiptText size={40} /><strong>이곳에 실물 영수증 원본을 붙여 주세요</strong><span>영수증을 접지 말고 날짜와 금액이 보이도록 온전하게 부착</span><small>번호와 노란색 표시는 부착 후 직접 기입</small></div> : attachment ? <PrintableAttachment project={project} attachment={attachment} alt={`${expense.content} 온라인 영수증`} /> : <div className="physical-placeholder missing"><FileImage size={40} /><strong>온라인 영수증 이미지가 없습니다</strong><span>첨부 후 다시 인쇄해 주세요.</span></div>}
  </article>;
}

function SupportingEvidenceSheet({ project, expense, attachment }: { project: ProjectData; expense: Expense; attachment: Attachment }) {
  return <article className="receipt-sheet"><ReceiptHeader project={project} /><div className="receipt-meta"><span>{getCategory(expense.category).label} 추가 증빙</span><strong>{expense.date} · {expense.content}</strong><em>{attachment.originalName}</em></div><PrintableAttachment project={project} attachment={attachment} alt={`${expense.content} 추가 증빙`} /></article>;
}

function PrintableAttachment({ project, attachment, alt }: { project: ProjectData; attachment: Attachment; alt: string }) {
  const url = project.projectDirectory ? attachmentAssetUrl(project.projectDirectory, attachment.relativePath) : "";
  if (!url) return <div className="physical-placeholder missing"><FileImage size={40} /><strong>첨부파일을 불러올 수 없습니다</strong></div>;
  return <div className="online-receipt">{attachment.mimeType === "application/pdf" ? <embed src={url} type="application/pdf" aria-label={alt} /> : <img src={url} alt={alt} />}</div>;
}

function SettlementView({ project, summaries, updateProject }: { project: ProjectData; summaries: ReturnType<typeof settlementSummaries>; updateProject: (updater: (project: ProjectData) => ProjectData) => void }) {
  const outstanding = summaries.reduce((sum, item) => sum + item.outstandingAmount, 0);
  const settled = summaries.reduce((sum, item) => sum + item.settledAmount, 0);
  return <section className="page"><PageHeading eyebrow="INTERNAL SETTLEMENT" title="개인 정산" description="누가 먼저 결제했는지 앱 내부에서만 관리하고, 공식 제출 서류에는 드러내지 않습니다." />
    <div className="metric-grid settlement-metrics"><Metric icon={Users} tone="navy" label="정산 대상자" value={`${summaries.length}명`} sub="개인 선결제자" /><Metric icon={CircleDollarSign} tone="orange" label="정산할 금액" value={money(outstanding)} sub="아직 지급하지 않은 금액" /><Metric icon={BadgeCheck} tone="green" label="정산 완료" value={money(settled)} sub="검산에 반영된 완료액" /></div>
    <div className="panel settlement-list"><div className="panel-heading"><div><span className="eyebrow">PEOPLE</span><h2>사람별 정산 현황</h2></div></div>{summaries.map((summary) => <div className="settlement-person" key={summary.personId}><div className="person-avatar">{summary.personName.slice(0, 1)}</div><div className="person-main"><strong>{summary.personName}</strong><span>{summary.expenseCount}건 · 선결제 {money(summary.paidPersonally)}</span></div><div className="settlement-progress"><div><i style={{ width: `${summary.targetAmount ? Math.min(100, summary.settledAmount / summary.targetAmount * 100) : 0}%` }} /></div><span>{money(summary.settledAmount)} / {money(summary.targetAmount)}</span></div><strong className="outstanding">남음 {money(summary.outstandingAmount)}</strong><button className="button secondary" onClick={() => updateProject((current) => ({ ...current, expenses: current.expenses.map((expense) => expense.payerId === summary.personId && expense.paymentSource === "personal" ? { ...expense, settledAmount: expense.settlementTargetAmount || expense.amount, settledAt: new Date().toISOString().slice(0, 10) } : expense) }))}>전액 정산</button></div>)}{summaries.length === 0 && <div className="empty-state"><Users size={34} /><strong>개인 선결제 내역이 없습니다</strong><span>지출 등록 시 결제자를 지정하면 사람별로 합산됩니다.</span></div>}</div>
    <div className="privacy-note"><BadgeCheck size={17} /><div><strong>개인 정산 합계와 선결제 지출 합계를 자동으로 대조합니다.</strong><span>결제자 이름, 은행 메모, 정산 상태는 프로젝트 JSON에만 저장됩니다.</span></div></div>
  </section>;
}

function ExportView({ project, issues, incomes, totals, onToast, onPrintReceiptBook }: { project: ProjectData; issues: ReturnType<typeof validateProject>; incomes: ReturnType<typeof incomeTotals>; totals: ReturnType<typeof expenseTotals>; onToast: (message: string) => void; onPrintReceiptBook: () => void }) {
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const bytes = await createAccountingWorkbook(project);
      const name = `26년 ${project.meta.community || "공동체"} 국내 회계보고서-${project.meta.teamName || "팀"}.xlsx`;
      const path = await saveBinaryWithDialog(bytes, name);
      if (path !== null) onToast("원본 템플릿을 보존한 새 Excel 파일을 만들었습니다.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Excel 파일을 만들지 못했습니다.");
    } finally { setExporting(false); }
  };
  const difference = incomes.total - totals.total;
  return <section className="page"><PageHeading eyebrow="FINAL REVIEW & OUTPUTS" title="검토·산출물" description="왼쪽의 확인 항목을 해결한 뒤 회계보고서와 영수증철을 이 화면에서 차례로 만듭니다." />
    <div className="reconcile-card"><div><span>총수입</span><strong>{money(incomes.total)}</strong></div><i>−</i><div><span>총지출</span><strong>{money(totals.total)}</strong></div><i>=</i><div className={difference === 0 ? "balanced" : "unbalanced"}><span>검산 차액</span><strong>{money(difference)}</strong></div><div className={`balance-status ${difference === 0 ? "ok" : "warn"}`}>{difference === 0 ? <Check size={18} /> : <AlertCircle size={18} />}{difference === 0 ? "일치" : "확인 필요"}</div></div>
    <div className="export-grid"><div className="panel validation-panel"><div className="panel-heading"><div><span className="eyebrow">AUTOMATIC CHECKS</span><h2>자동 검사 결과</h2></div><div className="severity-summary"><span className="error">오류 {issues.filter((item) => item.severity === "error").length}</span><span className="warning">주의 {issues.filter((item) => item.severity === "warning").length}</span></div></div><div className="issue-list large">{issues.map((issue) => <div className="issue-item" key={issue.id}><span className={issue.severity}><AlertCircle size={17} /></span><div><strong>{issue.title}</strong><p>{issue.detail}</p></div></div>)}{issues.length === 0 && <div className="empty-state"><BadgeCheck size={36} /><strong>자동 검사를 모두 통과했습니다</strong><span>원본 영수증과 수기 표시를 마지막으로 확인하세요.</span></div>}</div></div>
      <div className="output-stack"><div className="panel export-panel"><div className="file-icon"><FileSpreadsheet size={34} /></div><div className="output-step">산출물 1</div><h2>공식 회계보고서 Excel</h2><p>제공된 6개 시트와 서식을 보존한 새 파일을 만듭니다.</p><ul><li><Check size={15} /> 항목 안 날짜순 정렬</li><li><Check size={15} /> 항목별 번호 자동 부여</li><li><Check size={15} /> 결제자·정산 정보 제외</li></ul><button className="button accent wide" onClick={handleExport} disabled={exporting || issues.some((issue) => issue.severity === "error")} >{exporting ? <LoaderCircle className="spin" size={18} /> : <FileSpreadsheet size={18} />}{exporting ? "복사본 생성 중" : "Excel 복사본 만들기"}</button>{issues.some((issue) => issue.severity === "error") && <small>오류를 해결하면 만들 수 있습니다.</small>}<div className="template-lock"><Archive size={16} /><span>원본 템플릿은 절대 덮어쓰지 않음</span></div></div><div className="panel export-panel receipt-output"><div className="file-icon receipt"><ReceiptText size={32} /></div><div className="output-step">산출물 2</div><h2>영수증철</h2><p>온라인 영수증과 실물 부착용 빈칸을 번호순으로 확인합니다.</p><button className="button primary wide" onClick={onPrintReceiptBook} disabled={project.expenses.length === 0}><Printer size={18} /> 인쇄·PDF 저장</button><small className="manual-output-note">노란색 표시와 번호는 인쇄 후 직접 기입합니다.</small></div></div>
    </div>
  </section>;
}

function SettingsView({ project, updateProject, clovaStatus, setClovaStatus, onToast }: { project: ProjectData; updateProject: (updater: (project: ProjectData) => ProjectData) => void; clovaStatus: ClovaStatus; setClovaStatus: (status: ClovaStatus) => void; onToast: (message: string) => void }) {
  const [url, setUrl] = useState(clovaStatus.invokeUrl ?? "");
  const [secret, setSecret] = useState("");
  const meta = project.meta;
  const setMeta = (key: keyof ProjectData["meta"], value: string | number) => updateProject((current) => ({ ...current, meta: { ...current.meta, [key]: value } }));
  const handleClovaSave = async () => { try { await saveClovaConfig(url, secret); const status = await getClovaStatus(); setClovaStatus(status); setSecret(""); onToast("CLOVA OCR 설정을 OS 보안 저장소에 보관했습니다."); } catch (error) { onToast(error instanceof Error ? error.message : "설정을 저장하지 못했습니다."); } };
  return <section className="page"><PageHeading eyebrow="PROJECT SETTINGS" title="프로젝트 설정" description="팀 기본정보, 저장 위치, OCR과 내부 관리 정보를 설정합니다. 수입은 별도의 ‘수입 관리’에서 입력합니다." />
    <div className="settings-grid"><div className="panel form-panel"><div className="panel-heading"><div><span className="eyebrow">BASIC INFO</span><h2>팀 기본 정보</h2></div></div><div className="field-grid"><Field label="공동체" value={meta.community} onChange={(value) => setMeta("community", value)} /><Field label="그룹" value={meta.groupName} onChange={(value) => setMeta("groupName", value)} /><Field label="팀 이름" value={meta.teamName} onChange={(value) => setMeta("teamName", value)} /><Field label="사역지" value={meta.destination} onChange={(value) => setMeta("destination", value)} /><Field label="출발일" type="date" value={meta.startDate} onChange={(value) => setMeta("startDate", value)} /><Field label="귀국일" type="date" value={meta.endDate} onChange={(value) => setMeta("endDate", value)} /><Field label="인원" type="number" value={String(meta.headcount)} onChange={(value) => setMeta("headcount", Number(value))} /><Field label="제출일" type="date" value={meta.submissionDate} onChange={(value) => setMeta("submissionDate", value)} /><Field label="담당 교역자" value={meta.pastorName} onChange={(value) => setMeta("pastorName", value)} /><Field label="팀장" value={meta.leaderName} onChange={(value) => setMeta("leaderName", value)} /><Field label="팀장 연락처" value={meta.leaderPhone} onChange={(value) => setMeta("leaderPhone", value)} /><Field label="회계" value={meta.accountantName} onChange={(value) => setMeta("accountantName", value)} /><Field label="회계 연락처" value={meta.accountantPhone} onChange={(value) => setMeta("accountantPhone", value)} /></div></div>
      <div className="settings-side"><div className="panel ocr-panel"><div className="panel-heading"><div><span className="eyebrow">OCR ENGINE</span><h2>영수증 인식</h2></div><span className={`engine-status ${clovaStatus.configured ? "configured" : "fallback"}`}>{clovaStatus.configured ? "CLOVA" : "Tesseract"}</span></div><p>CLOVA URL과 Key가 있으면 우선 사용하고, 둘 중 하나라도 없으면 오픈소스 OCR로 자동 대체합니다.</p><label><span>Receipt OCR Invoke URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://.../document/receipt" /></label><label><span>Secret Key</span><input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={clovaStatus.configured ? "변경할 때만 새 키 입력" : "X-OCR-SECRET"} /></label><button className="button primary wide" onClick={handleClovaSave} disabled={!url || !secret}>보안 저장소에 저장</button>{clovaStatus.configured && <button className="text-button danger-text" onClick={async () => { await clearClovaConfig(); setClovaStatus({ configured: false }); setUrl(""); onToast("CLOVA 설정을 삭제했습니다. 오픈소스 OCR로 전환합니다."); }}><RotateCcw size={15} /> 설정 삭제·대체 OCR 사용</button>}<small>Secret Key는 프로젝트 JSON이나 Excel에 저장하지 않습니다.</small></div>
        <div className="panel folder-panel"><FolderOpen size={25} /><div><span>프로젝트 폴더</span><strong>{project.projectDirectory || "아직 선택하지 않음"}</strong></div></div></div>
    </div>
    <div className="settings-bottom-grid settings-bottom-single">
      <div className="panel people-panel"><div className="panel-heading"><div><span className="eyebrow">OPTIONAL · INTERNAL ONLY</span><h2>정산 이름 관리</h2></div><span className="optional-badge">필요할 때만</span></div><p>지출에서 ‘개인이 먼저 결제’를 선택하고 이름을 입력하면 여기에 자동으로 추가됩니다. 이 화면에서는 이름과 계좌 메모를 고칠 수 있습니다.</p><div className="people-rows">{project.people.map((person) => <div className="person-edit-row" key={person.id}><div className="person-avatar">{person.name.slice(0, 1) || "?"}</div><input value={person.name} onChange={(event) => updateProject((current) => ({ ...current, people: current.people.map((item) => item.id === person.id ? { ...item, name: event.target.value } : item) }))} placeholder="이름" /><input value={person.bankMemo} onChange={(event) => updateProject((current) => ({ ...current, people: current.people.map((item) => item.id === person.id ? { ...item, bankMemo: event.target.value } : item) }))} placeholder="은행·계좌 메모 (선택)" /><button className="icon-button" aria-label="정산 대상자 삭제" onClick={() => updateProject((current) => ({ ...current, people: current.people.filter((item) => item.id !== person.id), expenses: current.expenses.map((expense) => expense.payerId === person.id ? { ...expense, payerId: undefined } : expense) }))}><Trash2 size={15} /></button></div>)}{project.people.length === 0 && <div className="empty-state small"><Users size={28} /><strong>아직 개인 선결제자가 없습니다</strong><span>미리 등록하지 않아도 됩니다. 지출 입력 중 이름을 바로 적어 주세요.</span></div>}</div></div>
    </div>
  </section>;
}

function ExpenseEditor({ project, expense, onClose, onSave }: { project: ProjectData; expense: Expense; onClose: () => void; onSave: (expense: Expense, payerName?: string) => void }) {
  const [draft, setDraft] = useState(expense);
  const [payerName, setPayerName] = useState(project.people.find((person) => person.id === expense.payerId)?.name ?? "");
  const [ocr, setOcr] = useState<OcrSuggestion | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const update = <K extends keyof Expense>(key: K, value: Expense[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const attach = async () => {
    if (!project.projectDirectory) return;
    const attachment = await importAttachment(project.projectDirectory);
    if (attachment) update("attachments", [...draft.attachments, { ...attachment, kind: draft.receiptMode === "online-printable" ? "online-receipt" : "offline-preview" }]);
  };
  const runOcr = async (attachment: Attachment) => {
    if (!project.projectDirectory) return;
    setOcrProgress(0);
    try { setOcr(await recognizeReceipt(project.projectDirectory, attachment, setOcrProgress)); } finally { setOcrProgress(null); }
  };
  return <div className="modal-backdrop no-print" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="expense-drawer"><div className="drawer-header"><div><span className="eyebrow">EXPENSE</span><h2>{project.expenses.some((item) => item.id === expense.id) ? "지출 수정" : "새 지출 등록"}</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><div className="drawer-body">
    <div className="field-grid editor-grid"><label className="field"><span>항목</span><select value={draft.category} onChange={(event) => update("category", event.target.value as CategoryId)}>{CATEGORY_DEFINITIONS.map((category) => <option key={category.id} value={category.id}>{category.number}. {category.label}</option>)}</select></label><Field label="날짜" type="date" value={draft.date} onChange={(value) => update("date", value)} /><label className="field full"><span>내용</span><input value={draft.content} onChange={(event) => update("content", event.target.value)} placeholder="예: 첫날 저녁 식사" /></label><Field label="금액" type="number" value={String(draft.amount || "")} onChange={(value) => update("amount", Number(value))} /><Field label="세부 품목" value={draft.itemDetails} onChange={(value) => update("itemDetails", value)} />{draft.category === "meals" && <Field label="식사 인원" type="number" value={String(draft.mealHeadcount || "")} onChange={(value) => update("mealHeadcount", Number(value))} />}{draft.category === "transport" && <label className="check-field"><input type="checkbox" checked={draft.isFuel} onChange={(event) => update("isFuel", event.target.checked)} /><Fuel size={17} /><span><strong>주유비 지출</strong><small>교통비 공통 산정 증빙 1건 검사</small></span></label>}<label className="field full"><span>비고</span><input value={draft.note} onChange={(event) => update("note", event.target.value)} placeholder="공식 금전출납부 비고란에 표시할 내용만" /></label></div>
    <div className="editor-section"><div className="section-title"><div><span>영수증 형태</span><small>실물 원본은 빈 부착칸, 온라인 영수증은 이미지로 출력합니다.</small></div></div><div className="choice-cards"><button className={draft.receiptMode === "offline-original" ? "selected" : ""} onClick={() => update("receiptMode", "offline-original")}><ReceiptText size={22} /><strong>오프라인 실물</strong><span>출력 후 원본 부착</span></button><button className={draft.receiptMode === "online-printable" ? "selected" : ""} onClick={() => update("receiptMode", "online-printable")}><FileImage size={22} /><strong>온라인 자료</strong><span>이미지 함께 출력</span></button></div>{draft.receiptMode === "offline-original" && <label className="original-confirm"><input type="checkbox" checked={draft.originalConfirmed} onChange={(event) => update("originalConfirmed", event.target.checked)} /><Check size={15} /><span>제출할 실물 영수증 원본을 보관 중입니다.</span></label>}
      <div className="attachment-box"><div><ScanLine size={23} /><span><strong>{draft.attachments.length ? `${draft.attachments.length}개 첨부됨` : "영수증 사진 또는 PDF"}</strong><small>{project.projectDirectory ? "OCR로 날짜·금액·상호명을 제안합니다." : "프로젝트를 먼저 저장하면 첨부할 수 있습니다."}</small></span></div><button className="button secondary" onClick={attach} disabled={!project.projectDirectory}><Plus size={16} /> 파일 선택</button></div>{draft.attachments.map((attachment) => <div className="attachment-row" key={attachment.id}><FileImage size={17} /><strong>{attachment.originalName}</strong><select value={attachment.kind} onChange={(event) => update("attachments", draft.attachments.map((item) => item.id === attachment.id ? { ...item, kind: event.target.value as Attachment["kind"] } : item))}><option value="online-receipt">영수증</option><option value="card-slip">카드전표</option><option value="transaction-statement">거래명세서</option><option value="order-detail">주문상세</option><option value="insurance-certificate">보험증권</option><option value="transfer-proof">이체확인</option><option value="other">기타</option></select><button onClick={() => runOcr(attachment)} disabled={ocrProgress !== null}>{ocrProgress !== null ? `${Math.round(ocrProgress * 100)}%` : "OCR"}</button><button onClick={() => update("attachments", draft.attachments.filter((item) => item.id !== attachment.id))}><X size={15} /></button></div>)}
      {ocr && <div className="ocr-suggestion"><div><Sparkles size={18} /><strong>{ocr.provider === "clova" ? "CLOVA" : "오픈소스"} OCR 제안</strong></div><div className="ocr-values"><button onClick={() => ocr.date && update("date", ocr.date)} disabled={!ocr.date}><span>날짜</span><strong>{ocr.date || "인식 못함"}</strong></button><button onClick={() => ocr.amount && update("amount", ocr.amount)} disabled={!ocr.amount}><span>금액</span><strong>{ocr.amount ? money(ocr.amount) : "인식 못함"}</strong></button><button onClick={() => ocr.merchant && update("content", ocr.merchant)} disabled={!ocr.merchant}><span>상호</span><strong>{ocr.merchant || "인식 못함"}</strong></button></div><small>값을 클릭하면 입력란에 반영됩니다. 반드시 영수증 원본과 대조하세요.</small></div>}
    </div>
    <div className="editor-section internal-section"><div className="section-title"><div><span>누가 결제했나요? <em>앱 내부 전용</em></span><small>기본은 팀비입니다. 팀원이 먼저 냈을 때만 이름을 입력하세요.</small></div></div><div className="choice-cards payment"><button className={draft.paymentSource === "team" ? "selected" : ""} onClick={() => update("paymentSource", "team")}><WalletCards size={20} /><span><strong>팀비로 결제</strong><small>별도 정산 없음</small></span></button><button className={draft.paymentSource === "personal" ? "selected" : ""} onClick={() => update("paymentSource", "personal")}><Users size={20} /><span><strong>개인이 먼저 결제</strong><small>나중에 돌려줄 금액</small></span></button></div>{draft.paymentSource === "personal" && <div className="payer-inline"><label className="field"><span>먼저 결제한 사람</span><input list="known-payers" value={payerName} onChange={(event) => { const name = event.target.value; setPayerName(name); const existing = project.people.find((person) => person.name === name); update("payerId", existing?.id); }} placeholder="이름을 바로 입력하세요" /><datalist id="known-payers">{project.people.filter((person) => person.name.trim()).map((person) => <option value={person.name} key={person.id} />)}</datalist><small>{project.people.some((person) => person.name === payerName) ? "기존 정산 대상자를 선택했습니다." : payerName.trim() ? "새 이름은 내역 반영 시 자동 등록됩니다." : "설정에서 미리 추가할 필요가 없습니다."}</small></label><div className="field-grid settlement-fields"><Field label="돌려줄 금액" type="number" value={String(draft.settlementTargetAmount || draft.amount || "")} onChange={(value) => update("settlementTargetAmount", Number(value))} /><Field label="이미 돌려준 금액" type="number" value={String(draft.settledAmount || "")} onChange={(value) => update("settledAmount", Number(value))} /></div></div>}<div className="internal-caption"><BadgeCheck size={15} /> 이름과 정산 정보는 공식 Excel과 영수증철에 표시되지 않습니다.</div></div>
  </div><div className="drawer-footer"><button className="button ghost" onClick={onClose}>취소</button><button className="button accent" onClick={() => onSave(draft, payerName)} disabled={!draft.date || !draft.content.trim() || draft.amount <= 0 || (draft.paymentSource === "personal" && !payerName.trim())}><Check size={17} /> 내역 반영</button></div></div></div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }

function newExpense(project: ProjectData): Expense {
  return { id: crypto.randomUUID(), createdOrder: Math.max(0, ...project.expenses.map((expense) => expense.createdOrder)) + 1, category: "transport", date: "", content: "", amount: 0, note: "", receiptMode: "offline-original", originalConfirmed: false, attachments: [], itemDetails: "", isFuel: false, paymentSource: "team", settlementTargetAmount: 0, settledAmount: 0, settlementStatus: "not-applicable" };
}

export default App;
