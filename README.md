# DocuFlow AI

**A Multi-Tenant AI Document Processing Platform**

Upload documents, extract structured data with AI, review the results, and integrate the output into your applications through a developer-friendly API.

> Project status: In Development

---

## 1. Overview

DocuFlow AI is a multi-tenant document processing platform that transforms unstructured documents into validated, structured data using OCR and Large Language Models (LLMs).

Businesses often receive information in PDFs, scanned documents, invoices, contracts, forms, and other file formats. Extracting this information manually is time-consuming, difficult to scale, and prone to human error.

DocuFlow AI provides an asynchronous document processing pipeline that allows users to:

- Upload PDF and image documents.
- Process documents asynchronously in the background.
- Extract structured information using AI.
- Validate extracted data against predefined schemas.
- Review and correct extraction results.
- Access processed data through REST APIs.
- Track usage, processing status, and API consumption.
- Receive webhook notifications when processing is complete.

The platform is designed around reliability, scalability, security, and maintainability.

### Key Engineering Goals

1. **Asynchronous processing:** Handle long-running document workloads without blocking API requests.
2. **Reliable execution:** Support retries, idempotency, and failure recovery.
3. **Multi-tenancy:** Isolate organizations, users, documents, and API credentials.
4. **Structured AI output:** Convert unstructured content into predictable JSON.
5. **Developer experience:** Provide APIs, API keys, usage tracking, and webhooks.
6. **Production readiness:** Include observability, automated testing, CI/CD, and infrastructure as code.

---

## 2. Core Features

The following features represent the intended product scope. Implementation status should be updated as each feature is completed.

| Feature           | Description                               | Status  |
| ----------------- | ----------------------------------------- | ------- |
| Authentication    | Secure user authentication                | Implemented |
| Organizations     | Multi-tenant organization management      | Implemented |
| Document upload   | Upload PDF and image files                | Implemented |
| Object storage    | Store original documents in Cloudinary    | Implemented |
| Async processing  | Background jobs with BullMQ               | Implemented |
| OCR               | Extract text from scanned documents       | Implemented |
| AI extraction     | Generate structured JSON using LLMs       | Implemented |
| Schema validation | Validate extracted data                   | Implemented |
| Human review      | Review and correct extracted results      | Planned |
| API keys          | Programmatic access for developers        | Implemented |
| Usage metering    | Track processing and API consumption      | Implemented |
| Webhooks          | Notify external systems about job results | Implemented |
| Observability     | Structured logs, tracing, and readiness probes | Implemented |
| Infrastructure    | Containerized AWS deployment              | Implemented |
| Web dashboard     | Upload, review, and usage UI              | Planned |

---

## 3. Technology Stack

The project uses a TypeScript-first architecture with dedicated services for the web application, API, and background processing.

### Frontend

- **Next.js:** Application framework.
- **React:** UI development.
- **TypeScript:** Type safety.
- **Tailwind CSS:** Styling.
- **TanStack Query:** Server state management.

### Backend

- **NestJS:** Modular backend application.
- **Node.js:** Runtime environment.
- **TypeScript:** Shared language across application services.
- **Prisma:** Database access and schema management.
- **Zod:** Runtime validation for shared data contracts.

### Data and Infrastructure

- **PostgreSQL:** Primary relational database.
- **Redis:** Queue infrastructure and temporary processing state.
- **BullMQ:** Background job processing.
- **Cloudinary:** Private document object storage.
- **AWS S3:** Provisioned by Terraform for future artifact storage; not used by the current pipeline.
- **Docker:** Containerization.
- **AWS ECS Fargate:** Container deployment.
- **Terraform:** Infrastructure as code.
- **GitHub Actions:** CI/CD automation.

### AI and Document Processing

- **OpenAI API / Anthropic API:** LLM-powered structured extraction.
- **OCR engine:** Text extraction from scanned documents.
- **Python:** Optional document processing worker for specialized PDF and OCR workloads.

### Observability

- **OpenTelemetry:** Distributed tracing and instrumentation.
- **Structured logging:** Application and worker logs.
- **Metrics:** CloudWatch Container Insights and ALB metrics for latency, throughput, failures, and resource usage.
- **Grafana:** Monitoring and visualization.

---

## 4. System Architecture

DocuFlow AI separates request handling from document processing.

The API accepts requests, validates permissions, stores metadata, and dispatches background jobs. Workers process documents independently and update their status in PostgreSQL.

This prevents long-running OCR and AI operations from blocking HTTP requests.

### High-Level Architecture

```mermaid
flowchart TB
    User[User / Client Application]

    subgraph Application
        Web[Next.js Web App]
        API[NestJS API]
    end

    subgraph Storage
        DB[(PostgreSQL)]
        Storage[(Cloudinary)]
        Redis[(Redis)]
    end

    subgraph Processing
        Queue[BullMQ Queue]
        Worker[Document Worker]
        OCR[OCR Engine]
        LLM[LLM Provider]
    end

    subgraph Integrations
        Webhook[Webhook Dispatcher]
    end

    User --> Web
    User --> API
    Web --> API

    API --> DB
    API --> Storage
    API --> Redis

    Redis --> Queue
    Queue --> Worker

    Worker --> Storage
    Worker --> OCR
    Worker --> LLM
    Worker --> DB

    Worker --> Webhook
    Webhook --> User
```

### Main Components

**1. Web Application**

