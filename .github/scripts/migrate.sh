#!/usr/bin/env bash
set -Eeuo pipefail

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

required ECS_CLUSTER
required MIGRATION_TASK_DEFINITION
required CONTAINER_IMAGE
required ECS_SUBNETS
required ECS_SECURITY_GROUPS

current_definition="$(aws ecs describe-task-definition \
  --task-definition "$MIGRATION_TASK_DEFINITION" \
  --query 'taskDefinition' \
  --output json)"

new_definition="$(jq --arg image "$CONTAINER_IMAGE" \
  '.containerDefinitions[0].image = $image
   | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)' \
  <<<"$current_definition")"

task_definition="$(aws ecs register-task-definition \
  --cli-input-json "$new_definition" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)"

echo "Running database migrations with ${task_definition}"
task_arn="$(aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$task_definition" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${ECS_SUBNETS}],securityGroups=[${ECS_SECURITY_GROUPS}],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' \
  --output text)"

if [[ -z "$task_arn" || "$task_arn" == "None" ]]; then
  echo "Failed to start the migration task" >&2
  exit 1
fi

aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$task_arn"
description="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn")"
exit_code="$(jq -r '.tasks[0].containers[0].exitCode // "missing"' <<<"$description")"
stopped_reason="$(jq -r '.tasks[0].stoppedReason // ""' <<<"$description")"
echo "Migration task stopped: exitCode=${exit_code} reason=${stopped_reason}"
if [[ "$exit_code" != "0" ]]; then
  echo "Database migration failed" >&2
  exit 1
fi
