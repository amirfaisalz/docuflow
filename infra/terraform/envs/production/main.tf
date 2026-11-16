terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = var.project_name
  tags = {
    Project     = var.project_name
    Environment = "production"
    ManagedBy   = "terraform"
  }
  api_public_url = var.certificate_arn == null ? "http://${var.api_host}" : "https://${var.api_host}"
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "random_password" "webhook" {
  length  = 48
  special = false
}

module "network" {
  source = "../../modules/network"

  name = local.name
  tags = local.tags
}

module "storage" {
  source = "../../modules/storage"

  name = local.name
  tags = local.tags
}

module "database" {
  source = "../../modules/database"

  name                = local.name
  private_subnet_ids  = module.network.private_subnet_ids
  security_group_id   = module.network.database_security_group_id
  master_password     = random_password.database.result
  instance_class      = var.database_instance_class
  multi_az            = var.database_multi_az
  deletion_protection = var.database_deletion_protection
  tags                = local.tags
}

module "cache" {
  source = "../../modules/cache"

  name               = local.name
  private_subnet_ids = module.network.private_subnet_ids
  security_group_id  = module.network.redis_security_group_id
  node_type          = var.cache_node_type
  auth_token         = random_password.redis.result
  tags               = local.tags
}

module "alb" {
  source = "../../modules/alb"

  name              = local.name
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  security_group_id = module.network.alb_security_group_id
  certificate_arn   = var.certificate_arn
  api_host          = var.api_host
  tags              = local.tags
}

locals {
  database_url = "postgresql://${module.database.master_username}:${urlencode(random_password.database.result)}@${module.database.address}:${module.database.port}/${module.database.database_name}?schema=public"
  redis_url    = "rediss://:${urlencode(random_password.redis.result)}@${module.cache.primary_endpoint}:${module.cache.port}"
  secret_values = {
    database_url           = local.database_url
    redis_url              = local.redis_url
    jwt_secret             = random_password.jwt.result
    webhook_encryption_key = random_password.webhook.result
    gemini_api_key         = var.gemini_api_key
    cloudinary_cloud_name  = var.cloudinary_cloud_name
    cloudinary_api_key     = var.cloudinary_api_key
    cloudinary_api_secret  = var.cloudinary_api_secret
  }
}

module "secrets" {
  source = "../../modules/secrets"

  name   = local.name
  values = local.secret_values
  tags   = local.tags
}

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = values(module.secrets.arns)
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-docuflow-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

data "aws_iam_policy_document" "task_s3" {
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${module.storage.documents_bucket_arn}/*"]
  }

  statement {
    actions   = ["s3:ListBucket"]
    resources = [module.storage.documents_bucket_arn]
  }
}

resource "aws_iam_role" "api_task" {
  name               = "${local.name}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy" "api_s3" {
  name   = "document-storage"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.task_s3.json
}

resource "aws_iam_role" "worker_task" {
  name               = "${local.name}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy" "worker_s3" {
  name   = "document-storage"
  role   = aws_iam_role.worker_task.id
  policy = data.aws_iam_policy_document.task_s3.json
}

resource "aws_ecs_cluster" "this" {
  name = "${local.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name}-migrate"
  retention_in_days = 14

  tags = local.tags
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "${local.name}-migrate"
    image     = "${module.storage.repository_urls["api"]}:${var.image_tag}"
    essential = true
    command = [
      "node",
      "packages/database/node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--schema",
      "packages/database/prisma/schema.prisma",
    ]
    environment = [{ name = "NODE_ENV", value = "production" }]
    secrets     = [{ name = "DATABASE_URL", valueFrom = module.secrets.arns["database_url"] }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])

  tags = local.tags
}


locals {
  service_secrets = {
    DATABASE_URL           = module.secrets.arns["database_url"]
    REDIS_URL              = module.secrets.arns["redis_url"]
    JWT_SECRET             = module.secrets.arns["jwt_secret"]
    WEBHOOK_ENCRYPTION_KEY = module.secrets.arns["webhook_encryption_key"]
    GEMINI_API_KEY         = module.secrets.arns["gemini_api_key"]
    CLOUDINARY_CLOUD_NAME  = module.secrets.arns["cloudinary_cloud_name"]
    CLOUDINARY_API_KEY     = module.secrets.arns["cloudinary_api_key"]
    CLOUDINARY_API_SECRET  = module.secrets.arns["cloudinary_api_secret"]
  }
  service_environment = {
    NODE_ENV = "production"
    PORT     = "4000"
  }
}

module "api_service" {
  source = "../../modules/ecs-service"

  name               = "${local.name}-api"
  cluster_arn        = aws_ecs_cluster.this.arn
  cluster_name       = aws_ecs_cluster.this.name
  vpc_id             = module.network.vpc_id
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.application_security_group_id]
  image              = "${module.storage.repository_urls["api"]}:${var.image_tag}"
  cpu                = var.api_cpu
  memory             = var.api_memory
  container_port     = 4000
  environment        = local.service_environment
  secrets            = local.service_secrets
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.api_task.arn
  target_group_arn   = module.alb.api_target_group_arn
  health_check_path  = "/health/ready"
  desired_count      = var.api_desired_count
  min_capacity       = 1
  max_capacity       = var.api_max_capacity
  tags               = local.tags
}

module "worker_service" {
  source = "../../modules/ecs-service"

  name               = "${local.name}-worker"
  cluster_arn        = aws_ecs_cluster.this.arn
  cluster_name       = aws_ecs_cluster.this.name
  vpc_id             = module.network.vpc_id
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.application_security_group_id]
  image              = "${module.storage.repository_urls["worker"]}:${var.image_tag}"
  cpu                = var.worker_cpu
  memory             = var.worker_memory
  container_port     = 4001
  environment        = merge(local.service_environment, { PORT = "4001", WORKER_CONCURRENCY = tostring(var.worker_concurrency) })
  secrets            = local.service_secrets
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.worker_task.arn
  health_check_path  = "/health/ready"
  desired_count      = var.worker_desired_count
  min_capacity       = 1
  max_capacity       = var.worker_max_capacity
  tags               = local.tags
}

module "web_service" {
  source = "../../modules/ecs-service"

  name               = "${local.name}-web"
  cluster_arn        = aws_ecs_cluster.this.arn
  cluster_name       = aws_ecs_cluster.this.name
  vpc_id             = module.network.vpc_id
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.application_security_group_id]
  image              = "${module.storage.repository_urls["web"]}:${var.image_tag}"
  cpu                = var.web_cpu
  memory             = var.web_memory
  container_port     = 3000
  environment        = { NODE_ENV = "production", PORT = "3000", API_URL = local.api_public_url }
  execution_role_arn = aws_iam_role.execution.arn
  target_group_arn   = module.alb.web_target_group_arn
  health_check_path  = "/api/health"
  desired_count      = var.web_desired_count
  min_capacity       = 1
  max_capacity       = var.web_max_capacity
  tags               = local.tags
}