The frontend currently serves a landing page. The planned dashboard will provide:

- Authentication and organization management.
- Document upload interface.
- Processing status dashboard.
- Extraction result viewer.
- Human review interface.
- API key management.
- Usage and billing overview.

**2. API Service**

The NestJS API handles:

- Authentication and authorization.
- Organization and user management.
- Document metadata.
- Upload authorization.
- Job creation and status retrieval.
- API key validation.
- Usage tracking.
- Webhook configuration.

**3. Document Worker**

The worker handles long-running operations:

- Downloading documents from object storage.
- Detecting document formats.
- Extracting text through OCR.
- Preparing content for AI extraction.
- Calling LLM providers.
- Validating structured output.
- Persisting results.
- Triggering webhook events.

**4. PostgreSQL**

Stores application data, including organizations, users, documents, processing jobs, extraction results, API keys, and usage records.

**5. Redis and BullMQ**

Manages background job queues, concurrency, retries, and job scheduling.

**6. Cloudinary**

Stores uploaded documents as authenticated assets. Documents are accessed through signed upload parameters and short-lived signed download URLs rather than public object access. Terraform also provisions an S3 bucket reserved for future artifact storage.

---

## 5. Document Processing Lifecycle

Every uploaded document follows a defined processing lifecycle.

```mermaid
stateDiagram-v2
    [*] --> UPLOADED
    UPLOADED --> QUEUED
    QUEUED --> PROCESSING
    PROCESSING --> OCR_COMPLETED
    OCR_COMPLETED --> EXTRACTING
    EXTRACTING --> VALIDATING
    VALIDATING --> COMPLETED
    VALIDATING --> NEEDS_REVIEW
    NEEDS_REVIEW --> COMPLETED
    PROCESSING --> FAILED
    OCR_COMPLETED --> FAILED
    EXTRACTING --> FAILED
    VALIDATING --> FAILED
    FAILED --> QUEUED: Retry
    COMPLETED --> [*]
```

### Processing Steps

**Step 1: Upload**

The client requests permission to upload a document.

The API:

1. Authenticates the user.
2. Checks organization membership.
3. Validates file type and size.
4. Creates a document record.
5. Generates signed Cloudinary upload parameters.

The client uploads the file directly to Cloudinary.

**Step 2: Job Creation**

After upload confirmation, the API creates a processing job.

The job is placed in a BullMQ queue and assigned a unique identifier.

The API returns immediately instead of waiting for document processing to finish.

**Step 3: OCR Processing**

The worker retrieves the original document and extracts its text.

For scanned documents, an OCR engine converts image content into machine-readable text.

The extracted content is stored as a processing artifact.

**Step 4: AI Extraction**

The worker sends the extracted content and extraction instructions to the configured LLM provider.

The model is instructed to return structured JSON based on the requested schema.

**Step 5: Validation**

The extracted JSON is validated against a predefined schema.

Validation checks include:

- Required fields.
- Data types.
- Field constraints.
- Expected formats.
- Missing or invalid values.

Invalid output can trigger a controlled retry or be sent for human review.

**Step 6: Result Persistence**

The validated result is stored in PostgreSQL.

The document and job status are updated accordingly.

**Step 7: Notification**

When processing reaches a terminal state, the system can dispatch a webhook event to the configured endpoint.

---

## 6. Reliability and Background Jobs

Reliable background processing is one of the core engineering concerns of this project.

A distributed job system must account for network failures, worker crashes, provider timeouts, duplicate messages, and partial execution.

### Retry Strategy

Jobs should support:

- Configurable maximum attempts.
- Exponential backoff.
- Retryable and non-retryable error classification.
- Failed job inspection.
- Dead-letter handling.

Example retry configuration:

```typescript
await documentQueue.add(
  "process-document",
  {
    documentId,
    organizationId,
  },
  {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
);
```

This is an illustrative configuration. Production behavior should also account for provider rate limits, job timeouts, and operational recovery.

### Idempotency

A job may be delivered more than once.

The processing pipeline must prevent duplicate execution from creating duplicate results or usage charges.

The system should:

1. Assign a unique processing job identifier.
2. Enforce appropriate database uniqueness constraints.
3. Check the current processing state before applying updates.
4. Make result persistence safe to repeat.
5. Record usage against a unique processing operation.

### Concurrency Control

Workers should support configurable concurrency to avoid overwhelming:

- AI providers.
- OCR services.
- Database connections.
- Object storage.
- Available CPU and memory.

### Failure Handling

Failures should be classified into categories:

| Failure              | Expected Behavior       |
| -------------------- | ----------------------- |
| Invalid file         | Reject processing       |
| Unsupported format   | Mark as failed          |
| OCR timeout          | Retry if recoverable    |
| LLM rate limit       | Retry with backoff      |
| LLM invalid response | Retry or request review |
| Database unavailable | Retry safely            |
| Worker crash         | Recover unfinished work |
| Invalid permissions  | Reject request          |

The system must never assume that an operation failed simply because a client did not receive a response. It should use persistent job state to determine the actual outcome.

---

## 7. Multi-Tenancy and Security

DocuFlow AI is designed as a multi-tenant platform.

Each organization owns its documents, API credentials, processing jobs, and usage records.

### Tenant Isolation

Every tenant-owned resource must be associated with an organization identifier.

Authorization checks must ensure that users can only access resources belonging to organizations where they have the appropriate permissions.

