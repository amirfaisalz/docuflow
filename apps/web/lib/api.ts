export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  token?: string | null;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function errorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join(", ");
  }
  return `Request failed with status ${status}`;
}

/**
 * All browser requests go through the Next.js proxy at /backend, which forwards
 * to API_URL at request time. That keeps the app same-origin, so no CORS setup
 * is needed and the API origin does not have to be baked in at build time.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`/backend${path}`, {
      method: options.method ?? "GET",
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Could not reach the API. Is the dev server running?");
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!response.ok) throw new ApiError(response.status, errorMessage(payload, response.status), payload);
  return payload as T;
}

export type Role = "OWNER" | "ADMIN" | "MEMBER" | "DEVELOPER";

export type AuthUser = { id: string; email: string; name?: string | null };

export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

export type DocumentStatus =
  | "PENDING_UPLOAD"
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type DocumentRecord = {
  id: string;
  organizationId: string;
  filename: string;
  mimeType: string;
  size: number;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
};

export type ExtractionResult = {
  id: string;
  jobId: string;
  data: unknown;
  confidence: number | null;
  extractedText: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type ProcessingJob = {
  id: string;
  documentId: string;
  status: JobStatus;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  result?: ExtractionResult | null;
};

export type UploadUrlResponse = {
  document: DocumentRecord;
  upload: {
    url: string;
    apiKey: string;
    params: Record<string, string>;
  };
};

export type ApiKeyRecord = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type UsageSummary = {
  organizationId: string;
  period: { from: string | null; to: string | null };
  totals: {
    processedDocuments: number;
    inputTokens: number;
    outputTokens: number;
    processingDurationMs: number;
  };
  recent: Array<{
    jobId: string;
    inputTokens: number | null;
    outputTokens: number | null;
    processingDuration: number | null;
    createdAt: string;
  }>;
};

export type WebhookDelivery = {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  createdAt: string;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deliveries?: WebhookDelivery[];
};

export type Member = {
  id: string;
  role: Role;
  createdAt: string;
  email: string;
  name: string | null;
};

export const webhookEvents = [
  "document.processing.completed",
  "document.processing.failed",
] as const;

export const acceptedMimeTypes = ["application/pdf", "image/jpeg", "image/png"] as const;
export const maxUploadBytes = 10 * 1024 * 1024;

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDuration(ms: number) {
  if (!ms) return "0 ms";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function activeStatus(status: DocumentStatus | JobStatus) {
  return status === "QUEUED" || status === "PROCESSING";
}
