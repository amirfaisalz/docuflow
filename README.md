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
| Authentication    | Secure user authentication                | Planned |
| Organizations     | Multi-tenant organization management      | Planned |
| Document upload   | Upload PDF and image files                | Planned |
| Object storage    | Store original documents in S3            | Planned |
| Async processing  | Background jobs with BullMQ               | Planned |
| OCR               | Extract text from scanned documents       | Planned |
| AI extraction     | Generate structured JSON using LLMs       | Planned |
| Schema validation | Validate extracted data                   | Planned |
| Human review      | Review and correct extracted results      | Planned |
| API keys          | Programmatic access for developers        | Planned |
| Usage metering    | Track processing and API consumption      | Planned |
| Webhooks          | Notify external systems about job results | Planned |
| Observability     | Logs, metrics, and distributed tracing    | Planned |
| Infrastructure    | Containerized AWS deployment              | Planned |

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
- **AWS S3:** Document object storage.
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
- **Metrics:** Job duration, throughput, failure rates, and API latency.
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
        S3[(AWS S3)]
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
    API --> S3
    API --> Redis

    Redis --> Queue
    Queue --> Worker

    Worker --> S3
    Worker --> OCR
    Worker --> LLM
    Worker --> DB

    Worker --> Webhook
    Webhook --> User
```

### Main Components

**1. Web Application**

The frontend provides:

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

**6. AWS S3**

Stores uploaded documents and generated artifacts. Documents should be accessed through authorized, time-limited URLs rather than public object access.

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
5. Generates a pre-signed S3 upload URL.

The client uploads the file directly to S3.

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

- Private S3 buckets.
- Pre-signed URLs with expiration.
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

Authentication endpoints are public. Registration creates a user with a scrypt password hash; login issues a signed one-hour HS256 bearer token. Authenticated organization endpoints require `Authorization: Bearer <accessToken>`.

| Method | Endpoint         | Description     |
| ------ | ---------------- | --------------- |
| POST   | `/auth/register` | Register a user |
| POST   | `/auth/login`    | Authenticate    |
| POST   | `/auth/refresh`  | Refresh session |
| POST   | `/auth/logout`   | End session     |

### Organizations

Organization list/create and membership list/add are tenant-scoped. The creator becomes `OWNER`; only `OWNER` and `ADMIN` can add members. Organization details and memberships return `404` to users outside the tenant.

| Method | Endpoint                     | Description         |
| ------ | ---------------------------- | ------------------- |
| GET    | `/organizations`             | List organizations  |
| POST   | `/organizations`             | Create organization |
| GET    | `/organizations/:id`         | Get organization    |
| GET    | `/organizations/:id/members` | List members        |
| GET    | `/organizations/:id/members` | List members        |
| POST   | `/organizations/:id/members` | Add member           |

### Documents

| Method | Endpoint                         | Description         |
| ------ | -------------------------------- | ------------------- |
| POST   | `/documents/upload-url`          | Generate upload URL |
| POST   | `/documents/:id/complete-upload` | Confirm upload      |
| GET    | `/documents`                     | List documents      |
| GET    | `/documents/:id`                 | Get document        |
| DELETE | `/documents/:id`                 | Delete document     |
| POST   | `/documents/:id/process`         | Start processing    |

### Processing Jobs

| Method | Endpoint              | Description           |
| ------ | --------------------- | --------------------- |
| GET    | `/jobs/:id`           | Get job status        |
| GET    | `/documents/:id/jobs` | List document jobs    |
| POST   | `/jobs/:id/retry`     | Retry failed job      |
| GET    | `/jobs/:id/result`    | Get extraction result |

### API Keys and Usage

| Method | Endpoint        | Description       |
| ------ | --------------- | ----------------- |
| GET    | `/api-keys`     | List API keys     |
| POST   | `/api-keys`     | Create API key    |
| DELETE | `/api-keys/:id` | Revoke API key    |
| GET    | `/usage`        | Get usage summary |

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

The response confirms job creation, not processing completion.

Clients should poll the job status endpoint or subscribe to webhook notifications.

---

## 10. AI Extraction Pipeline

The extraction pipeline converts document text into structured, schema-compliant data.

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

### Webhook Reliability

The webhook dispatcher should support:

- Signed payloads.
- Delivery attempt tracking.
- Configurable retry policies.
- Exponential backoff.
- Request timeouts.
- Delivery history.
- Duplicate event handling.

Webhook consumers should use the event ID to implement idempotent event handling.

---

## 12. Usage Metering

The platform should track resource consumption at the organization level.

Potential usage metrics:

- Number of documents processed.
- Total pages processed.
- OCR requests.
- LLM input tokens.
- LLM output tokens.
- Total processing duration.
- Failed processing attempts.

Usage records should be tied to a unique operation so retries do not accidentally create duplicate billable usage.

The initial implementation should focus on accurate tracking before introducing subscription plans or complex billing logic.

---

## 13. Repository Structure

The project uses a Turborepo monorepo to organize applications and shared packages.

```text
docuflow-ai/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   └── lib/
│   │
│   ├── api/
│   │   └── src/
│   │       ├── auth/
│   │       ├── organizations/
│   │       ├── documents/
│   │       ├── processing/
│   │       ├── api-keys/
│   │       ├── usage/
│   │       ├── webhooks/
│   │       └── main.ts
│   │
│   └── worker/
│       └── src/
│           ├── processors/
│           ├── queues/
│           ├── services/
│           ├── providers/
│           └── main.ts
│
├── packages/
│   ├── database/
│   │   ├── prisma/
│   │   └── src/
│   ├── shared/
│   ├── validators/
│   ├── logger/
│   └── config/
│
├── infra/
│   └── terraform/
│       ├── modules/
│       └── environments/
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── deployment.md
│   └── decisions/
│
├── docker/
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

