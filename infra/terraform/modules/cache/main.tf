variable "name" {
  type        = string
  description = "Prefix for cache resources."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for the cache subnet group."
}

variable "security_group_id" {
  type        = string
  description = "Security group that allows application access."
}

variable "node_type" {
  type        = string
  description = "ElastiCache node type."
  default     = "cache.t4g.micro"
}

variable "engine_version" {
  type        = string
  description = "Redis engine version."
  default     = "7.1"
}

variable "auth_token" {
  type        = string
  description = "Redis AUTH token (minimum 16 characters)."
  sensitive   = true
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to resources."
  default     = {}
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.private_subnet_ids

  tags = merge(var.tags, { Name = "${var.name}-redis" })
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${var.name}-redis"
  description                = "DocuFlow BullMQ and webhook queue"
  engine                     = "redis"
  engine_version             = var.engine_version
  node_type                  = var.node_type
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.auth_token
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [var.security_group_id]
  parameter_group_name       = "default.redis7"
  apply_immediately          = true
  snapshot_retention_limit   = 1

  tags = merge(var.tags, { Name = "${var.name}-redis" })
}

output "primary_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  value = aws_elasticache_replication_group.this.port
}
