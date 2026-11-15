terraform {
  # Partial configuration. Supply values with `terraform init -backend-config=...`
  # or the TF_BACKEND_* variables used by the Terraform workflow.
  backend "s3" {}
}
