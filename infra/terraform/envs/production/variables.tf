variable "aws_region" {
  type        = string
  description = "AWS region for the deployment."
  default     = "ap-southeast-1"
}

variable "project_name" {
  type        = string
  description = "Project prefix used for AWS resources."
  default     = "docuflow"
}

variable "image_tag" {
  type        = string
  description = "Container image tag to deploy (normally the Git commit SHA)."
  default     = "latest"
}

variable "certificate_arn" {
  type        = string
  description = "Optional ACM certificate ARN for HTTPS."
  default     = null
}

variable "api_host" {
  type        = string
  description = "DNS host routed to the API service."
  default     = "api.docuflow.example.com"
}

variable "gemini_api_key" {
  type        = string
  description = "Gemini API key."
  sensitive   = true
}

variable "cloudinary_cloud_name" {
  type        = string
  description = "Cloudinary cloud name."
  sensitive   = true
}

variable "cloudinary_api_key" {
  type        = string
  description = "Cloudinary API key."
  sensitive   = true
}

variable "cloudinary_api_secret" {
  type        = string
  description = "Cloudinary API secret."
  sensitive   = true
}

variable "database_instance_class" {
  type        = string
  description = "RDS instance class."
  default     = "db.t4g.micro"
}

variable "database_multi_az" {
  type        = bool
  description = "Enable a multi-AZ RDS deployment."
  default     = false
}

variable "database_deletion_protection" {
  type        = bool
  description = "Protect the production database from deletion."
  default     = true
}

variable "cache_node_type" {
  type        = string
  description = "ElastiCache node type."
  default     = "cache.t4g.micro"
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "api_max_capacity" {
  type    = number
  default = 4
}

variable "worker_cpu" {
  type    = number
  default = 1024
}

variable "worker_memory" {
  type    = number
  default = 2048
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "worker_max_capacity" {
  type    = number
  default = 4
}

variable "worker_concurrency" {
  type    = number
  default = 2
}

variable "web_cpu" {
  type    = number
  default = 256
}

variable "web_memory" {
  type    = number
  default = 512
}

variable "web_desired_count" {
  type    = number
  default = 1
}

variable "web_max_capacity" {
  type    = number
  default = 3
}
