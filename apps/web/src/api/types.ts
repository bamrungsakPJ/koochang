/** Response shapes of the ServiceFlow API used by the web app. */

export interface Site {
  id: string;
  displayName: string;
  lat: number | null;
  lng: number | null;
  addressText: string | null;
  notes: string | null;
}

export interface Category {
  id: string;
  name: string;
  issueTypes: string[];
}

export interface CustomerSummary {
  id: string;
  displayName: string;
  phone: string | null;
  assetCount: number;
}

export interface CustomerDetail {
  id: string;
  displayName: string;
  phone: string | null;
  notes: string | null;
  sites: Site[];
  assets: {
    id: string;
    category: string | null;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    siteName: string | null;
    installedAt: string | null;
    photoUrl: string | null;
  }[];
  jobs: { id: string; jobNo: string; status: string; issueType: string | null; assetLabel: string | null; createdAt: string; open: boolean }[];
}

export interface TimelineItem {
  type: string;
  occurredAt: string;
  actorName: string | null;
  job?: { id: string; jobNo: string } | null;
  details: Record<string, unknown>;
}

export interface AssetDetail {
  id: string;
  label: string;
  category: Category | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: string;
  notes: string | null;
  installedAt: string | null;
  installedBy: string | null;
  warrantyEnd: string | null;
  nextServiceDate: string | null;
  photoUrl: string | null;
  customer: { id: string; displayName: string; phone: string | null };
  site: Site | null;
  openJobs: { id: string; jobNo: string; status: string; issueType: string | null }[];
  timeline: TimelineItem[];
}

export interface JobSummary {
  id: string;
  jobNo: string;
  status: string;
  issueType: string | null;
  createdAt: string;
  scheduledFor: string | null;
  customerName: string;
  siteName: string | null;
  assetLabel: string | null;
  assignee: { id: string; displayName: string } | null;
}

export type JobAction =
  | 'assign'
  | 'accept'
  | 'on-the-way'
  | 'arrive'
  | 'start'
  | 'need-part'
  | 'need-return'
  | 'complete'
  | 'cancel';

export interface JobDetail extends JobSummary {
  issueNote: string | null;
  returnNote: string | null;
  source: string;
  timestamps: Record<string, string | null>;
  customer: { id: string; displayName: string; phone: string | null };
  site: Site | null;
  asset: {
    id: string;
    label: string;
    category: string | null;
    issueTypes: string[];
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    installedAt: string | null;
    warrantyEnd: string | null;
    photoUrl: string | null;
  } | null;
  outcome: { workTypes: string[]; note?: string } | null;
  partsUsed: { name: string; spec: string | null; qty: number }[];
  partRequests: { id: string; description: string | null; status: string; createdAt: string }[];
  photos: { id: string; kind: string; url: string }[];
  previousService: { id: string; jobNo: string; completedAt: string; workTypes: string[]; parts: string[] }[];
  events: TimelineItem[];
  allowedActions: JobAction[];
}

export interface Member {
  id: string;
  role: string;
  displayName: string;
  phone: string | null;
  isMe: boolean;
}