### Workspace Responsibilities

| Workspace             | Responsibility                    |
| --------------------- | --------------------------------- |
| `apps/web`            | Frontend application              |
| `apps/api`            | REST API                          |
| `apps/worker`         | Asynchronous document processing  |
| `packages/database`   | Prisma schema and database access |
| `packages/shared`     | Shared types and utilities        |
| `packages/validators` | Shared validation schemas         |
| `packages/logger`     | Structured logging                |
| `packages/config`     | Shared configuration              |
| `infra/terraform`     | Cloud infrastructure              |

---

## 14. Local Development

### Prerequisites

Install the following tools:

- Node.js LTS
- pnpm
- Docker
- Docker Compose
- Git

External credentials will be needed for AWS and the selected AI provider when those integrations are implemented.

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

# AWS
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=docuflow-documents
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# AI Provider
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Application
WEB_URL=http://localhost:3000
API_URL=http://localhost:4000
```

Never commit `.env` or real credentials to version control.

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
pnpm test
pnpm typecheck
pnpm build
```

API and worker health endpoint tests exercise real HTTP requests against ephemeral local ports. The API authentication and tenant-isolation integration test also uses PostgreSQL; start it with `docker compose up -d postgres` before running `pnpm test`. The API test script supplies a local-only JWT secret and default database URL; set `DATABASE_URL` and `JWT_SECRET` to override them.

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

Testing should cover business logic, integrations, security boundaries, and failure scenarios.

### Unit Tests

Test individual services and components:

- Document validation.
- Organization authorization.
- API key validation.
- Extraction schema validation.
- Job state transitions.
- Retry classification.
- Usage calculations.

### Integration Tests

Test interactions between:

- API and PostgreSQL.
- API and Redis.
- Worker and BullMQ.
- Worker and S3.
- Worker and AI providers.
- Webhook dispatcher and external endpoints.

External AI providers should be mocked in deterministic test cases.

### End-to-End Tests

Important user journeys:

1. Register and create an organization.
2. Upload a document.
3. Start processing.
4. Observe job status.
5. Retrieve extraction results.
6. Review and update extracted data.
7. Revoke an API key.
8. Verify cross-tenant access is denied.

### Reliability Tests

Test scenarios such as:

- Worker termination during processing.
- Duplicate job delivery.
- Redis disconnection.
- Database connection failure.
- AI provider timeout.
- AI provider rate limiting.
- Invalid LLM output.
- Webhook delivery failure.

---

## 16. Observability

The platform should expose enough telemetry to understand application behavior and diagnose production issues.

### Logging

Use structured logs with fields such as:

- `requestId`
- `organizationId`
- `documentId`
- `jobId`
- `workerId`
- `durationMs`
- `errorCode`

Do not log API secrets, authentication tokens, or sensitive document content.

### Metrics

Recommended metrics:

