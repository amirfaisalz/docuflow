variable "name" {
  type        = string
  description = "Prefix for load balancer resources."
}

variable "vpc_id" {
  type        = string
  description = "VPC identifier."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnets for the load balancer."
}

variable "security_group_id" {
  type        = string
  description = "Security group for the load balancer."
}

variable "certificate_arn" {
  type        = string
  description = "Optional ACM certificate ARN. When set, HTTP redirects to HTTPS."
  default     = null
}

variable "api_host" {
  type        = string
  description = "Host header routed to the API target group."
  default     = "api.example.com"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to resources."
  default     = {}
}

resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.security_group_id]
  subnets            = var.public_subnet_ids
  idle_timeout       = 60

  enable_deletion_protection = true

  tags = merge(var.tags, { Name = "${var.name}-alb" })
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/health/ready"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  tags = merge(var.tags, { Name = "${var.name}-api" })
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  tags = merge(var.tags, { Name = "${var.name}-web" })
}

resource "aws_lb_listener" "https" {
  count = var.certificate_arn == null ? 0 : 1

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }

  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [] : [1]
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = var.certificate_arn == null ? aws_lb_listener.http.arn : aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = [var.api_host]
    }
  }
}

output "dns_name" {
  value = aws_lb.this.dns_name
}

output "zone_id" {
  value = aws_lb.this.zone_id
}

output "api_target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}
