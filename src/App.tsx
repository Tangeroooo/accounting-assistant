import {
  AlertCircle,
  Archive,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardPaste,
  Crop,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FolderOpen,
  Fuel,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  ReceiptText,
  RotateCcw,
  RotateCw,
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
  type OfflineReceiptHolder,
  type ProjectData,
} from "./types";
import {
  applyDerivedState,
  assignPayerFromExpense,
  expenseTotals,
  incomeTotals,
  isAutoTeamMinistryNote,
  reconciliationSummary,
  settlementSummaries,
  sortAndNumberExpenses,
  summarizeValidationIssues,
  teamMinistryAutoNote,
  validateProject,
} from "./lib/accounting";
import {
  attachmentAbsolutePath,
  chooseProjectFile,
  importAttachments,
  importClipboardAttachment,
  isTauri,
  openProjectDocument,
  readAttachmentBytes,
  saveBinaryWithDialog,
  saveProjectPackage,
  saveProjectPackageAs,
} from "./lib/desktop";
import { createAccountingWorkbook } from "./lib/excel-export";
import { buildReceiptBookItems, centeredColumnResizeOffset, cropPictureFrame, DEFAULT_IMAGE_LAYOUT, layoutReceiptBookItems, offlineHoldersForExpense, offlinePlaceholderLabel, pictureLayoutGeometry, receiptWatermarkLabel, resizePictureFrame, watermarkFontSizePx, type ReceiptFlowPlacement } from "./lib/receipt-book";
import { createReceiptBookPdf } from "./lib/receipt-pdf";
import { normalizeAttachmentToImages, normalizeProjectAttachmentsToImages } from "./lib/pdf-to-images";
import ProjectOnboarding from "./components/ProjectOnboarding";

type ViewId = "overview" | "accounting" | "receipts" | "settlements" | "settings";

