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
required CONTAINER_IMAGE_PREFIX
required IMAGE_TAG
required HEALTH_CHECK_URL

services=(api worker web)
declare -A previous_task_definitions=()
declare -A service_names=(
  [api]="${API_SERVICE_NAME:-docuflow-api}"
  [worker]="${WORKER_SERVICE_NAME:-docuflow-worker}"
  [web]="${WEB_SERVICE_NAME:-docuflow-web}"
)
rollback_needed=0

rollback() {
  local status=$?
  if [[ $status -eq 0 || $rollback_needed -eq 0 ]]; then
    exit $status
  fi
  echo "Deployment failed; rolling back ECS services" >&2
  for service in api worker web; do
    local previous="${previous_task_definitions[$service]:-}"
    if [[ -n "$previous" ]]; then
      echo "Rolling back ${service_names[$service]} to ${previous}" >&2
      aws ecs update-service \
        --cluster "$ECS_CLUSTER" \
        --service "${service_names[$service]}" \
        --task-definition "$previous" >/dev/null || true
    fi
  done
  for service in api worker web; do
    aws ecs wait services-stable \
      --cluster "$ECS_CLUSTER" \
      --services "${service_names[$service]}" || true
  done
  exit $status
}
trap rollback EXIT

for service in "${services[@]}"; do
  previous_task_definitions[$service]="$(aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "${service_names[$service]}" \
    --query 'services[0].taskDefinition' \
    --output text)"
  if [[ -z "${previous_task_definitions[$service]}" || "${previous_task_definitions[$service]}" == "None" ]]; then
    echo "Unable to read the current task definition for ${service_names[$service]}" >&2
    exit 1
  fi
done

# From this point on a failure must trigger rollback.
rollback_needed=1

for service in "${services[@]}"; do
  previous="${previous_task_definitions[$service]}"
  image="${CONTAINER_IMAGE_PREFIX}/${service}:${IMAGE_TAG}"
  echo "Deploying ${service_names[$service]} with ${image}"
  definition="$(aws ecs describe-task-definition \
    --task-definition "$previous" \
    --query 'taskDefinition' \
    --output json)"
  updated="$(jq --arg image "$image" \
    '.containerDefinitions[0].image = $image
     | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)' \
    <<<"$definition")"
  task_definition="$(aws ecs register-task-definition \
    --cli-input-json "$updated" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "${service_names[$service]}" \
    --task-definition "$task_definition" >/dev/null
done

for service in "${services[@]}"; do
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "${service_names[$service]}"
done

echo "Verifying health at ${HEALTH_CHECK_URL}"
for attempt in $(seq 1 12); do
  if curl --fail --silent --show-error --max-time 10 "$HEALTH_CHECK_URL" >/dev/null; then
    echo "Health check passed"
    rollback_needed=0
    exit 0
  fi
  echo "Health check attempt ${attempt} failed; retrying" >&2
  sleep 5
done

echo "Health check did not pass" >&2
exit 1