Tenant isolation must be enforced at the service and database access layers, not only in frontend routes.

### Authentication and Authorization

Planned capabilities:

- Secure user authentication.
- Organization membership.
- Role-based access control.
- API key authentication.
- Organization-level permissions.

Example roles:

| Role      | Permissions                           |
| --------- | ------------------------------------- |
| Owner     | Full organization access              |
| Admin     | Manage users, documents, and settings |
| Member    | Upload and review documents           |
| Developer | Manage API integrations and API keys  |

### API Key Security

API keys should:

- Be generated using cryptographically secure randomness.
- Be displayed only once during creation.
- Be stored as hashes.
- Support revocation and rotation.
- Be scoped to an organization.
- Support usage tracking.

### Document Security

Security requirements include:

- Authenticated Cloudinary assets rather than public object access.
- Signed upload parameters and short-lived signed download URLs.
- File type and size validation.
- File content verification.
- Authorization checks for document access.
- Protection against path traversal and malicious uploads.
- Secrets stored outside source control.
- Encryption in transit and at rest.

Sensitive document content should not appear in application logs.

---

## 8. Data Model

The initial data model is designed around organizations, documents, jobs, and extraction results.

### Main Entities

| Entity           | Purpose                             |
| ---------------- | ----------------------------------- |
| User             | Application user                    |
| Organization     | Tenant account                      |
| Membership       | User-to-organization relationship   |
| Document         | Uploaded document metadata          |
| ProcessingJob    | Background processing lifecycle     |
| ExtractionResult | Structured AI output                |
| ApiKey           | Developer API credentials           |
| UsageRecord      | Processing and API consumption      |
| WebhookEndpoint  | External notification configuration |
| WebhookDelivery  | Webhook delivery attempts           |

### Relationship Overview

```mermaid
erDiagram
    ORGANIZATION ||--o{ MEMBERSHIP : has
    USER ||--o{ MEMBERSHIP : belongs_to
    ORGANIZATION ||--o{ DOCUMENT : owns
    DOCUMENT ||--o{ PROCESSING_JOB : has
    PROCESSING_JOB ||--o| EXTRACTION_RESULT : produces
    ORGANIZATION ||--o{ API_KEY : owns
    ORGANIZATION ||--o{ USAGE_RECORD : generates
    ORGANIZATION ||--o{ WEBHOOK_ENDPOINT : configures
    WEBHOOK_ENDPOINT ||--o{ WEBHOOK_DELIVERY : receives
```

### Example Prisma Schema

The following is an initial schema reference. It will need to be expanded with indexes, constraints, migrations, and additional fields as implementation progresses.

```prisma
enum DocumentStatus {
  UPLOADED
  QUEUED
  PROCESSING
  COMPLETED
  NEEDS_REVIEW
  FAILED
}

enum JobStatus {
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
}

model Organization {
  id          String       @id @default(uuid())
  name        String
  slug        String       @unique
  memberships Membership[]
  documents   Document[]
  apiKeys     ApiKey[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model User {
  id          String       @id @default(uuid())
  email       String       @unique
  name        String?
  memberships Membership[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Membership {
  id             String       @id @default(uuid())
  userId         String
  organizationId String
  role           String

  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])

  @@unique([userId, organizationId])
}

model Document {
  id             String         @id @default(uuid())
  organizationId String
  filename       String
  mimeType       String
  size           BigInt
  storageKey     String
  status         DocumentStatus @default(UPLOADED)

  organization   Organization   @relation(fields: [organizationId], references: [id])
  jobs           ProcessingJob[]

  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  @@index([organizationId, createdAt])
}

model ProcessingJob {
  id          String    @id @default(uuid())
  documentId  String
  status      JobStatus @default(QUEUED)
  attempts    Int       @default(0)
  errorCode   String?
  errorMessage String?

  document    Document  @relation(fields: [documentId], references: [id])
  result      ExtractionResult?

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([documentId, createdAt])
}

model ExtractionResult {
  id          String        @id @default(uuid())
  jobId       String        @unique
  data        Json
  confidence  Float?

  job         ProcessingJob @relation(fields: [jobId], references: [id])
  createdAt   DateTime      @default(now())
}

model ApiKey {
  id             String       @id @default(uuid())
  organizationId String
  name           String
  keyHash        String       @unique
  lastUsedAt     DateTime?
  revokedAt      DateTime?

  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime      @default(now())

  @@index([organizationId])
}
```

---

## 9. API Design

The API follows REST conventions and uses versioned endpoints.

Base path:

```text
/api/v1
```

### Authentication

Authentication endpoints are public. Registration creates a user with a scrypt password hash; login issues a signed one-hour HS256 bearer token. Tokens are stateless, so there is no server-side refresh or logout endpoint yet: log in again to obtain a new token after expiry. Authenticated organization endpoints require `Authorization: Bearer <accessToken>`.

| Method | Endpoint         | Description     |
| ------ | ---------------- | --------------- |
| POST   | `/auth/register` | Register a user |
| POST   | `/auth/login`    | Authenticate    |

### Organizations

Organization list/create and membership list/add are tenant-scoped. The creator becomes `OWNER`; only `OWNER` and `ADMIN` can add members. Organization details and memberships return `404` to users outside the tenant.

