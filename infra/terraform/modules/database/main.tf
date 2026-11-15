variable "name" {
  type        = string
  description = "Prefix for database resources."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for the database subnet group."
}

variable "security_group_id" {
  type        = string
  description = "Security group that allows application access."
}

variable "instance_class" {
  type        = string
  description = "RDS instance class."
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  type        = number
  description = "Allocated storage in GiB."
  default     = 20
}

variable "max_allocated_storage" {
  type        = number
  description = "Upper storage autoscaling limit in GiB."
  default     = 100
}

variable "database_name" {
  type        = string
  description = "Initial database name."
  default     = "docuflow"
}

variable "master_username" {
  type        = string
  description = "Database master username."
  default     = "docuflow"
}

variable "master_password" {
  type        = string
  description = "Database master password."
  sensitive   = true
}

variable "engine_version" {
  type        = string
  description = "PostgreSQL engine version."
  default     = "16"
}

variable "multi_az" {
  type        = bool
  description = "Enable a standby database instance."
  default     = false
}

variable "backup_retention_period" {
  type        = number
  description = "Number of days to retain automated backups."
  default     = 7
}

variable "deletion_protection" {
  type        = bool
  description = "Protect the database from deletion."
  default     = true
}

variable "skip_final_snapshot" {
  type        = bool
  description = "Skip the final snapshot when destroying the database."
  default     = false
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to resources."
  default     = {}
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-database"
  subnet_ids = var.private_subnet_ids

  tags = merge(var.tags, { Name = "${var.name}-database" })
}

resource "aws_db_instance" "this" {
  identifier                      = "${var.name}-postgres"
  engine                          = "postgres"
  engine_version                  = var.engine_version
  instance_class                  = var.instance_class
  allocated_storage               = var.allocated_storage
  max_allocated_storage           = var.max_allocated_storage
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_name                         = var.database_name
  username                        = var.master_username
  password                        = var.master_password
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [var.security_group_id]
  publicly_accessible             = false
  multi_az                        = var.multi_az
  backup_retention_period         = var.backup_retention_period
  backup_window                   = "03:00-04:00"
  maintenance_window              = "sun:04:00-sun:05:00"
  auto_minor_version_upgrade      = true
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = var.skip_final_snapshot
  final_snapshot_identifier       = var.skip_final_snapshot ? null : "${var.name}-postgres-final"
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = true

  tags = merge(var.tags, { Name = "${var.name}-postgres" })
}

output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "database_name" {
  value = aws_db_instance.this.db_name
}

output "master_username" {
  value = aws_db_instance.this.username
}