| Metric                    | Purpose                         |
| ------------------------- | ------------------------------- |
| API request latency       | API performance                 |
| API error rate            | Application reliability         |
| Queue waiting jobs        | Processing backlog              |
| Job processing duration   | Worker performance              |
| Job failure rate          | Processing reliability          |
| AI provider latency       | External dependency performance |
| Token consumption         | AI usage tracking               |
| Webhook delivery failures | Integration reliability         |

### Distributed Tracing

Trace a document through its full lifecycle:

```text
HTTP Request
    └── Document Upload
          └── Job Creation
                └── Queue
                      └── OCR Processing
                            └── AI Extraction
                                  └── Validation
                                        └── Database Persistence
                                              └── Webhook Delivery
```

---

## 17. Deployment Architecture

The intended production deployment uses AWS managed infrastructure.

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
        S3[(S3 Bucket)]
        Secrets[Secrets Manager]
    end

    Internet --> CDN
    CDN --> LB
    LB --> Web
    LB --> API

    API --> DB
    API --> Redis
    API --> S3

    Redis --> Worker
    Worker --> DB
    Worker --> S3

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
| Document storage     | S3                                              |
| Container registry   | ECR                                             |
| Secrets              | Secrets Manager                                 |
| Networking           | VPC                                             |
| Traffic routing      | Application Load Balancer                       |
| Monitoring           | CloudWatch and OpenTelemetry-compatible tooling |

### Infrastructure as Code

Terraform should manage:

- VPC and networking.
- Security groups.
- ECS clusters and services.
- RDS.
- ElastiCache.
- S3 buckets.
- IAM roles and policies.
- Secrets references.
- Load balancers.
- Application scaling configuration.

Infrastructure changes should be reviewed through version control and applied through controlled deployment workflows.

---

## 18. CI/CD Pipeline

GitHub Actions will automate quality checks and deployment workflows.

### Pull Request Pipeline

```text
Pull Request
    |
    v
Install Dependencies
    |
    v
Lint
    |
    v
Type Check
    |
    v
Unit Tests
    |
    v
Integration Tests
    |
    v
Build Applications
    |
    v
Security Checks
    |
    v
Ready for Review
```

### Deployment Pipeline

```text
Merge to Main
    |
    v
Run Quality Checks
    |
    v
Build Docker Images
    |
    v
Push Images to ECR
    |
    v
Deploy ECS Services
    |
    v
Health Checks
    |
    v
Deployment Verification
```

Deployment workflows should support safe rollbacks when health checks fail.

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

- [ ] Implement document metadata.
- [ ] Configure AWS S3.
- [ ] Implement pre-signed upload URLs.
- [ ] Validate file types and sizes.
- [ ] Implement upload confirmation.
- [ ] Add document listing and details.

### Milestone 4: Background Processing

- [ ] Configure Redis.
- [ ] Configure BullMQ.
- [ ] Create document processing queues.
- [ ] Implement worker lifecycle.
- [ ] Add job status tracking.
- [ ] Implement retry and backoff.
- [ ] Implement idempotent processing.
- [ ] Add failed job handling.

### Milestone 5: OCR and AI Extraction

- [ ] Integrate OCR.
- [ ] Extract text from PDF documents.
- [ ] Integrate an LLM provider.
- [ ] Implement structured extraction.
- [ ] Add Zod schema validation.
- [ ] Handle invalid model responses.
- [ ] Persist extraction results.

### Milestone 6: Developer Experience

- [ ] Implement API key generation.
- [ ] Implement API key hashing and revocation.
- [ ] Add document processing API.
- [ ] Add job status API.
- [ ] Implement usage metering.
- [ ] Implement webhook endpoints.
- [ ] Add webhook signing and retries.

### Milestone 7: Production Readiness

- [ ] Add unit tests.
- [ ] Add integration tests.
- [ ] Add end-to-end tests.
- [ ] Add structured logging.
- [ ] Add OpenTelemetry instrumentation.
- [ ] Create Terraform modules.
- [ ] Configure GitHub Actions.
- [ ] Deploy to AWS.
- [ ] Verify health checks and rollback.
- [ ] Document architecture and deployment.

---

## 21. Engineering Decisions

The project prioritizes practical engineering trade-offs rather than unnecessary complexity.

| Decision                      | Reason                                        |
| ----------------------------- | --------------------------------------------- |
| TypeScript across web and API | Shared language and type safety               |
| NestJS for backend            | Modular architecture and dependency injection |
| PostgreSQL                    | Relational data and transactional consistency |
| Redis + BullMQ                | Reliable asynchronous job orchestration       |
| S3 for documents              | Durable object storage                        |
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