| Method | Endpoint                     | Description         |
| ------ | ---------------------------- | ------------------- |
| GET    | `/organizations`             | List organizations  |
| POST   | `/organizations`             | Create organization |
| GET    | `/organizations/:id`         | Get organization    |
| GET    | `/organizations/:id/members` | List members        |
| POST   | `/organizations/:id/members` | Add member           |

### Documents

Document upload URLs are signed by the API and scoped to an organization membership. Supported formats are PDF, JPEG, and PNG; the maximum upload size is 10 MiB. `GET /documents` lists documents across the caller's organizations; pass `X-Organization-Id` to scope it to one organization. Listing and details return only metadata, never storage credentials.

| Method | Endpoint                         | Description         |
| ------ | -------------------------------- | ------------------- |
| POST   | `/documents/upload-url`          | Generate signed upload parameters |
| POST   | `/documents/:id/complete-upload` | Confirm upload      |
| GET    | `/documents`                     | List documents      |
| GET    | `/documents/:id`                 | Get document        |

Upload request:

```json
{
  "organizationId": "<organization-id>",
  "filename": "invoice.pdf",
  "mimeType": "application/pdf",
  "size": 2048
}
```

The response contains a pending document record and a Cloudinary upload URL, API key, and signed parameters. The client uploads directly to Cloudinary as a multipart form, including the returned parameters, `api_key`, and `file`. PDF files use Cloudinary's `raw` resource type; JPEG and PNG use `image`. After a successful Cloudinary upload, call `POST /documents/:id/complete-upload`; the API verifies the private Cloudinary asset's ID, resource type, format, and byte size before changing its status to `QUEUED` and creating a processing job.

### Processing Jobs

After an upload is verified, its document becomes `QUEUED` and exactly one processing job is persisted and enqueued in the `document-processing` BullMQ queue. Jobs use three attempts with exponential backoff. The worker downloads private documents from Cloudinary, sends PDF/image bytes to Gemini (which performs OCR as needed), validates structured invoice output with Zod, and persists extracted text, data, confidence, and model in PostgreSQL. Exhausted failures are recorded in PostgreSQL and copied to the `document-processing-failed` BullMQ queue. A failed job can be retried through the API, and its persisted error information is available in the job status response.

| Method | Endpoint              | Description           |
| ------ | --------------------- | --------------------- |
| GET    | `/jobs/:id`           | Get job status and extraction result |
| GET    | `/documents/:id/jobs` | List document jobs    |
| POST   | `/jobs/:id/retry`     | Retry failed job      |

Set `REDIS_URL` for API and worker services (defaults to `redis://localhost:6379`). The worker also accepts `WORKER_CONCURRENCY` (default `2`) for document jobs and `WEBHOOK_CONCURRENCY` (default `5`) for webhook deliveries.

### API Keys and Usage

Organization owners, admins, and developers can create API keys for programmatic access. The plaintext secret is returned only when the key is created; the API stores a SHA-256 hash and a searchable prefix. Revocation is immediate and does not delete historical usage records.

| Method | Endpoint                     | Authentication      | Description        |
| ------ | ---------------------------- | ------------------- | ------------------ |
| POST   | `/api/v1/api-keys`           | User access token   | Create API key     |
| GET    | `/api/v1/api-keys`           | User access token   | List API keys      |
| DELETE | `/api/v1/api-keys/:id`       | User access token   | Revoke API key     |
| POST   | `/api/v1/documents/:id/process` | API key          | Create or retry a processing job |
| GET    | `/api/v1/jobs/:id`           | API key or user token | Get job status and result |
| GET    | `/api/v1/usage`              | API key or user token | Get usage summary |

Create a key with `POST /api/v1/api-keys`:

```json
{
  "organizationId": "org_123",
  "name": "Invoice integration"
}
```

The response includes the one-time `secret` (`df_live_...`). Send it as `Authorization: Bearer df_live_...` to the programmatic document and job endpoints. Key management endpoints use the normal user access token plus an explicit organization scope: send `x-organization-id` for list/revoke, or `organizationId` in the create body. Requests without an organization scope return `400`. Plaintext secrets are never returned by list endpoints.

`GET /api/v1/usage` accepts optional `from` and `to` ISO timestamps. User-token requests select the organization with `x-organization-id`; API-key requests are scoped to the key's organization. The response aggregates successful processing operations, LLM input/output tokens, processing duration, and recent usage records.

Usage is written transactionally with extraction results. The unique `UsageRecord.jobId` constraint makes metering idempotent when a job is retried or replayed.

### Example: Create Processing Request

