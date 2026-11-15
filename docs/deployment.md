# Deployment

The production target is AWS: an Application Load Balancer in front of three
ECS Fargate services, with RDS PostgreSQL, ElastiCache Redis, S3, ECR, Secrets
Manager, and CloudWatch Logs. Terraform owns the infrastructure; GitHub Actions
builds images and deploys them.

> The repository ships a working deployment pipeline, but applying it requires
> an AWS account, a remote Terraform backend, and GitHub OIDC configuration.
> No AWS resources are created by the test suite.

## Prerequisites

- AWS account and permissions to create VPC, ECS, RDS, ElastiCache, S3, ECR,
  IAM, ALB, Secrets Manager, and CloudWatch resources.
- Terraform 1.9 or newer.
- AWS CLI v2 and Docker.
- pnpm 10 and Node.js 22 for local verification.
- Optional: an ACM certificate and DNS record for the API host.

## 1. Bootstrap Remote State

Create an S3 bucket with versioning and SSE, plus a DynamoDB table with a
`LockID` partition key. Then configure the backend for the environment:

```bash
cd infra/terraform/envs/production
terraform init \
  -backend-config="bucket=YOUR_STATE_BUCKET" \
  -backend-config="key=production/terraform.tfstate" \
  -backend-config="region=ap-southeast-1" \
  -backend-config="dynamodb_table=YOUR_LOCK_TABLE" \
  -backend-config="encrypt=true"
```

The `backend.tf.example` file documents the same values.

## 2. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

Required values:

| Variable | Description |
| --- | --- |
| `gemini_api_key` | Gemini API key |
| `cloudinary_cloud_name` | Cloudinary cloud name |
| `cloudinary_api_key` | Cloudinary API key |
| `cloudinary_api_secret` | Cloudinary API secret |
| `api_host` | API DNS host, e.g. `api.docuflow.example.com` |
| `certificate_arn` | Optional ACM certificate for HTTPS |

Terraform generates the database password, Redis auth token, JWT secret, and
webhook encryption key. These values and the application secrets are written to
Secrets Manager. Terraform state contains sensitive values, so remote state must
be encrypted and access-controlled.

## 3. Provision Infrastructure

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

Modules:

| Module | Resources |
| --- | --- |
| `network` | VPC, public/private subnets, NAT, route tables, security groups |
| `storage` | S3 documents bucket, ECR repositories, lifecycle policies |
| `database` | RDS PostgreSQL, subnet group, backups, encryption |
| `cache` | ElastiCache Redis with TLS and AUTH |
| `secrets` | Secrets Manager entries for runtime configuration |
| `alb` | ALB, target groups, HTTP/HTTPS listeners, API host rule |
| `ecs-service` | Task definition, service, logs, autoscaling, circuit breaker |

The environment also creates ECS task roles, an execution role with access to
the application secrets, an ECS cluster, and a one-off migration task
definition.

After apply, point DNS at the ALB (`load_balancer_dns` output) or configure the
`api_host` record.

## 4. Configure GitHub

Create an IAM role for GitHub Actions using OIDC. It needs permissions for ECR
push, ECS service/run-task/describe/update, `iam:PassRole` for the ECS roles, and
CloudWatch log reads. Store these repository settings:

### Variables

| Name | Example |
| --- | --- |
| `AWS_REGION` | `ap-southeast-1` |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/docuflow-deploy` |
| `AWS_TERRAFORM_ROLE_ARN` | `arn:aws:iam::123456789012:role/docuflow-terraform` |
| `PROJECT_NAME` | `docuflow` |
| `ECS_CLUSTER` | `docuflow-cluster` |
| `MIGRATION_TASK_DEFINITION` | Migration task definition ARN from Terraform |
| `ECS_SUBNETS` | Private subnet IDs from Terraform, comma-separated |
| `ECS_SECURITY_GROUPS` | Application security group ID from Terraform |
| `HEALTH_CHECK_URL` | `https://api.docuflow.example.com/health/ready` |
| `API_SERVICE_NAME` | `docuflow-api` |
| `WORKER_SERVICE_NAME` | `docuflow-worker` |
| `WEB_SERVICE_NAME` | `docuflow-web` |
| `TF_STATE_BUCKET` | Terraform state bucket |
| `TF_LOCK_TABLE` | Terraform lock table |

### Secrets

| Name | Description |
| --- | --- |
| `GEMINI_API_KEY` | Terraform variable |
| `CLOUDINARY_CLOUD_NAME` | Terraform variable |
| `CLOUDINARY_API_KEY` | Terraform variable |
| `CLOUDINARY_API_SECRET` | Terraform variable |

The `production` GitHub Environment should require reviewers.

## 5. Deployment Pipeline

On a successful `CI` run on `main`, or a manual `Deploy` dispatch:

1. Build and push `api`, `worker`, and `web` images tagged with the commit SHA.
2. Register a migration task revision with the new API image and run
   `prisma migrate deploy`.
3. Register new task definitions for each service and update ECS.
4. Wait for all three services to reach a steady state.
5. Poll `HEALTH_CHECK_URL` up to twelve times.

The deployment script captures the previous task definition for every service
before changing anything. Any failure after that point restores the previous
task definitions and waits for the services to stabilize again.

Terraform verification:

```bash
terraform fmt -check -recursive
terraform validate
```

## 6. Observability

Set an OTLP endpoint on the ECS task definitions (for example through an extra
environment variable) to enable tracing:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com
OTEL_SERVICE_NAME=docuflow-api
```

Application logs are JSON in CloudWatch Logs under `/ecs/docuflow-api`,
`/ecs/docuflow-worker`, `/ecs/docuflow-web`, and `/ecs/docuflow-migrate`.
Container Insights and ALB metrics provide queue/latency/failure signals.

## 7. Rollback Runbook

**Automatic rollback.** The deploy workflow rolls back when an ECS service does
not stabilize or the readiness probe fails.

**Manual rollback.** Describe the previous task definition revision and update
the service:

```bash
aws ecs update-service \
  --cluster docuflow-cluster \
  --service docuflow-api \
  --task-definition docuflow-api:PREVIOUS_REVISION
```

**Database migration failure.** The pipeline stops before deploying services.
Inspect the migration task logs (`/ecs/docuflow-migrate`) and run Prisma
migrations manually through a one-off ECS task after fixing the schema.

**Redis or database outage.** `/health/ready` returns `503`, so the ALB removes
the target. Workers retry transient failures with backoff; webhook deliveries
retain their attempt history.

## 8. Cost Notes

The defaults are intentionally small: one NAT gateway, a single-AZ
`db.t4g.micro`, and one `cache.t4g.micro` node. Enable `database_multi_az`,
raise instance classes, and add more NAT gateways for production scale.