const navItems: { id: ViewId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "진행 현황", icon: LayoutDashboard },
  { id: "accounting", label: "1. 회계 입력·검토", icon: WalletCards },
  { id: "receipts", label: "2. 영수증철 편집", icon: ReceiptText },
  { id: "settlements", label: "3. 정산 확인", icon: Users },
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
    duesPerPerson: 100_000,
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
        id: crypto.randomUUID(), createdOrder: 3, category: "teamMinistry", date: "2026-07-28",
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
  const pdfMigrationRef = useRef("");
  const [projectFilePath, setProjectFilePath] = useState<string | undefined>(() => {
    if (!isTauri()) return undefined;
    return localStorage.getItem("accounting-assistant-project-path") || undefined;
  });
  const [view, setView] = useState<ViewId>("overview");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [outputBusy, setOutputBusy] = useState<"excel" | "pdf" | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(
    isTauri() && !project.projectDirectory && !project.meta.teamName && project.expenses.length === 0,
  );

  useEffect(() => {
    const serialized = JSON.stringify(project);
    localStorage.setItem("accounting-assistant-project", serialized);
    if (!projectFilePath || serialized === persistedSnapshotRef.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        await saveProjectPackage(project, projectFilePath);
        persistedSnapshotRef.current = serialized;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [project, projectFilePath]);

  useEffect(() => {
    if (projectFilePath) localStorage.setItem("accounting-assistant-project-path", projectFilePath);
    else localStorage.removeItem("accounting-assistant-project-path");
  }, [projectFilePath]);

  const pdfAttachmentSignature = useMemo(() => [
    ...project.expenses.flatMap((expense) => expense.attachments),
    ...project.categoryEvidence.flatMap((evidence) => evidence.attachments),
  ]
    .filter((attachment) => attachment.mimeType === "application/pdf" || attachment.originalName.toLowerCase().endsWith(".pdf"))
    .map((attachment) => attachment.relativePath)
    .sort()
    .join("|"), [project.expenses, project.categoryEvidence]);

  useEffect(() => {
    if (!isTauri() || !project.projectDirectory || !pdfAttachmentSignature) return;
    const migrationKey = `${project.id}:${project.projectDirectory}:${pdfAttachmentSignature}`;
    if (pdfMigrationRef.current === migrationKey) return;
    pdfMigrationRef.current = migrationKey;
    setSaveState("saving");
    void (async () => {
      const result = await normalizeProjectAttachmentsToImages(project);
      if (pdfMigrationRef.current !== migrationKey) return;
      const next = applyDerivedState(result.project);
      if (result.convertedPdfCount > 0) setProject(next);
      try {
        if (result.convertedPdfCount > 0 && projectFilePath) await saveProjectPackage(next, projectFilePath);
        if (result.convertedPdfCount > 0) persistedSnapshotRef.current = JSON.stringify(next);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
      if (result.failures.length > 0) {
        setToast(`PDF 이미지 변환 실패: ${result.failures[0]}`);
      } else if (result.convertedPdfCount > 0) {
        setToast(`기존 PDF ${result.convertedPdfCount}개를 ${result.generatedImageCount}개 이미지로 바꾸고 프로젝트에 다시 저장했습니다.`);
      }
    })();
  }, [pdfAttachmentSignature, project.id, project.projectDirectory, projectFilePath]);

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

  const handleChooseProjectFile = async () => {
    if (!isTauri()) return true;
    try {
      const saved = await saveProjectPackageAs(project, `${project.meta.teamName || "새 회계 프로젝트"}.barun`);
      if (!saved) return false;
      const next = applyDerivedState(saved.project);
      persistedSnapshotRef.current = JSON.stringify(next);
      setProject(next);
      setProjectFilePath(saved.packagePath);
      setSaveState("saved");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "프로젝트 파일을 만들지 못했습니다.");
      return false;
    }
  };

  const handleSave = async () => {
    setSaveState("saving");
    try {
      if (!projectFilePath) {
        const saved = await saveProjectPackageAs(project, `${project.meta.teamName || "새 회계 프로젝트"}.barun`);
        if (!saved) { setSaveState("idle"); return; }
        const next = applyDerivedState(saved.project);
        persistedSnapshotRef.current = JSON.stringify(next);
        setProject(next);
        setProjectFilePath(saved.packagePath);
      } else {
        await saveProjectPackage(project, projectFilePath);
        persistedSnapshotRef.current = JSON.stringify(project);
      }
      setSaveState("saved");
      setToast("이미지를 포함한 .barun 프로젝트를 저장했습니다.");
    } catch (error) {
      setSaveState("error");
      setToast(error instanceof Error ? error.message : "저장하지 못했습니다.");
    }
  };

  const handleOpen = async () => {
    const path = await chooseProjectFile();
    if (!path) return;
    try {
      const opened = await openProjectDocument(path);
      const next = applyDerivedState(opened.project);
      persistedSnapshotRef.current = JSON.stringify(next);
      setProject(next);
      setProjectFilePath(opened.packagePath);
      setShowOnboarding(false);
      setView("overview");
      setSaveState("saved");
      setToast(opened.packagePath ? "이미지가 포함된 .barun 프로젝트를 열었습니다." : "기존 JSON 프로젝트를 열었습니다. 다음 저장 시 .barun으로 전환됩니다.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "프로젝트를 열지 못했습니다.");
    }
  };

  const handleNew = () => {
    if (project.expenses.length > 0 && !window.confirm("현재 화면의 저장되지 않은 내용을 닫고 새 프로젝트를 시작할까요?")) return;
    const next = createEmptyProject();
    persistedSnapshotRef.current = JSON.stringify(next);
    setProject(next);
    setProjectFilePath(undefined);
    setView("overview");
    setShowOnboarding(true);
    setSaveState("idle");
  };

  const handleFinishOnboarding = async () => {
    if (isTauri() && !projectFilePath) return;
    if (projectFilePath) {
      try {
        setSaveState("saving");
        const serialized = JSON.stringify(project);
        await saveProjectPackage(project, projectFilePath);
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

  const handleExcelExport = async () => {
    setOutputBusy("excel");
    try {
      const bytes = await createAccountingWorkbook(project);
      const name = `26년 ${project.meta.community || "공동체"} 국내 회계보고서-${project.meta.teamName || "팀"}.xlsx`;
      const path = await saveBinaryWithDialog(bytes, name);
      if (path !== null) setToast("원본 템플릿을 보존한 Excel 파일을 만들었습니다.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Excel 파일을 만들지 못했습니다.");
    } finally { setOutputBusy(null); }
  };

  const handleReceiptPdf = async () => {
    setOutputBusy("pdf");
    try {
      const bytes = await createReceiptBookPdf(project);
      const name = `${project.meta.community || "공동체"}-${project.meta.teamName || "팀"}-영수증철.pdf`;
      const path = await saveBinaryWithDialog(bytes, name, "pdf");
      if (path !== null) setToast("편집한 배치대로 영수증철 PDF를 저장했습니다.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "영수증철 PDF를 만들지 못했습니다.");
    } finally { setOutputBusy(null); }
  };

  if (showOnboarding) return <ProjectOnboarding project={project} projectFilePath={projectFilePath} requiresDirectory={isTauri()} updateProject={updateProject} onChooseDirectory={handleChooseProjectFile} onFinish={handleFinishOnboarding} onOpen={handleOpen} />;

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
                {item.id === "accounting" && issues.length > 0 && <em>{issues.length}</em>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-guide">
          <Sparkles size={18} />
          <strong>{incomes.total === 0 ? "첫 단계: 수입 입력" : project.expenses.length === 0 ? "다음 단계: 지출 입력" : issues.length ? `확인할 항목 ${issues.length}개` : "산출물 준비 완료"}</strong>
          <p>{incomes.total === 0 ? "회비 단가와 인원수, 지원금을 먼저 입력하세요." : project.expenses.length === 0 ? "첫 영수증을 보면서 날짜·내용·금액을 등록해 보세요." : issues.length ? "회계 입력·검토에서 누락 항목과 검산 차액을 확인하세요." : "위쪽 산출물 버튼으로 Excel과 PDF를 저장할 수 있습니다."}</p>
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
              {!projectFilePath ? "프로젝트 저장" : saveState === "saving" ? "자동 저장 중" : saveState === "saved" ? "자동 저장됨" : saveState === "error" ? "저장 다시 시도" : "지금 저장"}
            </button>
            <span className="top-action-divider" />
            <button className="button output-button excel" onClick={handleExcelExport} disabled={outputBusy !== null} title={issues.some((issue) => issue.severity === "error") ? "검토 중인 상태도 중간 확인용 Excel로 저장할 수 있습니다." : undefined}><FileSpreadsheet size={17} /> {outputBusy === "excel" ? "Excel 생성 중" : "Excel 저장"}</button>
            <button className="button output-button pdf" onClick={handleReceiptPdf} disabled={outputBusy !== null || project.expenses.length === 0}><Download size={17} /> {outputBusy === "pdf" ? "PDF 생성 중" : "영수증철 PDF"}</button>
          </div>
        </header>

        {view === "overview" && (
          <Overview project={project} totals={totals} incomes={incomes} issues={issues} setView={setView} setEditingExpense={setEditingExpense} />
        )}
        {view === "accounting" && <AccountingView project={project} incomes={incomes} totals={totals} issues={issues} updateProject={updateProject} onAdd={() => setEditingExpense(newExpense(project))} onEdit={setEditingExpense} onDelete={(id) => updateProject((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== id) }))} />}
        {view === "receipts" && <ReceiptBookView project={project} updateProject={updateProject} onSavePdf={handleReceiptPdf} pdfBusy={outputBusy === "pdf"} />}
        {view === "settlements" && <SettlementView project={project} summaries={settlements} updateProject={updateProject} />}
        {view === "settings" && (
          <SettingsView project={project} projectFilePath={projectFilePath} updateProject={updateProject} />
        )}
      </main>

      {editingExpense && (
        <ExpenseEditor
          project={project}
          expense={editingExpense}
          updateProject={updateProject}
          onToast={setToast}
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
  const difference = reconciliationSummary(project).difference;
  const reviewIssues = useMemo(() => summarizeValidationIssues(project, issues), [project, issues]);
  const completion = Math.max(8, Math.min(100, 100 - issues.filter((issue) => issue.severity === "error").length * 14 - issues.filter((issue) => issue.severity === "warning").length * 5));
  const incomeReady = incomes.total > 0;
  const expensesReady = project.expenses.length > 0;
  const accountingReady = incomeReady && expensesReady && !issues.some((issue) => issue.scope === "project" || (issue.scope === "expense" && issue.severity === "error"));
  const receiptsReady = expensesReady
    && project.expenses.every((expense) => expense.receiptMode === "offline-original" ? expense.originalConfirmed : expense.attachments.length > 0)
    && (!project.expenses.some((expense) => expense.category === "transport" && expense.isFuel)
      || project.categoryEvidence.some((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation" && (evidence.attachments.length > 0 || (evidence.offlineHolders?.length ?? 0) > 0)));
  const settlementReady = receiptsReady && settlementSummaries(project).every((summary) => summary.outstandingAmount === 0);
  const workflowSteps: { number: number; title: string; description: string; done: boolean; current: boolean; view: ViewId }[] = [
    { number: 1, title: "회계 입력·검토", description: incomeReady && expensesReady ? `${project.expenses.length}건과 검산 결과를 함께 확인해요.` : "수입부터 입력하고 지출을 등록하세요.", done: accountingReady, current: !accountingReady, view: "accounting" },
    { number: 2, title: "영수증철 편집", description: receiptsReady ? "증빙 배치가 준비됐어요." : "이미지 크기와 잘림을 조정하세요.", done: receiptsReady, current: accountingReady && !receiptsReady, view: "receipts" },
    { number: 3, title: "정산 확인", description: settlementReady ? "개인 선결제 잔액을 확인했어요." : "돌려줄 금액을 확인하세요.", done: settlementReady, current: receiptsReady && !settlementReady, view: "settlements" },
  ];
  return (
    <section className="page page-overview">
      <div className="hero-row">
        <div><span className="eyebrow">ACCOUNTING WORKSPACE</span><h1>{project.meta.teamName || "회계 프로젝트"}, 오늘도 차근차근.</h1><p>입력한 내역은 항목별·날짜순으로 정리되고 영수증 번호가 자동으로 맞춰집니다.</p></div>
        <button className="button accent" onClick={() => setEditingExpense(newExpense(project))}><Plus size={18} /> 지출 등록</button>
      </div>
      <div className="workflow-strip">
        {workflowSteps.map((step) => <button key={step.number} className={`${step.done ? "done" : ""} ${step.current ? "current" : ""}`} onClick={() => setView(step.view)}>
          <span className="workflow-number">{step.done ? <Check size={16} /> : step.number}</span>
          <span className="workflow-copy"><strong>{step.title}</strong><small>{step.description}</small></span>
          <ArrowRight size={15} />
        </button>)}
      </div>
      <div className="metric-grid">
        <Metric icon={CircleDollarSign} tone="navy" label="총수입" value={money(incomes.total)} sub="회비·팀별사역비·플로잉" />
        <Metric icon={WalletCards} tone="orange" label="총지출" value={money(totals.total)} sub={`${project.expenses.length}건의 영수증`} />
        <Metric icon={Archive} tone="green" label="현재 차액" value={money(difference)} sub={difference === 0 ? "수입과 지출 일치" : "환입액 포함 검산 필요"} />
        <div className="metric-card progress-card"><div className="progress-ring" style={{ "--progress": `${completion * 3.6}deg` } as React.CSSProperties}><strong>{completion}%</strong></div><div><span>제출 준비도</span><h3>{reviewIssues.length ? `${reviewIssues.length}종 확인 필요` : "검산 완료"}</h3><button onClick={() => setView("accounting")}>검사 결과 보기 <ArrowRight size={14} /></button></div></div>
      </div>
      <div className="overview-grid">
        <div className="panel spending-panel">
          <div className="panel-heading"><div><span className="eyebrow">EXPENSES</span><h2>항목별 지출</h2></div><button className="text-button" onClick={() => setView("accounting")}>전체 내역 <ArrowRight size={15} /></button></div>
          <div className="category-bars">
            {CATEGORY_DEFINITIONS.map((category) => {
              const amount = totals.byCategory[category.id];
              const width = totals.total ? Math.max(2, amount / totals.total * 100) : 2;
              return <div className="category-row" key={category.id}><span className={`category-index c${category.number}`}>{category.number}</span><strong>{category.label}</strong><div className="bar-track"><i style={{ width: `${width}%` }} /></div><b>{money(amount)}</b></div>;
            })}
          </div>
        </div>
        <div className="panel checklist-panel">
          <div className="panel-heading"><div><span className="eyebrow">CHECKLIST</span><h2>지금 확인할 것</h2></div><span className="issue-count">{reviewIssues.length}</span></div>
          <div className="issue-list">
            {reviewIssues.slice(0, 5).map((issue) => <div className="issue-item" key={issue.id}><span className={issue.severity}><AlertCircle size={17} /></span><div><div className="issue-title-row"><strong>{issue.title}</strong>{issue.count > 1 && <em>{issue.count}건 요약</em>}</div><p>{issue.detail}</p>{issue.targetSummary && <p className="issue-target-summary">{issue.targetSummary}</p>}</div></div>)}
            {reviewIssues.length === 0 && <div className="empty-state compact"><BadgeCheck size={28} /><strong>모든 핵심 검사를 통과했습니다</strong><span>출력 전 원본 영수증 순서만 다시 확인하세요.</span></div>}
          </div>
          {reviewIssues.length > 5 && <button className="full-link" onClick={() => setView("accounting")}>나머지 {reviewIssues.length - 5}종도 확인하기</button>}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, tone, label, value, sub }: { icon: typeof CircleDollarSign; tone: string; label: string; value: string; sub: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={21} /></div><div><span>{label}</span><h3>{value}</h3><p>{sub}</p></div></div>;
}

function AccountingView({ project, incomes, totals, issues, updateProject, onAdd, onEdit, onDelete }: {
  project: ProjectData;
  incomes: ReturnType<typeof incomeTotals>;
  totals: ReturnType<typeof expenseTotals>;
  issues: ReturnType<typeof validateProject>;
  updateProject: (updater: (project: ProjectData) => ProjectData) => void;
  onAdd: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState<CategoryId | "all">("all");
  const reviewIssues = useMemo(() => summarizeValidationIssues(project, issues), [project, issues]);
  const errorIssueCount = issues.filter((item) => item.severity === "error").length;
  const warningIssueCount = issues.filter((item) => item.severity === "warning").length;
  const errorGroupCount = reviewIssues.filter((item) => item.severity === "error").length;
  const warningGroupCount = reviewIssues.filter((item) => item.severity === "warning").length;
  const expenses = project.expenses.filter((expense) => filter === "all" || expense.category === filter);
  const reconciliation = reconciliationSummary(project);
  const teamMinistryExcess = Math.max(
    reconciliation.teamMinistryAmount - reconciliation.income.teamSupport,
    0,
  );
  const setIncomeAmount = (type: Exclude<IncomeType, "dues">, amount: number) => updateProject((current) => {
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
  const otherIncomes = [
    { type: "teamSupport" as const, title: "팀별사역지원금", amount: incomes.teamSupport },
    { type: "flowing" as const, title: "재정플로잉", amount: incomes.flowing },
  ];
  return <section className="page accounting-page"><PageHeading eyebrow="ACCOUNTING & REVIEW" title="회계 입력·검토" description="수입, 지출, 검산과 누락 검토를 한 화면에서 확인합니다." />
    <div className="panel unified-income-panel"><div className="panel-heading"><div><span className="eyebrow">INCOME</span><h2>수입 관리</h2></div><strong className="income-total-inline">총 {money(incomes.total)}</strong></div>
      <div className="dues-equation"><label><span>1인당 회비</span><div><input type="number" min="0" value={project.duesPerPerson || ""} onChange={(event) => updateProject((current) => ({ ...current, duesPerPerson: Math.max(0, Number(event.target.value) || 0) }))} /><em>원</em></div></label><b>×</b><label><span>인원수</span><div><input type="number" min="0" value={project.meta.headcount || ""} onChange={(event) => updateProject((current) => ({ ...current, meta: { ...current.meta, headcount: Math.max(0, Number(event.target.value) || 0) } }))} /><em>명</em></div></label><b>=</b><div className="dues-result"><span>회비 합계</span><strong>{money(incomes.dues)}</strong></div></div>
      <div className="other-income-grid">{otherIncomes.map((source) => <label key={source.type}><span>{source.title}</span><div><input type="number" min="0" value={source.amount || ""} onChange={(event) => setIncomeAmount(source.type, Math.max(0, Number(event.target.value) || 0))} /><em>원</em></div></label>)}</div>
    </div>
    <div className={`support-return-card ${teamMinistryExcess > 0 ? "funded" : reconciliation.returnAmount > 0 ? "returning" : "used"}`}><div className="support-return-title"><span><CircleDollarSign size={18} /></span><div><strong>팀별사역지원금 사용 현황</strong><small>{teamMinistryExcess > 0 ? `지원금 초과 ${money(teamMinistryExcess)}은 팀회비로 자동 충당됩니다.` : "6. 팀별사역비 항목으로 등록한 지출을 지원금 사용액으로 계산합니다."}</small></div></div><div className="support-return-formula"><span><small>팀별사역지원금</small><strong>{money(reconciliation.income.teamSupport)}</strong></span><i>−</i><span><small>6. 팀별사역비</small><strong>{money(reconciliation.teamMinistryAmount)}</strong></span><i>=</i><span className="support-return-result"><small>환입액 (최소 0원)</small><strong>{money(reconciliation.returnAmount)}</strong></span>{teamMinistryExcess > 0 && <span className="support-dues-used"><small>팀회비 자동 충당</small><strong>{money(teamMinistryExcess)}</strong></span>}</div></div>
    <div className="reconcile-card live-reconcile"><div><span>총수입</span><strong>{money(reconciliation.income.total)}</strong></div><i>−</i><div><span>총지출</span><strong>{money(reconciliation.expense.total)}</strong></div><i>−</i><div><span>환입액</span><strong>{money(reconciliation.returnAmount)}</strong></div><i>=</i><div className={reconciliation.difference === 0 ? "balanced" : "unbalanced"}><span>실시간 검산 차액</span><strong>{money(reconciliation.difference)}</strong></div><div className={`balance-status ${reconciliation.difference === 0 ? "ok" : "warn"}`}>{reconciliation.difference === 0 ? <Check size={18} /> : <AlertCircle size={18} />}{reconciliation.difference === 0 ? "일치" : "확인 필요"}</div></div>
    <div className="panel inline-review-panel"><div className="panel-heading"><div><span className="eyebrow">AUTOMATIC REVIEW</span><h2>자동 검토</h2></div><div className="severity-summary"><span className="error">오류 {errorGroupCount}종{errorIssueCount > errorGroupCount ? ` · ${errorIssueCount}건` : ""}</span><span className="warning">주의 {warningGroupCount}종{warningIssueCount > warningGroupCount ? ` · ${warningIssueCount}건` : ""}</span></div></div><div className="issue-list review-grid">{reviewIssues.map((issue) => <div className="issue-item" key={issue.id}><span className={issue.severity}><AlertCircle size={17} /></span><div><div className="issue-title-row"><strong>{issue.title}</strong>{issue.count > 1 && <em>{issue.count}건 요약</em>}</div><p>{issue.detail}</p>{issue.targetSummary && <p className="issue-target-summary">{issue.targetSummary}</p>}</div></div>)}{reviewIssues.length === 0 && <div className="empty-state compact"><BadgeCheck size={30} /><strong>자동 검사를 모두 통과했습니다</strong><span>수입과 지출, 증빙 및 정산 검산이 일치합니다.</span></div>}</div></div>
    <div className="ledger-section-heading"><div><span className="eyebrow">EXPENSE LEDGER</span><h2>지출 내역</h2><p>같은 항목 안에서 날짜순으로 정렬되고 영수증 번호는 항목마다 다시 시작합니다.</p></div><div className="ledger-heading-actions"><strong>{project.expenses.length}건 · {money(totals.total)}</strong><button className="button accent" onClick={onAdd}><Plus size={17} /> 지출 등록</button></div></div>
    <div className="filter-strip no-print"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 <b>{project.expenses.length}</b></button>{CATEGORY_DEFINITIONS.map((category) => <button key={category.id} className={filter === category.id ? "active" : ""} onClick={() => setFilter(category.id)}>{category.label} <b>{project.expenses.filter((expense) => expense.category === category.id).length}</b></button>)}</div>
    <div className="panel table-panel"><table className="ledger-table"><thead><tr><th>항목</th><th>날짜</th><th>내용</th><th className="numeric">금액</th><th>번호</th><th>증빙</th><th>내부 정산</th><th className="actions"><button className="ledger-table-add no-print" aria-label="표에서 지출 등록" title="지출 등록" onClick={onAdd}><Plus size={16} /></button></th></tr></thead><tbody>
      {expenses.map((expense) => { const person = project.people.find((item) => item.id === expense.payerId); const details = `${expense.category === "meals" && expense.mealHeadcount ? `${expense.mealHeadcount}명 · ` : ""}${expense.itemDetails || expense.note}`; return <tr key={expense.id} className="editable-row" title="클릭하여 지출 수정" onClick={() => onEdit(expense)}><td><span className={`category-pill c${getCategory(expense.category).number}`}>{getCategory(expense.category).label}</span></td><td>{expense.date}</td><td><strong>{expense.content}</strong>{details && <span>{details}</span>}{expense.category === "teamMinistry" && <span className="team-support-badge"><CircleDollarSign size={11} /> 팀별사역지원금 사용액</span>}</td><td className="numeric"><strong>{money(expense.amount)}</strong></td><td><span className="receipt-number">{expense.receiptNumber}</span></td><td><span className={`evidence-badge ${expense.receiptMode === "offline-original" ? "offline" : "online"}`}>{expense.receiptMode === "offline-original" ? "실물 원본" : `온라인 ${expense.attachments.length}`}</span></td><td>{expense.paymentSource === "personal" ? <span className="internal-only">{person?.name || "미지정"} · {expense.settlementStatus === "settled" ? "완료" : "정산 전"}</span> : <span className="muted">팀비</span>}</td><td className="actions"><button aria-label="수정" onClick={(event) => { event.stopPropagation(); onEdit(expense); }}>수정</button><button aria-label="삭제" className="danger" onClick={(event) => { event.stopPropagation(); onDelete(expense.id); }}><Trash2 size={15} /></button></td></tr>; })}
      {expenses.length === 0 && <tr><td colSpan={8}><div className="empty-state ledger-empty"><ReceiptText size={34} /><strong>등록된 지출이 없습니다</strong><span>첫 영수증을 등록하면 자동으로 정렬해 드립니다.</span><button className="button secondary no-print" onClick={onAdd}><Plus size={16} /> 첫 지출 등록</button></div></td></tr>}
    </tbody></table></div>
    <div className="privacy-note"><BadgeCheck size={17} /><div><strong>결제자와 정산 상태는 앱 안에서만 사용됩니다.</strong><span>공식 금전출납부와 영수증철에는 출력하지 않습니다.</span></div></div>
  </section>;
}

function ReceiptBookView({ project, updateProject, onSavePdf, pdfBusy }: { project: ProjectData; updateProject: (updater: (project: ProjectData) => ProjectData) => void; onSavePdf: () => void; pdfBusy: boolean }) {
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  const [selectedOfflineHolderId, setSelectedOfflineHolderId] = useState<string | null>(null);
  const [croppingAttachmentId, setCroppingAttachmentId] = useState<string | null>(null);
  const dragRef = useRef<{ attachmentId: string; x: number; y: number } | null>(null);
  const resizeRef = useRef<{
    target: "attachment" | "offline-holder";
    attachmentId?: string;
    expenseId?: string;
    evidenceId?: string;
    holderId?: string;
    handle: string;
    startX: number;
    startY: number;
    widthMm: number;
    heightMm: number;
    pixelsPerMmX: number;
    pixelsPerMmY: number;
    cropMode: boolean;
    singleColumnPage: boolean;
    layout?: NonNullable<Attachment["layout"]>;
  } | null>(null);
  const transportFuelEvidence = project.categoryEvidence.find((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation");
  const receiptItems = buildReceiptBookItems(project);
  const receiptPages = layoutReceiptBookItems(receiptItems);
  const selectedItem = receiptItems.find((item) => item.attachment?.id === selectedAttachmentId || item.offlineHolder?.id === selectedOfflineHolderId);
  const selectedPlacement = receiptPages.flat().find((placement) => placement.item.attachment?.id === selectedAttachmentId || placement.item.offlineHolder?.id === selectedOfflineHolderId);
  const selectedOfflineHolders = selectedItem?.evidenceId
    ? project.categoryEvidence.find((evidence) => evidence.id === selectedItem.evidenceId)?.offlineHolders ?? []
    : selectedItem ? offlineHoldersForExpense(selectedItem.expense) : [];
  const updateAttachmentLayout = (attachmentId: string, updater: (layout: NonNullable<Attachment["layout"]>) => NonNullable<Attachment["layout"]>) => updateProject((current) => {
    const updateAttachment = (attachment: Attachment) => attachment.id === attachmentId ? { ...attachment, layout: updater({ ...DEFAULT_IMAGE_LAYOUT, ...attachment.layout }) } : attachment;
    return {
      ...current,
      expenses: current.expenses.map((expense) => ({ ...expense, attachments: expense.attachments.map(updateAttachment) })),
      categoryEvidence: current.categoryEvidence.map((evidence) => ({ ...evidence, attachments: evidence.attachments.map(updateAttachment) })),
    };
  });
  const updateOfflineHolder = ({ expenseId, evidenceId }: { expenseId?: string; evidenceId?: string }, holderId: string, updater: (holder: OfflineReceiptHolder) => OfflineReceiptHolder) => updateProject((current) => ({
    ...current,
    expenses: current.expenses.map((expense) => expense.id === expenseId
      ? { ...expense, offlineHolders: offlineHoldersForExpense(expense).map((holder) => holder.id === holderId ? updater(holder) : holder) }
      : expense),
    categoryEvidence: current.categoryEvidence.map((evidence) => evidence.id === evidenceId
      ? { ...evidence, offlineHolders: (evidence.offlineHolders ?? []).map((holder) => holder.id === holderId ? updater(holder) : holder) }
      : evidence),
  }));
  const startDrag = (event: React.PointerEvent<HTMLDivElement>, attachmentId: string) => {
    setSelectedAttachmentId(attachmentId);
    setSelectedOfflineHolderId(null);
    if (croppingAttachmentId !== attachmentId) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { attachmentId, x: event.clientX, y: event.clientY };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaX = (event.clientX - drag.x) / bounds.width * 100;
    const deltaY = (event.clientY - drag.y) / bounds.height * 100;
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    updateAttachmentLayout(drag.attachmentId, (layout) => ({ ...layout, offsetX: Math.max(-300, Math.min(300, layout.offsetX + deltaX)), offsetY: Math.max(-300, Math.min(300, layout.offsetY + deltaY)) }));
  };
  const startResize = (event: React.PointerEvent<HTMLButtonElement>, handle: string, placement: ReceiptFlowPlacement) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.closest(".receipt-flow-item")?.getBoundingClientRect();
    const { attachment, offlineHolder, expense, evidenceId } = placement.item;
    if (!bounds || (!attachment && !offlineHolder)) return;
    const singleColumnPage = placement.pageColumnCount === 1;
    resizeRef.current = {
      target: attachment ? "attachment" : "offline-holder",
      attachmentId: attachment?.id,
      expenseId: offlineHolder && !evidenceId ? expense.id : undefined,
      evidenceId: offlineHolder ? evidenceId : undefined,
      holderId: offlineHolder?.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      widthMm: placement.widthMm,
      heightMm: placement.heightMm,
      pixelsPerMmX: bounds.width / placement.widthMm,
      pixelsPerMmY: bounds.height / placement.heightMm,
      cropMode: offlineHolder ? true : croppingAttachmentId === attachment?.id,
      singleColumnPage,
      layout: attachment ? { ...DEFAULT_IMAGE_LAYOUT, ...attachment.layout } : undefined,
    };
  };
  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = (event.clientX - resize.startX) / resize.pixelsPerMmX;
    const deltaY = (event.clientY - resize.startY) / resize.pixelsPerMmY;
    const resizedFrame = resizePictureFrame({
      widthMm: resize.widthMm,
      heightMm: resize.heightMm,
      handle: resize.handle,
      deltaXmm: deltaX,
      deltaYmm: deltaY,
      cropMode: resize.cropMode,
    });
    if (resize.target === "offline-holder" && (resize.expenseId || resize.evidenceId) && resize.holderId) {
      updateOfflineHolder({ expenseId: resize.expenseId, evidenceId: resize.evidenceId }, resize.holderId, (holder) => ({ ...holder, ...resizedFrame }));
    } else if (resize.attachmentId && resize.layout) {
      const croppedFrame = resize.cropMode
        ? cropPictureFrame({
          widthMm: resize.widthMm,
          heightMm: resize.heightMm,
          handle: resize.handle,
          deltaXmm: deltaX,
          deltaYmm: deltaY,
          layout: resize.layout,
        })
        : undefined;
      if (croppedFrame && resize.singleColumnPage) {
        croppedFrame.frameOffsetXMm += centeredColumnResizeOffset(
          resize.widthMm,
          croppedFrame.widthMm,
        );
      }
      updateAttachmentLayout(resize.attachmentId, () => ({
        ...resize.layout!,
        ...(croppedFrame ?? resizedFrame),
        fit: resize.cropMode ? "cover" : resize.layout!.fit,
      }));
    }
  };
  const finishPointerEdit = () => {
    dragRef.current = null;
    resizeRef.current = null;
  };
  const finishCropping = (attachmentId: string) => {
    updateAttachmentLayout(attachmentId, (layout) => ({
      ...layout,
      frameOffsetXMm: 0,
      frameOffsetYMm: 0,
    }));
    setCroppingAttachmentId(null);
  };
  const selectAttachment = (attachmentId: string) => {
    setSelectedAttachmentId(attachmentId);
    setSelectedOfflineHolderId(null);
    if (croppingAttachmentId && croppingAttachmentId !== attachmentId) finishCropping(croppingAttachmentId);
  };
  const selectOfflineHolder = (holderId: string) => {
    if (croppingAttachmentId) finishCropping(croppingAttachmentId);
    setSelectedOfflineHolderId(holderId);
    setSelectedAttachmentId(null);
  };
  const toggleCropMode = () => {
    if (!selectedAttachmentId) return;
    if (croppingAttachmentId === selectedAttachmentId) {
      finishCropping(selectedAttachmentId);
      return;
    }
    if (selectedPlacement) {
      updateAttachmentLayout(selectedAttachmentId, (layout) => ({
        ...layout,
        widthMm: selectedPlacement.widthMm,
        heightMm: selectedPlacement.heightMm,
        fit: "cover",
      }));
    }
    setCroppingAttachmentId(selectedAttachmentId);
  };
  const registerAspectRatio = (attachmentId: string, aspectRatio: number) => {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
    updateAttachmentLayout(attachmentId, (layout) => Math.abs((layout.aspectRatio ?? DEFAULT_IMAGE_LAYOUT.aspectRatio) - aspectRatio) < 0.002
      ? layout
      : { ...layout, aspectRatio });
  };
  const addOfflineHolder = () => {
    if (!selectedItem?.offlineHolder) return;
    const holder: OfflineReceiptHolder = {
      id: crypto.randomUUID(),
      widthMm: selectedItem.offlineHolder.widthMm,
      heightMm: selectedItem.offlineHolder.heightMm,
    };
    updateProject((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => expense.id === selectedItem.expense.id
        ? { ...expense, offlineHolders: [...offlineHoldersForExpense(expense), holder] }
        : expense),
      categoryEvidence: current.categoryEvidence.map((evidence) => evidence.id === selectedItem.evidenceId
        ? { ...evidence, offlineHolders: [...(evidence.offlineHolders ?? []), holder] }
        : evidence),
    }));
    setSelectedOfflineHolderId(holder.id);
  };
  const removeOfflineHolder = () => {
    if (!selectedItem?.offlineHolder) return;
    const holders = selectedOfflineHolders;
    if (!selectedItem.evidenceId && holders.length <= 1) return;
    const remaining = holders.filter((holder) => holder.id !== selectedItem.offlineHolder?.id);
    updateProject((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => !selectedItem.evidenceId && expense.id === selectedItem.expense.id ? { ...expense, offlineHolders: remaining } : expense),
      categoryEvidence: current.categoryEvidence.map((evidence) => evidence.id === selectedItem.evidenceId ? { ...evidence, offlineHolders: remaining } : evidence),
    }));
    setSelectedOfflineHolderId(remaining[0]?.id ?? null);
  };
  const addFuelEvidence = async () => {
    if (!project.projectDirectory) return;
    const imported = await importAttachments(project.projectDirectory);
    if (imported.length === 0) return;
    const attachments = (await Promise.all(imported.map((attachment) => normalizeAttachmentToImages(project.projectDirectory!, attachment)))).flat();
    updateProject((current) => {
      const existing = current.categoryEvidence.find((item) => item.category === "transport" && item.kind === "fuel-calculation");
      const evidenceAttachments = attachments.map((item) => ({ ...item, kind: "other" as const }));
      return { ...current, categoryEvidence: existing ? current.categoryEvidence.map((item) => item.id === existing.id ? { ...item, attachments: [...item.attachments, ...evidenceAttachments] } : item) : [...current.categoryEvidence, { id: crypto.randomUUID(), category: "transport", kind: "fuel-calculation", title: "교통비 공통 주유비 산정 증빙", attachments: evidenceAttachments, offlineHolders: [] }] };
    });
  };
  const addFuelOfflineHolder = () => {
    const holder: OfflineReceiptHolder = { id: crypto.randomUUID(), widthMm: 82, heightMm: 62 };
    updateProject((current) => {
      const existing = current.categoryEvidence.find((item) => item.category === "transport" && item.kind === "fuel-calculation");
      return { ...current, categoryEvidence: existing
        ? current.categoryEvidence.map((item) => item.id === existing.id ? { ...item, offlineHolders: [...(item.offlineHolders ?? []), holder] } : item)
        : [...current.categoryEvidence, { id: crypto.randomUUID(), category: "transport", kind: "fuel-calculation", title: "교통비 공통 주유비 산정 증빙", attachments: [], offlineHolders: [holder] }] };
    });
    setSelectedOfflineHolderId(holder.id);
  };
  return <section className="page receipt-page-wrap"><PageHeading eyebrow="RECEIPT BOOK EDITOR" title="영수증철 편집" description="그림을 선택한 뒤 테두리 핸들로 크기를 바꾸거나 자르기 모드에서 보이는 영역을 직접 조정합니다." action={<button className="button accent no-print" onClick={onSavePdf} disabled={pdfBusy || project.expenses.length === 0}><Download size={18} /> {pdfBusy ? "PDF 생성 중" : "PDF 저장"}</button>} />
    <div className="receipt-toolbar no-print"><div><span className="legend online" /><strong>선택</strong><span>흰색 핸들로 그림·홀더 크기 조절</span></div><div><Crop size={14} /><strong>자르기</strong><span>검은 핸들로 영역 조절 · 그림 드래그로 위치 이동</span></div><div><strong>세로 우선 자동 배치</strong><span>위→아래로 채운 뒤 다음 열로 이동 · 크기 변경 즉시 재배치</span></div><div className="manual-reminder"><AlertCircle size={16} /> 지출 정보와 번호는 PDF에 넣지 않고 인쇄 후 직접 기입</div></div>
    {selectedItem && <div className="receipt-floating-toolbar-anchor no-print"><div className={`panel receipt-editor-controls active ${selectedItem.offlineHolder ? "holder-controls" : ""}`}>
      <div className="editor-selection">{selectedItem.offlineHolder ? <ReceiptText size={22} /> : <FileImage size={22} />}<div><strong>{selectedItem.attachment?.originalName ?? "오프라인 실물 부착 공간"}</strong><span>{getCategory(selectedItem.expense.category).label} · {selectedItem.expense.content}</span></div></div>
      {selectedItem.offlineHolder ? <>
        <button className="button secondary" onClick={addOfflineHolder}><Plus size={16} /> {selectedItem.evidenceId ? "같은 증빙 부착칸 추가" : "같은 영수증 조각 추가"}</button>
        <button className="button ghost" disabled={!selectedItem.evidenceId && selectedOfflineHolders.length <= 1} onClick={removeOfflineHolder}><Trash2 size={16} /> 홀더 삭제</button>
      </> : <>
        <button className={`button crop-button ${croppingAttachmentId === selectedAttachmentId ? "active" : "secondary"}`} onClick={toggleCropMode}><Crop size={16} /> {croppingAttachmentId === selectedAttachmentId ? "자르기 완료" : "자르기"}</button>
        <button className="button secondary" onClick={() => selectedAttachmentId && updateAttachmentLayout(selectedAttachmentId, (layout) => ({ ...layout, widthMm: layout.heightMm ?? layout.widthMm, heightMm: layout.heightMm ? layout.widthMm : undefined, rotation: (layout.rotation + 90) % 360 }))}><RotateCw size={16} /> 90°</button>
        <button className="button ghost" onClick={() => { setCroppingAttachmentId(null); if (selectedAttachmentId) updateAttachmentLayout(selectedAttachmentId, (layout) => ({ ...DEFAULT_IMAGE_LAYOUT, aspectRatio: layout.aspectRatio ?? DEFAULT_IMAGE_LAYOUT.aspectRatio })); }}><RotateCcw size={16} /> 원본 비율 복원</button>
      </>}
    </div></div>}
    {receiptPages.map((placements, pageIndex) => <article className="receipt-sheet receipt-flow-sheet" key={`receipt-page-${pageIndex}`}>
      <ReceiptHeader project={project} />
      <div className="receipt-flow-canvas">{placements.map((placement) => <ReceiptTile key={placement.item.id} project={project} placement={placement} selected={placement.item.attachment?.id === selectedAttachmentId || placement.item.offlineHolder?.id === selectedOfflineHolderId} cropMode={placement.item.attachment?.id === croppingAttachmentId} onSelectAttachment={selectAttachment} onSelectOfflineHolder={selectOfflineHolder} onAspectRatio={registerAspectRatio} onPointerDown={startDrag} onPointerMove={moveDrag} onResizeStart={startResize} onResizeMove={moveResize} onPointerUp={finishPointerEdit} />)}</div>
      <div className="receipt-page-count no-print">{pageIndex + 1} / {receiptPages.length}</div>
    </article>)}
    {project.expenses.some((expense) => expense.category === "transport" && expense.isFuel) && !((transportFuelEvidence?.attachments.length ?? 0) > 0 || (transportFuelEvidence?.offlineHolders?.length ?? 0) > 0)
      && <div className="receipt-sheet shared-evidence"><ReceiptHeader project={project} /><div className="attachment-placeholder no-print"><Fuel size={35} /><strong>주유비 산정 증빙을 추가하세요</strong><span>주유 영수증과 1:1로 대응하지 않는 공통 자료입니다. 온라인 파일이나 인쇄 후 붙일 오프라인 칸을 여러 개 추가할 수 있습니다.</span><div className="attachment-placeholder-actions"><button className="button secondary" onClick={addFuelEvidence} disabled={!project.projectDirectory}><FileImage size={17} /> 온라인 파일 선택</button><button className="button secondary" onClick={addFuelOfflineHolder}><ReceiptText size={17} /> 오프라인 부착칸</button></div>{!project.projectDirectory && <small>온라인 파일은 프로젝트를 먼저 저장해야 첨부할 수 있습니다.</small>}</div></div>}
    {project.expenses.length === 0 && <div className="panel empty-state"><ReceiptText size={40} /><strong>영수증철에 배치할 내역이 없습니다</strong><span>지출을 등록하면 순서대로 출력 페이지가 만들어집니다.</span></div>}
  </section>;
}

function ReceiptHeader({ project }: { project: ProjectData }) {
  return <div className="official-receipt-header"><h2>{project.meta.community || "○○○"} 공동체 - 국내 {project.meta.teamName || "○○○팀"} - 영수증철</h2></div>;
}

function ReceiptTile({ project, placement, selected, cropMode, onSelectAttachment, onSelectOfflineHolder, onAspectRatio, onPointerDown, onPointerMove, onResizeStart, onResizeMove, onPointerUp }: { project: ProjectData; placement: ReceiptFlowPlacement; selected: boolean; cropMode: boolean; onSelectAttachment: (id: string) => void; onSelectOfflineHolder: (id: string) => void; onAspectRatio: (id: string, aspectRatio: number) => void; onPointerDown: (event: React.PointerEvent<HTMLDivElement>, id: string) => void; onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void; onResizeStart: (event: React.PointerEvent<HTMLButtonElement>, handle: string, placement: ReceiptFlowPlacement) => void; onResizeMove: (event: React.PointerEvent<HTMLButtonElement>) => void; onPointerUp: () => void }) {
  const { item } = placement;
  const { expense, attachment, offlineHolder, evidenceId, supporting } = item;
  const category = getCategory(expense.category);
  const receiptNumber = expense.receiptNumber ?? "?";
  const offlineHolders = evidenceId
    ? project.categoryEvidence.find((evidence) => evidence.id === evidenceId)?.offlineHolders ?? []
    : offlineHoldersForExpense(expense);
  const holderIndex = offlineHolder ? offlineHolders.findIndex((holder) => holder.id === offlineHolder.id) : -1;
  const watermarkLabel = receiptWatermarkLabel(item);
  const watermarkLabelSize = watermarkFontSizePx(watermarkLabel, placement.widthMm, placement.heightMm);
  const watermarkStyle = {
    "--watermark-label-size": `${watermarkLabelSize}px`,
    "--watermark-note-size": `${Math.max(4.5, Math.min(8, watermarkLabelSize * 0.52))}px`,
    "--watermark-pad-x": `${Math.max(1, Math.min(4, placement.widthMm / 22))}mm`,
    "--watermark-pad-y": `${Math.max(0.6, Math.min(2.2, placement.heightMm / 28))}mm`,
  } as React.CSSProperties;
  const receiptCode = evidenceId
    ? `주유비 산정 증빙${offlineHolder ? ` · 오프라인 ${holderIndex + 1}/${offlineHolders.length}` : " · 온라인"}`
    : `${category.number}-${receiptNumber}${offlineHolder && offlineHolders.length > 1 ? ` · 실물 ${holderIndex + 1}/${offlineHolders.length}` : supporting ? " · 추가" : ""}`;
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  return <section className={`receipt-tile receipt-flow-item ${selected ? "selected" : ""} ${cropMode ? "crop-mode" : ""} ${offlineHolder ? "offline" : "online"}`} style={{ left: `${placement.xMm}mm`, top: `${placement.yMm}mm`, width: `${placement.widthMm}mm`, height: `${placement.heightMm}mm` }}>
    {cropMode && attachment && <PrintableAttachment project={project} attachment={attachment} alt="자르기 중인 원본 그림" frameWidthMm={placement.widthMm} frameHeightMm={placement.heightMm} ghost />}
    <div className="receipt-tile-body" onPointerDown={(event) => attachment && onPointerDown(event, attachment.id)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={() => attachment ? onSelectAttachment(attachment.id) : offlineHolder && onSelectOfflineHolder(offlineHolder.id)}>
      {(attachment || offlineHolder) && <div className="receipt-screen-tag no-print" style={watermarkStyle}><strong>{watermarkLabel}</strong><small>PDF 파일로 내보낼 때 포함되지 않습니다</small></div>}
      {offlineHolder
        ? <div className="physical-placeholder"><strong>{offlinePlaceholderLabel(item)}</strong><small>{evidenceId ? "산정 증빙을 중앙에 붙이세요" : "실물 영수증을 중앙에 붙이세요"}</small></div>
        : attachment
          ? <PrintableAttachment project={project} attachment={attachment} alt={`${receiptCode} ${expense.content}${supporting ? " 추가 증빙" : " 영수증"}`} frameWidthMm={placement.widthMm} frameHeightMm={placement.heightMm} editable onAspectRatio={(aspectRatio) => onAspectRatio(attachment.id, aspectRatio)} />
          : <div className="missing-receipt-placeholder"><FileImage size={25} /><strong>온라인 영수증 없음</strong><span>PDF 저장 전에 첨부해 주세요.</span></div>}
    </div>
    {selected && (attachment || offlineHolder) && <div className={`picture-selection no-print ${cropMode ? "cropping" : "resizing"}`}>
      {handles.map((handle) => <button key={handle} type="button" className={`picture-handle handle-${handle}`} aria-label={`${cropMode ? "자르기" : offlineHolder ? "홀더 크기 조절" : "그림 크기 조절"} ${handle}`} onPointerDown={(event) => onResizeStart(event, handle, placement)} onPointerMove={onResizeMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />)}
      {cropMode && <span className="crop-mode-label"><Crop size={12} /> 그림을 드래그해 위치 조정</span>}
    </div>}
  </section>;
}

function PrintableAttachment({ project, attachment, alt, frameWidthMm, frameHeightMm, editable = false, ghost = false, onAspectRatio }: { project: ProjectData; attachment: Attachment; alt: string; frameWidthMm: number; frameHeightMm: number; editable?: boolean; ghost?: boolean; onAspectRatio?: (aspectRatio: number) => void }) {
  const { source, failed } = useAttachmentPreviewSource(project, attachment);
  if (!source) return <div className="missing-receipt-placeholder"><FileImage size={25} /><strong>{failed ? "첨부파일을 불러올 수 없습니다" : "첨부파일 불러오는 중"}</strong></div>;
  if (attachment.mimeType === "application/pdf" || attachment.originalName.toLowerCase().endsWith(".pdf")) return <div className="missing-receipt-placeholder pdf-conversion-needed"><FileImage size={25} /><strong>PDF 이미지 변환 필요</strong><span>프로젝트를 다시 열면 자동으로 변환합니다.</span></div>;
  const layout = { ...DEFAULT_IMAGE_LAYOUT, ...attachment.layout };
  const geometry = pictureLayoutGeometry(frameWidthMm, frameHeightMm, layout);
  const contentStyle: React.CSSProperties = {
    position: "absolute",
    left: `${50 + layout.offsetX}%`,
    top: `${50 + layout.offsetY}%`,
    width: `${geometry.contentWidthMm / frameWidthMm * 100}%`,
    height: `${geometry.contentHeightMm / frameHeightMm * 100}%`,
    maxWidth: "none",
    maxHeight: "none",
    objectFit: "fill",
    transform: `translate(-50%, -50%) rotate(${layout.rotation}deg)`,
    transformOrigin: "center",
  };
  return <div className={`online-receipt ${editable ? "editable" : ""} ${ghost ? "crop-original-ghost" : ""}`}><img src={source} alt={alt} draggable={false} style={contentStyle} onLoad={(event) => onAspectRatio?.(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} /></div>;
}

function useAttachmentPreviewSource(project: ProjectData, attachment: Attachment) {
  const [preview, setPreview] = useState({ source: "", failed: false });
  useEffect(() => {
    if (!project.projectDirectory) {
      setPreview({ source: "", failed: true });
      return;
    }
    let active = true;
    let objectUrl = "";
    setPreview({ source: "", failed: false });
    void readAttachmentBytes(attachmentAbsolutePath(project.projectDirectory, attachment.relativePath))
      .then((bytes) => {
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: attachment.mimeType || "image/png" }));
        if (active) setPreview({ source: objectUrl, failed: false });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => active && setPreview({ source: "", failed: true }));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.mimeType, attachment.relativePath, project.projectDirectory]);
  return preview;
}

function SettlementView({ project, summaries, updateProject }: { project: ProjectData; summaries: ReturnType<typeof settlementSummaries>; updateProject: (updater: (project: ProjectData) => ProjectData) => void }) {
  const outstanding = summaries.reduce((sum, item) => sum + item.outstandingAmount, 0);
  const settled = summaries.reduce((sum, item) => sum + item.settledAmount, 0);
  return <section className="page"><PageHeading eyebrow="INTERNAL SETTLEMENT" title="개인 정산" description="누가 먼저 결제했는지 앱 내부에서만 관리하고, 공식 제출 서류에는 드러내지 않습니다." />
    <div className="metric-grid settlement-metrics"><Metric icon={Users} tone="navy" label="정산 대상자" value={`${summaries.length}명`} sub="개인 선결제자" /><Metric icon={CircleDollarSign} tone="orange" label="정산할 금액" value={money(outstanding)} sub="아직 지급하지 않은 금액" /><Metric icon={BadgeCheck} tone="green" label="정산 완료" value={money(settled)} sub="검산에 반영된 완료액" /></div>
    <div className="panel settlement-list"><div className="panel-heading"><div><span className="eyebrow">PEOPLE</span><h2>사람별 정산 현황</h2></div></div>{summaries.map((summary) => <div className="settlement-person" key={summary.personId}><div className="person-avatar">{summary.personName.slice(0, 1)}</div><div className="person-main"><strong>{summary.personName}</strong><span>{summary.expenseCount}건 · 선결제 {money(summary.paidPersonally)}</span></div><div className="settlement-progress"><div><i style={{ width: `${summary.targetAmount ? Math.min(100, summary.settledAmount / summary.targetAmount * 100) : 0}%` }} /></div><span>{money(summary.settledAmount)} / {money(summary.targetAmount)}</span></div><strong className="outstanding">남음 {money(summary.outstandingAmount)}</strong><button className="button secondary" onClick={() => updateProject((current) => ({ ...current, expenses: current.expenses.map((expense) => expense.payerId === summary.personId && expense.paymentSource === "personal" ? { ...expense, settledAmount: expense.settlementTargetAmount || expense.amount, settledAt: new Date().toISOString().slice(0, 10) } : expense) }))}>전액 정산</button></div>)}{summaries.length === 0 && <div className="empty-state"><Users size={34} /><strong>개인 선결제 내역이 없습니다</strong><span>지출 등록 시 결제자를 지정하면 사람별로 합산됩니다.</span></div>}</div>
    <div className="privacy-note"><BadgeCheck size={17} /><div><strong>개인 정산 합계와 선결제 지출 합계를 자동으로 대조합니다.</strong><span>결제자 이름, 은행 메모, 정산 상태는 .barun 프로젝트 내부에만 저장됩니다.</span></div></div>
  </section>;
}

function SettingsView({ project, projectFilePath, updateProject }: { project: ProjectData; projectFilePath?: string; updateProject: (updater: (project: ProjectData) => ProjectData) => void }) {
  const meta = project.meta;
  const setMeta = (key: keyof ProjectData["meta"], value: string | number) => updateProject((current) => ({ ...current, meta: { ...current.meta, [key]: value } }));
  return <section className="page"><PageHeading eyebrow="PROJECT SETTINGS" title="프로젝트 설정" description="팀 기본정보, .barun 프로젝트 파일과 내부 정산 이름을 관리합니다. 수입은 회계 입력·검토 화면에서 관리합니다." />
    <div className="settings-grid"><div className="panel form-panel"><div className="panel-heading"><div><span className="eyebrow">BASIC INFO</span><h2>팀 기본 정보</h2></div></div><div className="field-grid"><Field label="공동체" value={meta.community} onChange={(value) => setMeta("community", value)} /><Field label="그룹" value={meta.groupName} onChange={(value) => setMeta("groupName", value)} /><Field label="팀 이름" value={meta.teamName} onChange={(value) => setMeta("teamName", value)} /><Field label="사역지" value={meta.destination} onChange={(value) => setMeta("destination", value)} /><Field label="출발일" type="date" value={meta.startDate} onChange={(value) => setMeta("startDate", value)} /><Field label="귀국일" type="date" value={meta.endDate} onChange={(value) => setMeta("endDate", value)} /><Field label="인원" type="number" value={String(meta.headcount)} onChange={(value) => setMeta("headcount", Number(value))} /><Field label="제출일" type="date" value={meta.submissionDate} onChange={(value) => setMeta("submissionDate", value)} /><Field label="담당 교역자" value={meta.pastorName} onChange={(value) => setMeta("pastorName", value)} /><Field label="팀장" value={meta.leaderName} onChange={(value) => setMeta("leaderName", value)} /><Field label="팀장 연락처" value={meta.leaderPhone} onChange={(value) => setMeta("leaderPhone", value)} /><Field label="회계" value={meta.accountantName} onChange={(value) => setMeta("accountantName", value)} /><Field label="회계 연락처" value={meta.accountantPhone} onChange={(value) => setMeta("accountantPhone", value)} /></div></div>
      <div className="settings-side"><div className="panel folder-panel"><FileArchive size={25} /><div><span>바른장부 프로젝트 파일</span><strong>{projectFilePath || "아직 저장하지 않음"}</strong></div></div></div>
    </div>
    <div className="settings-bottom-grid settings-bottom-single">
      <div className="panel people-panel"><div className="panel-heading"><div><span className="eyebrow">OPTIONAL · INTERNAL ONLY</span><h2>정산 이름 관리</h2></div><span className="optional-badge">필요할 때만</span></div><p>지출에서 ‘개인이 먼저 결제’를 선택하고 이름을 입력하면 여기에 자동으로 추가됩니다. 이 화면에서는 이름과 계좌 메모를 고칠 수 있습니다.</p><div className="people-rows">{project.people.map((person) => <div className="person-edit-row" key={person.id}><div className="person-avatar">{person.name.slice(0, 1) || "?"}</div><input value={person.name} onChange={(event) => updateProject((current) => ({ ...current, people: current.people.map((item) => item.id === person.id ? { ...item, name: event.target.value } : item) }))} placeholder="이름" /><input value={person.bankMemo} onChange={(event) => updateProject((current) => ({ ...current, people: current.people.map((item) => item.id === person.id ? { ...item, bankMemo: event.target.value } : item) }))} placeholder="은행·계좌 메모 (선택)" /><button className="icon-button" aria-label="정산 대상자 삭제" onClick={() => updateProject((current) => ({ ...current, people: current.people.filter((item) => item.id !== person.id), expenses: current.expenses.map((expense) => expense.payerId === person.id ? { ...expense, payerId: undefined } : expense) }))}><Trash2 size={15} /></button></div>)}{project.people.length === 0 && <div className="empty-state small"><Users size={28} /><strong>아직 개인 선결제자가 없습니다</strong><span>미리 등록하지 않아도 됩니다. 지출 입력 중 이름을 바로 적어 주세요.</span></div>}</div></div>
    </div>
  </section>;
}

function ExpenseEditor({ project, expense, updateProject, onToast, onClose, onSave }: { project: ProjectData; expense: Expense; updateProject: (updater: (project: ProjectData) => ProjectData) => void; onToast: (message: string) => void; onClose: () => void; onSave: (expense: Expense, payerName?: string) => void }) {
  const [draft, setDraft] = useState(expense);
  const [payerName, setPayerName] = useState(project.people.find((person) => person.id === expense.payerId)?.name ?? "");
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const update = <K extends keyof Expense>(key: K, value: Expense[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const addAttachments = (attachments: Attachment[]) => setDraft((current) => ({
    ...current,
    attachments: [...current.attachments, ...attachments.map((attachment) => ({ ...attachment, kind: current.receiptMode === "online-printable" ? "online-receipt" as const : "offline-preview" as const }))],
  }));
  const attach = async () => {
    if (!project.projectDirectory) { onToast("먼저 .barun 프로젝트를 저장해 주세요."); return; }
    try {
      const imported = await importAttachments(project.projectDirectory);
      if (imported.length === 0) return;
      const attachments = (await Promise.all(imported.map((attachment) => normalizeAttachmentToImages(project.projectDirectory!, attachment)))).flat();
      addAttachments(attachments);
      const pdfCount = imported.filter((attachment) => attachment.mimeType === "application/pdf").length;
      onToast(pdfCount > 0
        ? `${imported.length}개 파일을 가져오고 PDF를 포함한 ${attachments.length}개 이미지를 만들었습니다.`
        : `${attachments.length}개 이미지를 첨부했습니다.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "첨부파일을 가져오지 못했습니다.");
    }
  };
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!file) return;
      event.preventDefault();
      if (!project.projectDirectory) { onToast("클립보드 이미지를 넣으려면 먼저 .barun 프로젝트를 저장해 주세요."); return; }
      try {
        addAttachments([await importClipboardAttachment(project.projectDirectory, file)]);
        onToast("클립보드 이미지를 영수증에 첨부했습니다.");
      } catch (error) {
        onToast(error instanceof Error ? error.message : "클립보드 이미지를 첨부하지 못했습니다.");
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [project.projectDirectory, onToast]);
  const projectedExpenses = project.expenses.some((item) => item.id === draft.id)
    ? project.expenses.map((item) => item.id === draft.id ? draft : item)
    : [...project.expenses, draft];
  const liveReconciliation = reconciliationSummary({ ...project, expenses: projectedExpenses });
  const firstTeamMinistryId = sortAndNumberExpenses(projectedExpenses).find((item) => item.category === "teamMinistry")?.id;
  const automaticTeamMinistryNote = teamMinistryAutoNote({ ...project, expenses: projectedExpenses });
  useEffect(() => {
    const isAutomaticTarget = draft.category === "teamMinistry" && draft.id === firstTeamMinistryId;
    if (!isAutomaticTarget && draft.noteMode === "auto" && isAutoTeamMinistryNote(draft.note)) {
      setDraft((current) => ({ ...current, note: "", noteMode: undefined }));
      return;
    }
    const shouldWrite = isAutomaticTarget
      && draft.noteMode !== "manual"
      && (draft.noteMode === "auto" || !draft.note.trim() || isAutoTeamMinistryNote(draft.note));
    if (!shouldWrite || draft.note === automaticTeamMinistryNote) return;
    setDraft((current) => ({ ...current, note: automaticTeamMinistryNote, noteMode: "auto" }));
  }, [automaticTeamMinistryNote, draft.category, draft.id, draft.note, draft.noteMode, firstTeamMinistryId]);
  const offlineHolders = offlineHoldersForExpense(draft);
  const addDraftOfflineHolder = () => {
    const previous = offlineHolders.at(-1);
    update("offlineHolders", [...offlineHolders, {
      id: crypto.randomUUID(),
      widthMm: previous?.widthMm ?? 82,
      heightMm: previous?.heightMm ?? 62,
    }]);
  };
  const updateDraftOfflineHolder = (holderId: string, values: Partial<OfflineReceiptHolder>) => update(
    "offlineHolders",
    offlineHolders.map((holder) => holder.id === holderId ? { ...holder, ...values } : holder),
  );
  const removeDraftOfflineHolder = (holderId: string) => {
    if (offlineHolders.length <= 1) return;
    update("offlineHolders", offlineHolders.filter((holder) => holder.id !== holderId));
  };
  const fuelEvidence = project.categoryEvidence.find((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation");
  const addFuelEvidence = async () => {
    if (!project.projectDirectory) { onToast("먼저 .barun 프로젝트를 저장해 주세요."); return; }
    try {
      const imported = await importAttachments(project.projectDirectory);
      if (imported.length === 0) return;
      const attachments = (await Promise.all(imported.map((attachment) => normalizeAttachmentToImages(project.projectDirectory!, attachment))))
        .flat()
        .map((attachment) => ({ ...attachment, kind: "other" as const }));
      updateProject((current) => {
        const existing = current.categoryEvidence.find((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation");
        const categoryEvidence = existing
          ? current.categoryEvidence.map((evidence) => evidence.id === existing.id ? { ...evidence, attachments: [...evidence.attachments, ...attachments] } : evidence)
          : [...current.categoryEvidence, { id: crypto.randomUUID(), category: "transport" as const, kind: "fuel-calculation" as const, title: "교통비 공통 주유비 산정 증빙", attachments, offlineHolders: [] }];
        return { ...current, categoryEvidence };
      });
      onToast(`공통 주유비 산정 증빙 ${attachments.length}개를 추가했습니다.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "주유비 산정 증빙을 가져오지 못했습니다.");
    }
  };
  const removeFuelEvidence = (attachmentId: string) => updateProject((current) => ({
    ...current,
    categoryEvidence: current.categoryEvidence.map((evidence) => evidence.id === fuelEvidence?.id
      ? { ...evidence, attachments: evidence.attachments.filter((attachment) => attachment.id !== attachmentId) }
      : evidence),
  }));
  const addFuelOfflineHolder = () => {
    const holder: OfflineReceiptHolder = { id: crypto.randomUUID(), widthMm: 82, heightMm: 62 };
    updateProject((current) => {
      const existing = current.categoryEvidence.find((evidence) => evidence.category === "transport" && evidence.kind === "fuel-calculation");
      const categoryEvidence = existing
        ? current.categoryEvidence.map((evidence) => evidence.id === existing.id ? { ...evidence, offlineHolders: [...(evidence.offlineHolders ?? []), holder] } : evidence)
        : [...current.categoryEvidence, { id: crypto.randomUUID(), category: "transport" as const, kind: "fuel-calculation" as const, title: "교통비 공통 주유비 산정 증빙", attachments: [], offlineHolders: [holder] }];
      return { ...current, categoryEvidence };
    });
    onToast("인쇄 후 산정 자료를 붙일 오프라인 부착칸을 추가했습니다.");
  };
  const updateFuelOfflineHolder = (holderId: string, values: Partial<OfflineReceiptHolder>) => updateProject((current) => ({
    ...current,
    categoryEvidence: current.categoryEvidence.map((evidence) => evidence.id === fuelEvidence?.id
      ? { ...evidence, offlineHolders: (evidence.offlineHolders ?? []).map((holder) => holder.id === holderId ? { ...holder, ...values } : holder) }
      : evidence),
  }));
  const removeFuelOfflineHolder = (holderId: string) => updateProject((current) => ({
    ...current,
    categoryEvidence: current.categoryEvidence.map((evidence) => evidence.id === fuelEvidence?.id
      ? { ...evidence, offlineHolders: (evidence.offlineHolders ?? []).filter((holder) => holder.id !== holderId) }
      : evidence),
  }));
  return <><div className="modal-backdrop no-print" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="expense-drawer"><div className="drawer-header"><div><span className="eyebrow">EXPENSE</span><h2>{project.expenses.some((item) => item.id === expense.id) ? "지출 수정" : "새 지출 등록"}</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><div className="drawer-body">
    <div className={`editor-live-reconcile ${liveReconciliation.difference === 0 ? "balanced" : "unbalanced"}`}><div><span>수입</span><strong>{money(liveReconciliation.income.total)}</strong></div><i>−</i><div><span>이 지출 포함 총지출</span><strong>{money(liveReconciliation.expense.total)}</strong></div><i>−</i><div><span>환입액</span><strong>{money(liveReconciliation.returnAmount)}</strong></div><i>=</i><div><span>실시간 차액</span><strong>{money(liveReconciliation.difference)}</strong></div></div>
    <div className="field-grid editor-grid"><label className="field"><span>항목</span><select value={draft.category} onChange={(event) => update("category", event.target.value as CategoryId)}>{CATEGORY_DEFINITIONS.map((category) => <option key={category.id} value={category.id}>{category.number}. {category.label}</option>)}</select></label><Field label="날짜" type="date" value={draft.date} onChange={(value) => update("date", value)} /><label className="field full"><span>내용 (지출 목적)</span><input value={draft.content} onChange={(event) => update("content", event.target.value)} placeholder="예: 첫날 저녁 식사" /><small>어디에 왜 썼는지 적습니다. 금전출납부의 주된 내용으로 들어갑니다.</small></label><Field label="금액" type="number" value={String(draft.amount || "")} onChange={(value) => update("amount", Number(value))} /><Field label="세부 품목 (영수증 내역)" value={draft.itemDetails} placeholder="예: 돈까스 12개, 김밥 24개" helper="금전출납부의 ‘내용’ 칸에서 지출 목적 뒤에 _로 이어 붙습니다." onChange={(value) => update("itemDetails", value)} />{draft.category === "meals" && <Field label="식사 인원" type="number" value={String(draft.mealHeadcount || "")} onChange={(value) => update("mealHeadcount", Number(value))} />}{draft.category === "transport" && <label className="check-field"><input type="checkbox" checked={draft.isFuel} onChange={(event) => update("isFuel", event.target.checked)} /><Fuel size={17} /><span><strong>주유비 지출</strong><small>아래 공통 산정 증빙을 함께 검사합니다.</small></span></label>}<label className="field full note-field"><span>비고</span><textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value, noteMode: "manual" }))} placeholder="공식 금전출납부 비고란에 표시할 내용만" />{draft.category === "teamMinistry" && draft.id === firstTeamMinistryId && <button type="button" className="note-auto-button" onClick={() => setDraft((current) => ({ ...current, note: automaticTeamMinistryNote, noteMode: "auto" }))}><RotateCcw size={13} /> 지원금·회비 비고 자동 작성</button>}</label></div>
    {draft.category === "teamMinistry" && <div className="support-allocation-field selected automatic"><span className="support-allocation-check"><Check size={14} /></span><CircleDollarSign size={20} /><span><strong>팀별사역지원금 사용액으로 자동 계산</strong><small>지원금보다 남은 금액은 환입하고, 초과분은 팀회비 충당액으로 자동 계산합니다.</small></span></div>}
    {draft.category === "transport" && draft.isFuel && <div className="fuel-evidence-panel">
      <div className="fuel-evidence-heading"><div><Fuel size={19} /><span><strong>공통 주유비 산정 증빙</strong><small>각 주유 영수증과 1:1로 짝짓지 않습니다. 온라인 자료와 인쇄 후 붙일 오프라인 자료를 함께 사용할 수 있습니다.</small></span></div><div className="fuel-evidence-actions"><button type="button" className="button secondary" onClick={addFuelEvidence} disabled={!project.projectDirectory}><FileImage size={15} /> 온라인 파일</button><button type="button" className="button secondary" onClick={addFuelOfflineHolder}><ReceiptText size={15} /> 오프라인 칸</button></div></div>
      {(fuelEvidence?.attachments.length ?? 0) > 0 && <div className="fuel-evidence-subheading">온라인 산정 자료 {fuelEvidence!.attachments.length}개</div>}
      {fuelEvidence?.attachments.map((attachment, index) => <div className="fuel-evidence-row" key={attachment.id}><span>{index + 1}</span><button type="button" className="attachment-preview-trigger" onClick={() => setPreviewAttachment(attachment)} title="클릭하여 확대 보기">{attachment.originalName}</button><button type="button" className="icon-button" aria-label="온라인 주유비 산정 증빙 삭제" onClick={() => removeFuelEvidence(attachment.id)}><X size={14} /></button></div>)}
      {(fuelEvidence?.offlineHolders?.length ?? 0) > 0 && <div className="fuel-evidence-subheading">오프라인 부착칸 {fuelEvidence!.offlineHolders!.length}개</div>}
      {fuelEvidence?.offlineHolders?.map((holder, index) => <div className="offline-holder-row fuel-offline-holder-row" key={holder.id}><span className="holder-index">{index + 1}</span><strong>산정 자료 {index + 1}</strong><label><span>너비</span><input type="number" min="32" max="190" value={holder.widthMm} onChange={(event) => updateFuelOfflineHolder(holder.id, { widthMm: Math.min(190, Math.max(32, Number(event.target.value) || 32)) })} /><em>mm</em></label><b>×</b><label><span>높이</span><input type="number" min="20" max="262" value={holder.heightMm} onChange={(event) => updateFuelOfflineHolder(holder.id, { heightMm: Math.min(262, Math.max(20, Number(event.target.value) || 20)) })} /><em>mm</em></label><button type="button" className="icon-button" aria-label={`오프라인 주유비 산정 증빙 ${index + 1} 삭제`} onClick={() => removeFuelOfflineHolder(holder.id)}><Trash2 size={14} /></button></div>)}
      {!fuelEvidence?.attachments.length && !fuelEvidence?.offlineHolders?.length && <div className="fuel-evidence-empty"><AlertCircle size={15} /> 온라인 파일을 첨부하거나 오프라인 부착칸을 하나 이상 추가해 주세요. 둘 다 여러 개 사용할 수 있습니다.</div>}
    </div>}
    <div className="editor-section"><div className="section-title"><div><span>영수증 형태</span><small>실물 원본은 필요한 조각 수만큼 빈 부착칸을 만들고, 온라인 영수증은 이미지로 출력합니다.</small></div></div><div className="choice-cards"><button className={draft.receiptMode === "offline-original" ? "selected" : ""} onClick={() => setDraft((current) => ({ ...current, receiptMode: "offline-original", offlineHolders: offlineHoldersForExpense(current) }))}><ReceiptText size={22} /><strong>오프라인 실물</strong><span>출력 후 원본 부착</span></button><button className={draft.receiptMode === "online-printable" ? "selected" : ""} onClick={() => update("receiptMode", "online-printable")}><FileImage size={22} /><strong>온라인 자료</strong><span>이미지 함께 출력</span></button></div>{draft.receiptMode === "offline-original" && <><label className="original-confirm"><input type="checkbox" checked={draft.originalConfirmed} onChange={(event) => update("originalConfirmed", event.target.checked)} /><Check size={15} /><span>제출할 실물 영수증 원본을 보관 중입니다.</span></label><div className="offline-holder-setup"><div className="offline-holder-heading"><span><strong>실물 부착칸 {offlineHolders.length}개</strong><small>긴 영수증을 잘라 붙일 때 칸을 추가하세요. 각 칸은 영수증철에서 다시 조절할 수 있습니다.</small></span><button type="button" className="button secondary" onClick={addDraftOfflineHolder}><Plus size={15} /> 부착칸 추가</button></div>{offlineHolders.map((holder, index) => <div className="offline-holder-row" key={holder.id}><span className="holder-index">{index + 1}</span><strong>실물 조각 {index + 1}</strong><label><span>너비</span><input type="number" min="32" max="190" value={holder.widthMm} onChange={(event) => updateDraftOfflineHolder(holder.id, { widthMm: Math.min(190, Math.max(32, Number(event.target.value) || 32)) })} /><em>mm</em></label><b>×</b><label><span>높이</span><input type="number" min="20" max="262" value={holder.heightMm} onChange={(event) => updateDraftOfflineHolder(holder.id, { heightMm: Math.min(262, Math.max(20, Number(event.target.value) || 20)) })} /><em>mm</em></label><button type="button" className="icon-button" aria-label={`실물 부착칸 ${index + 1} 삭제`} disabled={offlineHolders.length <= 1} onClick={() => removeDraftOfflineHolder(holder.id)}><Trash2 size={14} /></button></div>)}</div></>}
      <div className="attachment-box"><div><ScanLine size={23} /><span><strong>{draft.attachments.length ? `${draft.attachments.length}개 첨부됨` : "영수증 사진 또는 PDF"}</strong><small>{project.projectDirectory ? "여러 파일을 선택하거나 클립보드 이미지를 바로 붙여넣으세요." : "프로젝트를 먼저 저장하면 첨부할 수 있습니다."}</small></span></div><span className="paste-shortcut"><ClipboardPaste size={15} /> ⌘V / Ctrl+V</span><button className="button secondary" onClick={attach} disabled={!project.projectDirectory}><Plus size={16} /> 파일 여러 개 선택</button></div>{draft.attachments.map((attachment) => <div className="attachment-row" key={attachment.id}><FileImage size={17} /><button type="button" className="attachment-preview-trigger" onClick={() => setPreviewAttachment(attachment)} title="클릭하여 확대 보기">{attachment.originalName}</button><select value={attachment.kind} onChange={(event) => update("attachments", draft.attachments.map((item) => item.id === attachment.id ? { ...item, kind: event.target.value as Attachment["kind"] } : item))}><option value="online-receipt">영수증</option><option value="card-slip">카드전표</option><option value="transaction-statement">거래명세서</option><option value="order-detail">주문상세</option><option value="insurance-certificate">보험증권</option><option value="transfer-proof">이체확인</option><option value="other">기타</option></select><button aria-label="첨부파일 삭제" onClick={() => update("attachments", draft.attachments.filter((item) => item.id !== attachment.id))}><X size={15} /></button></div>)}
    </div>
    <div className="editor-section internal-section"><div className="section-title"><div><span>누가 결제했나요? <em>앱 내부 전용</em></span><small>기본은 팀비입니다. 팀원이 먼저 냈을 때만 이름을 입력하세요.</small></div></div><div className="choice-cards payment"><button className={draft.paymentSource === "team" ? "selected" : ""} onClick={() => update("paymentSource", "team")}><WalletCards size={20} /><span><strong>팀비로 결제</strong><small>별도 정산 없음</small></span></button><button className={draft.paymentSource === "personal" ? "selected" : ""} onClick={() => update("paymentSource", "personal")}><Users size={20} /><span><strong>개인이 먼저 결제</strong><small>나중에 돌려줄 금액</small></span></button></div>{draft.paymentSource === "personal" && <div className="payer-inline"><label className="field"><span>먼저 결제한 사람</span><input list="known-payers" value={payerName} onChange={(event) => { const name = event.target.value; setPayerName(name); const existing = project.people.find((person) => person.name === name); update("payerId", existing?.id); }} placeholder="이름을 바로 입력하세요" /><datalist id="known-payers">{project.people.filter((person) => person.name.trim()).map((person) => <option value={person.name} key={person.id} />)}</datalist><small>{project.people.some((person) => person.name === payerName) ? "기존 정산 대상자를 선택했습니다." : payerName.trim() ? "새 이름은 내역 반영 시 자동 등록됩니다." : "설정에서 미리 추가할 필요가 없습니다."}</small></label><div className="field-grid settlement-fields"><Field label="돌려줄 금액" type="number" value={String(draft.settlementTargetAmount || draft.amount || "")} onChange={(value) => update("settlementTargetAmount", Number(value))} /><Field label="이미 돌려준 금액" type="number" value={String(draft.settledAmount || "")} onChange={(value) => update("settledAmount", Number(value))} /></div></div>}<div className="internal-caption"><BadgeCheck size={15} /> 이름과 정산 정보는 공식 Excel과 영수증철에 표시되지 않습니다.</div></div>
  </div><div className="drawer-footer"><button className="button ghost" onClick={onClose}>취소</button><button className="button accent" onClick={() => onSave(draft, payerName)} disabled={!draft.date || !draft.content.trim() || draft.amount <= 0 || (draft.paymentSource === "personal" && !payerName.trim())}><Check size={17} /> 내역 반영</button></div></div></div>{previewAttachment && <AttachmentPreviewModal project={project} attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}</>;
}

function AttachmentPreviewModal({ project, attachment, onClose }: { project: ProjectData; attachment: Attachment; onClose: () => void }) {
  const { source, failed } = useAttachmentPreviewSource(project, attachment);
  return <div className="attachment-preview-backdrop no-print" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="attachment-preview-modal" role="dialog" aria-modal="true" aria-label={`${attachment.originalName} 미리보기`}>
      <div className="attachment-preview-header"><div><FileImage size={19} /><span><strong>{attachment.originalName}</strong><small>첨부파일 확대 보기</small></span></div><button className="icon-button" aria-label="미리보기 닫기" onClick={onClose}><X size={19} /></button></div>
      <div className="attachment-preview-body">{source ? attachment.mimeType === "application/pdf" || attachment.originalName.toLowerCase().endsWith(".pdf") ? <div className="preview-conversion-needed"><FileImage size={36} /><strong>PDF를 이미지로 변환하는 중이거나 변환에 실패했습니다.</strong><span>프로젝트를 다시 열면 자동 변환을 다시 시도합니다.</span></div> : <img src={source} alt={attachment.originalName} /> : <span>{failed ? "첨부 이미지를 읽지 못했습니다. 프로젝트 파일을 다시 열어 주세요." : "첨부 이미지를 불러오는 중입니다."}</span>}</div>
    </div>
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function Field({ label, value, onChange, type = "text", placeholder, helper }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; helper?: string }) { return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />{helper && <small>{helper}</small>}</label>; }

function newExpense(project: ProjectData): Expense {
  const id = crypto.randomUUID();
  return { id, createdOrder: Math.max(0, ...project.expenses.map((expense) => expense.createdOrder)) + 1, category: "transport", date: "", content: "", amount: 0, note: "", receiptMode: "offline-original", originalConfirmed: false, attachments: [], offlineHolders: [{ id: crypto.randomUUID(), widthMm: 82, heightMm: 62 }], itemDetails: "", isFuel: false, paymentSource: "team", settlementTargetAmount: 0, settledAmount: 0, settlementStatus: "not-applicable" };
}

export default App;