```http
POST /api/v1/documents/doc_123/process
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

Response:

```json
{
  "jobId": "job_123",
  "documentId": "doc_123",
  "status": "QUEUED",
  "createdAt": "2026-11-15T10:00:00.000Z"
}
```

The response confirms job creation, not processing completion. The endpoint is idempotent: it returns the active or completed job instead of creating a duplicate, and reuses a failed job as a retry.

Clients can poll `GET /api/v1/jobs/:id`; the response includes `result: { extractedText, data, confidence, model }` after successful processing, or `result: null` beforehand. Data is invoice-shaped: `invoiceNumber`, `vendor`, `invoiceDate` (ISO date), `total`, and `currency`; unknown values are `null`. Extraction results remain available alongside job status. The worker requires `GEMINI_API_KEY`; configure `GEMINI_MODEL` to select another supported Gemini model. `GEMINI_API_BASE_URL` and `GEMINI_TIMEOUT_MS` are optional overrides.

---

## 10. AI Extraction Pipeline

The extraction pipeline downloads private PDF/image assets from Cloudinary and sends the bytes directly to Gemini multimodal input for document text OCR and invoice extraction. It validates responses against a strict Zod invoice schema before persisting both extracted text and structured fields. The worker requires `GEMINI_API_KEY`; configure optional `GEMINI_MODEL`, `GEMINI_API_BASE_URL`, and `GEMINI_TIMEOUT_MS` for model selection, compatible proxies, and timeouts.

### Example Use Case: Invoice Extraction

Input document:

```text
Invoice Number: INV-2026-001
Vendor: Example Company
Date: 2026-11-15
Total: $1,250.00
Currency: USD
```

Expected output:

```json
{
  "invoiceNumber": "INV-2026-001",
  "vendor": "Example Company",
  "invoiceDate": "2026-11-15",
  "total": 1250,
  "currency": "USD"
}
```

### Extraction Process

1. Retrieve OCR text.
2. Load the extraction schema.
3. Construct the LLM prompt.
4. Request structured output.
5. Parse the response.
6. Validate against the schema.
7. Store the result.
8. Flag uncertain or invalid results for review.

### Schema-Based Extraction

Example using Zod:

```typescript
import { z } from "zod";

export const InvoiceSchema = z.object({
  invoiceNumber: z.string(),
  vendor: z.string(),
  invoiceDate: z.string(),
  total: z.number().nonnegative(),
  currency: z.string().length(3),
});

export type Invoice = z.infer<typeof InvoiceSchema>;
```

The application should treat LLM output as untrusted input. Successful model generation does not guarantee correct extraction.

Schema validation ensures structural correctness, but business-level verification and human review may still be necessary.

### AI Provider Abstraction

The application should avoid coupling business logic to a single AI provider.

A provider abstraction allows the system to support different LLM services without rewriting the processing pipeline.

```typescript
export interface ExtractionProvider {
  extract(input: {
    text: string;
    schema: Record<string, unknown>;
    instructions?: string;
  }): Promise<{
    data: unknown;
    model: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
    };
  }>;
}
```

---

## 11. Webhooks

Webhooks allow external applications to receive processing updates.

Example event:

```json
{
  "id": "evt_123",
  "type": "document.processing.completed",
  "createdAt": "2026-11-15T10:10:00.000Z",
  "data": {
    "documentId": "doc_123",
    "jobId": "job_123",
    "status": "COMPLETED"
  }
}
```

### Webhook Endpoints

| Method | Endpoint                 | Description            |
| ------ | ------------------------ | ---------------------- |
| POST   | `/api/v1/webhooks`       | Register an endpoint   |
| GET    | `/api/v1/webhooks`       | List endpoints and recent deliveries |
| DELETE | `/api/v1/webhooks/:id`   | Delete an endpoint     |

Only organization owners, admins, and developers can register or delete endpoints. Registration requires an HTTPS URL and one or more event types: `document.processing.completed` and `document.processing.failed`. The response includes the one-time `signingSecret`; the database stores it encrypted with `WEBHOOK_ENCRYPTION_KEY` (or `JWT_SECRET` when the dedicated key is absent).

### Webhook Reliability

Webhook delivery is asynchronous through the `docuflow-webhooks` BullMQ queue. Deliveries use five attempts with exponential backoff, a 10-second request timeout, persistent delivery records, and per-attempt history. The payload is JSON and includes a unique event ID. The `x-docuflow-delivery` header carries that ID, while `x-docuflow-signature` contains `t=<unix-seconds>,v1=<hex HMAC>`. Sign the string `<t>.<eventId>.<raw body>` with the endpoint signing secret to verify authenticity.

Webhook consumers should use the event ID to implement idempotent event handling.

---

## 12. Usage Metering

The platform tracks resource consumption at the organization level.

Implemented usage metrics:

- Successful documents processed.
- LLM input tokens.
- LLM output tokens.
- Processing duration in milliseconds.
- Recent operations by job ID.

Usage records are tied to a unique processing job, so retries and replays do not create duplicate billable usage.

The initial implementation should focus on accurate tracking before introducing subscription plans or complex billing logic.

---

## 13. Repository Structure

The project uses a Turborepo monorepo to organize applications and shared packages.

```text
docuflow-ai/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── next.config.ts
│   │   └── Dockerfile
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── auth-tenancy.ts
│   │   │   ├── documents.ts
│   │   │   ├── developer.ts
│   │   │   ├── health.ts
│   │   │   ├── observability.ts
│   │   │   ├── processing-queue.ts
│   │   │   └── main.ts
│   │   └── Dockerfile
│   │
│   └── worker/
│       ├── src/
│       │   ├── app.ts
│       │   ├── document-processing.ts
│       │   ├── health.ts
│       │   ├── processing-queue.ts
│       │   ├── webhooks.ts
│       │   └── main.ts
│       └── Dockerfile
│
├── packages/
│   ├── database/
│   │   └── prisma/
│   ├── observability/
│   │   └── src/
│   │       ├── health.ts
│   │       ├── logger.ts
│   │       ├── telemetry.ts
│   │       └── index.ts
│   └── shared/
│       └── src/
│
├── infra/
│   └── terraform/
│       ├── modules/
│       └── envs/production/
│
├── tests/
│   └── e2e/
│
├── .github/
│   ├── workflows/
│   └── scripts/
│
├── docs/
│   ├── architecture.md
│   └── deployment.md
│
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

