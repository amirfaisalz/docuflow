output "load_balancer_dns" {
  value = module.alb.dns_name
}

output "api_url" {
  value = local.api_public_url
}

output "documents_bucket" {
  value = module.storage.documents_bucket_name
}

output "ecr_repositories" {
  value = module.storage.repository_urls
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_names" {
  value = {
    api    = module.api_service.service_name
    worker = module.worker_service.service_name
    web    = module.web_service.service_name
  }
}

output "migration_task_definition_arn" {
  value = aws_ecs_task_definition.migrate.arn
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "application_security_group_id" {
  value = module.network.application_security_group_id
}
