variable "name" {
  type        = string
  description = "Service name."
}

variable "cluster_arn" {
  type        = string
  description = "ECS cluster ARN."
}

variable "cluster_name" {
  type        = string
  description = "ECS cluster name."
}

variable "vpc_id" {
  type        = string
  description = "VPC identifier."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnets for the tasks."
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security groups for the tasks."
}

variable "assign_public_ip" {
  type        = bool
  description = "Assign public IPs to tasks (required only without a NAT gateway)."
  default     = false
}

variable "image" {
  type        = string
  description = "Container image URI."
}

variable "cpu" {
  type        = number
  description = "Fargate CPU units."
  default     = 512
}

variable "memory" {
  type        = number
  description = "Fargate memory in MiB."
  default     = 1024
}

variable "container_port" {
  type        = number
  description = "Container port, or null for a worker without an HTTP listener."
  default     = null
}

variable "command" {
  type        = list(string)
  description = "Optional container command override."
  default     = null
}

variable "environment" {
  type        = map(string)
  description = "Plaintext environment variables."
  default     = {}
}

variable "secrets" {
  type        = map(string)
  description = "Environment variable name to Secrets Manager ARN."
  default     = {}
}

variable "execution_role_arn" {
  type        = string
  description = "ECS task execution role ARN."
}

variable "task_role_arn" {
  type        = string
  description = "ECS task role ARN."
  default     = null
}

variable "target_group_arn" {
  type        = string
  description = "Optional ALB target group ARN."
  default     = null
}

variable "health_check_path" {
  type        = string
  description = "Optional container health check path."
  default     = null
}

variable "desired_count" {
  type        = number
  description = "Desired task count."
  default     = 1
}

variable "min_capacity" {
  type        = number
  description = "Minimum autoscaling capacity."
  default     = 1
}

variable "max_capacity" {
  type        = number
  description = "Maximum autoscaling capacity."
  default     = 4
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days."
  default     = 14
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to resources."
  default     = {}
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    merge(
      {
        name      = var.name
        image     = var.image
        essential = true
        portMappings = var.container_port == null ? [] : [{
          containerPort = var.container_port
          protocol      = "tcp"
        }]
        environment = [for key, value in var.environment : { name = key, value = value }]
        secrets     = [for key, value in var.secrets : { name = key, valueFrom = value }]
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            "awslogs-group"         = aws_cloudwatch_log_group.this.name
            "awslogs-region"        = data.aws_region.current.name
            "awslogs-stream-prefix" = var.name
          }
        }
        healthCheck = var.health_check_path == null || var.container_port == null ? [] : [{
          command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.container_port}${var.health_check_path} || exit 1"]
          interval    = 30
          timeout     = 5
          retries     = 3
          startPeriod = 30
        }]
      },
      var.command == null ? {} : { command = var.command }
    )
  ])

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_ecs_service" "this" {
  name                              = var.name
  cluster                           = var.cluster_arn
  task_definition                   = aws_ecs_task_definition.this.arn
  desired_count                     = var.desired_count
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = var.target_group_arn == null ? null : 60
  enable_execute_command            = true

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [1]
    content {
      target_group_arn = var.target_group_arn
      container_name   = var.name
      container_port   = var.container_port
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  wait_for_steady_state = true

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.this.name}"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  resource_id        = aws_appautoscaling_target.this.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = 65
    scale_in_cooldown  = 120
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "memory" {
  name               = "${var.name}-memory"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  resource_id        = aws_appautoscaling_target.this.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = 75
    scale_in_cooldown  = 120
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

data "aws_region" "current" {}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}