### Workspace Responsibilities

| Workspace                | Responsibility                        |
| ------------------------ | ------------------------------------- |
| `apps/web`               | Frontend application                  |
| `apps/api`               | REST API                              |
| `apps/worker`            | Asynchronous document processing      |
| `packages/database`      | Prisma schema and database access     |
| `packages/observability` | Logging, tracing, and readiness       |
| `packages/shared`        | Shared types                          |
| `tests/e2e`              | Cross-service end-to-end verification |
| `infra/terraform`        | AWS infrastructure and deployment     |
| `docs`                   | Architecture and operations guides    |

---

## 14. Local Development

### Prerequisites

Install the following tools:

- Node.js LTS
- pnpm
- Docker
- Docker Compose
- Git

External credentials are required for Cloudinary document storage and Gemini extraction; see the environment example below.

### Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/docuflow-ai.git

cd docuflow-ai
```

### Install Dependencies

```bash
pnpm install
```

### Configure Environment Variables

Create a local environment file based on `.env.example`.

```bash
cp .env.example .env
```

Example configuration:

```env
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/docuflow

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=replace-with-a-secure-secret-at-least-32-chars
# Encrypts webhook signing secrets at rest. Falls back to JWT_SECRET when omitted.
WEBHOOK_ENCRYPTION_KEY=replace-with-a-separate-secret-at-least-32-chars

# Cloudinary document storage
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# AWS (reserved for future infrastructure integrations)
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=docuflow-documents
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# AI Provider
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
# Optional: override the Gemini API for proxies and local integration tests.
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_TIMEOUT_MS=60000
# Optional: set when using a compatible signed-download proxy rather than Cloudinary SDK URLs.
DOCUMENT_SOURCE_BASE_URL=

# Application
WEB_URL=http://localhost:3000
API_URL=http://localhost:4000
```

Copy `.env.example` to `.env`, add your Gemini API key and Cloudinary credentials, and never commit `.env` or real credentials to version control.

### Start Infrastructure

```bash
docker compose up -d postgres redis
```

### Run Database Migrations

```bash
pnpm db:generate
pnpm db:migrate
```

### Run Tests and Checks

```bash
pnpm test        # unit + integration (PostgreSQL and Redis required)
pnpm test:e2e    # full cross-service document lifecycle
pnpm typecheck
pnpm lint
pnpm build
```

API and worker tests exercise real HTTP requests against ephemeral local ports. Integration tests use PostgreSQL and Redis; start them with `docker compose up -d postgres redis` before running `pnpm test`. Cloudinary and Gemini are replaced with local HTTP servers, so no external credentials are required. The end-to-end suite boots both applications in-process, uploads through a Cloudinary-compatible mock, processes through the real BullMQ queue, and verifies extraction, usage, tenant isolation, and API-key revocation.

### Start Applications

```bash
pnpm dev
```

Expected local services:

| Service    | URL                          |
| ---------- | ---------------------------- |
| Web        | http://localhost:3000        |
| API        | http://localhost:4000        |
| API Health | http://localhost:4000/health |
| Worker     | http://localhost:4001/health |

These commands and endpoints should be aligned with the actual scripts and application configuration during implementation.

---

## 15. Testing Strategy

Testing covers business logic, integrations, security boundaries, and failure
scenarios.

### Unit Tests

Fast tests run without external infrastructure:

- Structured logger output, level filtering, and credential redaction.
- Readiness evaluation for healthy and degraded dependencies.

```bash
pnpm --filter @docuflow/observability test
```

### Integration Tests

Integration suites exercise real PostgreSQL and Redis:

- API and PostgreSQL.
- API and Redis/BullMQ.
- Worker and BullMQ.
- Worker and Cloudinary (local mock).
- Worker and Gemini (local mock).
- Webhook dispatcher and external HTTP endpoints.
- API keys, usage metering, retries, and tenant isolation.

```bash
pnpm test
```

### End-to-End Tests

The cross-service suite starts the API and worker in-process and covers:

1. Register and create an organization.
2. Create an API key.
3. Request a signed upload and complete it through a Cloudinary-compatible mock.
4. Process the document through the real BullMQ queue.
5. Retrieve validated extraction results through the API-key job endpoint.
6. Verify usage metering.
7. Verify cross-tenant access is denied.
8. Revoke the API key and confirm it can no longer authenticate.

```bash
pnpm test:e2e
```

### Reliability Tests

The worker suite covers terminal failures after exhausted attempts, malformed
model output, transient download failures with backoff, idempotent usage
metering, and webhook retry after a transient endpoint failure. Service-level
readiness checks expose dependency failures to the load balancer.

---

## 16. Observability

The platform emits enough telemetry to understand application behavior and
diagnose production issues.

### Logging

Both services emit one JSON object per event with fields such as:

- `timestamp`, `level`, `service`, `message`
- `requestId`, `traceId`, `spanId`
- `organizationId`, `documentId`, `jobId`, `workerId`
- `durationMs`, `errorCode`

Sensitive keys are redacted automatically, including authorization headers, API
keys, passwords, tokens, and webhook signing secrets. Set `LOG_LEVEL` to
`debug`, `info`, `warn`, or `error`.

### OpenTelemetry

Tracing is enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` or
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set. Manual spans cover:

