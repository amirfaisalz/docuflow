variable "name" {
  type        = string
  description = "Prefix for secret names."
}

variable "values" {
  type        = map(string)
  description = "Secret name to plaintext value."
  sensitive   = true
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to resources."
  default     = {}
}

resource "aws_secretsmanager_secret" "this" {
  for_each = toset(nonsensitive(keys(var.values)))

  name = "${var.name}/${each.key}"
  # Secrets are recreated when Terraform state is intentionally rebuilt.
  recovery_window_in_days = 7

  tags = merge(var.tags, { Name = "${var.name}-${each.key}" })
}

resource "aws_secretsmanager_secret_version" "this" {
  for_each = toset(nonsensitive(keys(var.values)))

  secret_id     = aws_secretsmanager_secret.this[each.key].id
  secret_string = var.values[each.key]
}

output "arns" {
  value = { for name, secret in aws_secretsmanager_secret.this : name => secret.arn }
}
