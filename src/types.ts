export const CATEGORY_DEFINITIONS = [
  { id: "transport", number: 1, label: "교통비" },
  { id: "lodging", number: 2, label: "숙박비" },
  { id: "meals", number: 3, label: "식대간식비" },
  { id: "ministry", number: 4, label: "사역비" },
  { id: "gifts", number: 5, label: "선물구입비" },
  { id: "teamMinistry", number: 6, label: "팀별사역비" },
  { id: "offering", number: 7, label: "헌금" },
  { id: "misc", number: 8, label: "잡비" },
] as const;

export type CategoryId = (typeof CATEGORY_DEFINITIONS)[number]["id"];
export type IncomeType = "dues" | "teamSupport" | "flowing";
export type ReceiptMode = "offline-original" | "online-printable";
export type PaymentSource = "team" | "personal";
export type SettlementStatus = "not-applicable" | "pending" | "partial" | "settled";

export interface ProjectMeta {
  community: string;
  groupName: string;
  teamName: string;
  destination: string;
  startDate: string;
  endDate: string;
  headcount: number;
  leaderName: string;
  leaderPhone: string;
  accountantName: string;
  accountantPhone: string;
  pastorName: string;
  submissionDate: string;
}

export interface Income {
  id: string;
  type: IncomeType;
  amount: number;
  receivedAt: string;
  memo: string;
}

export interface Person {
  id: string;
  name: string;
  bankMemo: string;
}

export interface Attachment {
  id: string;
  relativePath: string;
  originalName: string;
  mimeType: string;
  layout?: {
    widthMm?: number;
    aspectRatio?: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
  };
  kind:
    | "offline-preview"
    | "online-receipt"
    | "card-slip"
    | "transaction-statement"
    | "order-detail"
    | "insurance-certificate"
    | "transfer-proof"
    | "tax-invoice"
    | "quote"
    | "ticket"
    | "other";
}

export interface Expense {
  id: string;
  createdOrder: number;
  category: CategoryId;
  date: string;
  content: string;
  amount: number;
  note: string;
  receiptMode: ReceiptMode;
  originalConfirmed: boolean;
  attachments: Attachment[];
  mealHeadcount?: number;
  itemDetails: string;
  isFuel: boolean;
  paymentSource: PaymentSource;
  payerId?: string;
  settlementTargetAmount: number;
  settledAmount: number;
  settledAt?: string;
  settlementStatus: SettlementStatus;
  receiptNumber?: number;
}

export interface CategoryEvidence {
  id: string;
  category: CategoryId;
  kind: "fuel-calculation" | "other";
  title: string;
  attachments: Attachment[];
}

export interface ProjectData {
  schemaVersion: 1;
  id: string;
  projectDirectory?: string;
  meta: ProjectMeta;
  duesPerPerson: number;
  incomes: Income[];
  people: Person[];
  expenses: Expense[];
  categoryEvidence: CategoryEvidence[];
  receiptNumbersFinalized: boolean;
  updatedAt: string;
}

export interface ValidationIssue {
  id: string;
  severity: "error" | "warning";
  scope: "project" | "expense" | "evidence" | "settlement";
  expenseId?: string;
  title: string;
  detail: string;
}

export interface SettlementSummary {
  personId: string;
  personName: string;
  expenseCount: number;
  paidPersonally: number;
  targetAmount: number;
  settledAmount: number;
  outstandingAmount: number;
}

export const createEmptyProject = (): ProjectData => ({
  schemaVersion: 1,
  id: crypto.randomUUID(),
  meta: {
    community: "",
    groupName: "",
    teamName: "",
    destination: "",
    startDate: "",
    endDate: "",
    headcount: 0,
    leaderName: "",
    leaderPhone: "",
    accountantName: "",
    accountantPhone: "",
    pastorName: "",
    submissionDate: "",
  },
  duesPerPerson: 0,
  incomes: [],
  people: [],
  expenses: [],
  categoryEvidence: [],
  receiptNumbersFinalized: false,
  updatedAt: new Date().toISOString(),
});

export const getCategory = (id: CategoryId) =>
  CATEGORY_DEFINITIONS.find((category) => category.id === id)!;