- HTTP requests, including W3C trace-context extraction and `x-request-id`.
- Document processing jobs.
- Gemini `generateContent` calls.
- Webhook deliveries.

```text
HTTP Request
    └── Document Upload
          └── Job Creation
                └── Queue
                      └── Document Processing
                            └── Gemini Extraction
                                  └── Validation
                                        └── Database Persistence
                                              └── Webhook Delivery
```

### Health Checks

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Backwards-compatible liveness response |
| `GET /health/live` | Process liveness |
| `GET /health/ready` | PostgreSQL and Redis readiness, `503` when degraded |

Both API and worker expose these endpoints. The ALB uses `/health/ready`; ECS
container health checks use the same probe.

### Metrics

CloudWatch Container Insights and ALB metrics provide API latency, request
counts, task CPU/memory, and unhealthy targets. The services also emit structured
logs and OpenTelemetry traces. Application-level metrics such as queue waiting
jobs and webhook failure counts can be derived from BullMQ and the delivery
tables; dedicated counters are not emitted by the application yet.

---

## 17. Deployment Architecture

The production deployment uses AWS managed infrastructure.

```mermaid
flowchart TB
    Internet[Internet]
    CDN[CloudFront / HTTPS]
    LB[Application Load Balancer]

    subgraph AWS
        Web[ECS Web Service]
        API[ECS API Service]
        Worker[ECS Worker Service]
        DB[(RDS PostgreSQL)]
        Redis[(ElastiCache Redis)]
        Cloudinary[(Cloudinary)]
        S3[(S3 Bucket - reserved)]
        Secrets[Secrets Manager]
    end

    Internet --> CDN
    CDN --> LB
    LB --> Web
    LB --> API

    API --> DB
    API --> Redis
    API --> Cloudinary

    Redis --> Worker
    Worker --> DB
    Worker --> Cloudinary

    Web --> Secrets
    API --> Secrets
    Worker --> Secrets
```

### Infrastructure Components

| Component            | AWS Service                                     |
| -------------------- | ----------------------------------------------- |
| Web application      | ECS Fargate                                     |
| API                  | ECS Fargate                                     |
| Background workers   | ECS Fargate                                     |
| Database             | RDS PostgreSQL                                  |
| Queue infrastructure | ElastiCache Redis                               |
| Document storage     | Cloudinary                                      |
| Artifact storage     | S3 bucket provisioned for future use            |
| Container registry   | ECR                                             |
| Secrets              | Secrets Manager                                 |
| Networking           | VPC                                             |
| Traffic routing      | Application Load Balancer                       |
| Monitoring           | CloudWatch and OpenTelemetry-compatible tooling |

### Infrastructure as Code

`infra/terraform` contains reusable modules for networking, storage, database,
cache, secrets, the load balancer, and ECS services. The production environment
wires them together, creates IAM roles, and defines a one-off migration task.

```bash
cd infra/terraform/envs/production
terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=production/terraform.tfstate" \
  -backend-config="region=ap-southeast-1" \
  -backend-config="dynamodb_table=YOUR_LOCK_TABLE" \
  -backend-config="encrypt=true"
terraform plan -out=tfplan
terraform apply tfplan
```

See [docs/deployment.md](docs/deployment.md) for prerequisites, GitHub OIDC
setup, DNS, rollback, and the operational runbook.

### Containers and Health Verification

Each application has a multi-stage Dockerfile. API and worker images run the
compiled TypeScript entrypoint; the web image uses the Next.js standalone
output. ECS services use:

- ALB target-group health checks on `/health/ready`.
- Container-level health checks on liveness/readiness.
- Deployment circuit breakers with automatic rollback.
- Autoscaling on CPU and memory.

---

## 18. CI/CD Pipeline

GitHub Actions owns quality gates and deployment.

### Pull Request Pipeline

```text
Pull Request
    |
    v
Install Dependencies
    |
    v
Prisma Generate + Migrate
    |
    v
Lint
    |
    v
Type Check
    |
    v
Unit + Integration Tests
    |
    v
End-to-End Tests
    |
    v
Build Applications
    |
    v
Dependency Audit
    |
    v
Container Builds (api, worker, web)
```

### Deployment Pipeline

```text
Merge to Main
    |
    v
CI Success
    |
    v
Build Docker Images
    |
    v
Push Images to ECR
    |
    v
Run Prisma Migration Task
    |
    v
Deploy ECS Services
    |
    v
Wait for Steady State
    |
    v
Health Check
    |
    v
Success, or automatic rollback to previous task definitions
```

The Terraform workflow validates formatting and configuration on pull requests.
Manual dispatches can plan or apply infrastructure changes with the production
environment approval.

---

## 19. Performance and Scalability Considerations

The system should scale its API and processing workers independently.

### API Scaling

The API should remain stateless wherever practical, allowing multiple instances to serve requests.

### Worker Scaling

Workers can scale based on:

- Queue backlog.
- Average processing duration.
- CPU utilization.
- Memory utilization.
- Provider rate limits.

### Database Performance

Use appropriate indexes for:

- Organization-scoped queries.
- Document status.
- Job status.
- Creation timestamps.
- Usage reporting.

Use pagination for large document and job collections.

### Storage Lifecycle

Define retention policies for original files and temporary processing artifacts.

Avoid retaining unnecessary intermediate files indefinitely.

### Cost Management

AI processing and document storage can become significant cost drivers.

The platform should track usage per organization and provide visibility into expensive processing operations.

---

## 20. Development Roadmap

The implementation is divided into milestones to prioritize a working end-to-end system before adding advanced features.

### Milestone 1: Foundation

- [x] Initialize pnpm workspace.
- [x] Configure Turborepo.
- [x] Create Next.js application.
- [x] Create NestJS API.
- [x] Create worker application.
- [x] Configure shared TypeScript packages.
- [x] Configure PostgreSQL and Prisma.
- [x] Add Docker Compose.
- [x] Add health check endpoints.

### Milestone 2: Authentication and Multi-Tenancy

- [x] Implement authentication.
- [x] Create organization management.
- [x] Implement organization membership.
- [x] Add role-based access control.
- [x] Enforce tenant isolation.
- [x] Add authorization tests.

### Milestone 3: Document Upload

- [x] Implement document metadata.
- [x] Configure Cloudinary document storage.
- [x] Implement signed upload parameters.
- [x] Validate file types and sizes.
- [x] Implement upload confirmation.
- [x] Add document listing and details.

### Milestone 4: Background Processing

- [x] Configure Redis.
- [x] Configure BullMQ.
- [x] Create document processing queues.
- [x] Implement worker lifecycle.
- [x] Add job status tracking.
- [x] Implement retry and backoff.
- [x] Implement idempotent processing.
- [x] Add failed job handling.

### Milestone 5: OCR and AI Extraction

- [x] Integrate OCR through Gemini multimodal document input.
- [x] Extract text from PDF documents and images.
- [x] Integrate Gemini as the LLM provider.
- [x] Implement structured invoice extraction.
- [x] Add Zod schema validation.
- [x] Handle provider errors and invalid model responses.
- [x] Persist extraction results.

### Milestone 6: Developer Experience

- [x] Implement API key generation.
- [x] Implement API key hashing and revocation.
- [x] Add document processing API.
- [x] Add job status API.
- [x] Implement usage metering.
- [x] Implement webhook endpoints.
- [x] Add webhook signing and retries.

### Milestone 7: Production Readiness

- [x] Add unit tests.
- [x] Add integration tests.
- [x] Add end-to-end tests.
- [x] Add structured logging.
- [x] Add OpenTelemetry instrumentation.
- [x] Create Terraform modules.
- [x] Configure GitHub Actions.
- [x] Deploy to AWS (Terraform + ECS deployment/rollback pipeline; requires AWS credentials).
- [x] Verify health checks and rollback.
- [x] Document architecture and deployment.

---

## 21. Engineering Decisions

The project prioritizes practical engineering trade-offs rather than unnecessary complexity.

| Decision                      | Reason                                        |
| ----------------------------- | --------------------------------------------- |
| TypeScript across web and API | Shared language and type safety               |
| NestJS for backend            | Modular architecture and dependency injection |
| PostgreSQL                    | Relational data and transactional consistency |
| Redis + BullMQ                | Reliable asynchronous job orchestration       |
| Cloudinary for documents      | Managed authenticated document storage       |
| LLM provider abstraction      | Avoid provider lock-in                        |
| Turborepo                     | Shared packages and monorepo orchestration    |
| Docker                        | Consistent local and production environments  |
| Terraform                     | Reproducible infrastructure                   |
| OpenTelemetry                 | Vendor-neutral observability                  |

### Important Trade-offs

**Why asynchronous processing?**

Document processing can take seconds or minutes. Keeping it outside the request lifecycle improves API responsiveness and allows workers to scale independently.

**Why PostgreSQL?**

The platform contains strongly related entities such as users, organizations, documents, jobs, and usage records. PostgreSQL provides relational integrity and transactional guarantees.

**Why Redis and BullMQ?**

A dedicated queue allows the system to control concurrency, retries, scheduling, and processing workloads independently from API traffic.

**Why a monorepo?**

The web application, API, worker, and shared packages are closely related. A monorepo helps maintain consistent types, validation rules, and development workflows.

**Why provider abstraction?**

AI providers can differ in pricing, availability, latency, and model capabilities. An abstraction makes it easier to change providers without coupling business logic to a specific vendor.

---

## 22. Future Improvements

Potential improvements after the core platform is stable:

- Multiple OCR providers.
- Document classification.
- Custom extraction templates.
- Batch document processing.
- Human-in-the-loop approval workflows.
- Multi-page document splitting.
- Advanced usage-based billing.
- Organization-level quotas.
- Custom AI model selection.
- Document retention policies.
- Advanced audit trails.
- Horizontal worker autoscaling.
- More detailed cost analytics.

These improvements should be prioritized based on actual usage and operational needs.

---

## 23. Project Scope

DocuFlow AI is intended to demonstrate production-oriented full-stack engineering across:

- TypeScript application development.
- Backend architecture and API design.
- Multi-tenant SaaS systems.
- Relational database design.
- Asynchronous distributed processing.
- AI and LLM integrations.
- OCR and document processing.
- Cloud infrastructure.
- Infrastructure as code.
- Automated testing and CI/CD.
- Observability and reliability engineering.

The primary goal is to build a working, deployable system with clear engineering decisions and measurable behavior.

---

## License

This project is currently intended for portfolio and educational purposes. Licensing terms will be defined separately.
