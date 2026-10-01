---
name: cloud-iac-guardrails
description: Use when working with cloud infrastructure (GCP, AWS, Azure) or Infrastructure-as-Code (Terraform, CloudFormation, Pulumi, Bicep). Triggers on gcloud, aws, az, terraform, cloudformation, pulumi, bicep commands, or any request to modify firewall rules, VPC/subnets, IAM bindings, service accounts, Cloud Run, GKE, load balancers, DNS records, Cloud Functions, secrets in Secret Manager, IAP configs, monitoring/alerting policies, or any cloud resource the project manages via IaC.
---

# Cloud Infrastructure Guardrails (GCP / AWS / Azure)

- **Never run state-changing cloud CLI commands directly.** Do not propose or run `gcloud * create / update / delete / set` (or the AWS / Azure equivalents) for any resource the project manages via Infrastructure-as-Code (Terraform, CloudFormation, Pulumi, Bicep, etc.). Out-of-band changes get reverted on the next IaC apply, cause silent drift between code and reality, and bypass code review and audit trails.
- **The default response to any infra change request is: open a PR against the IaC repo.** Find the right module/folder, write the change in code, branch, push, open a PR. Wait for CI's plan, get review, merge — then the change applies.
- **Read-only cloud commands are fine.** `describe`, `list`, `get`, `print-access-token`, IAP tunnel `start-iap-tunnel`, etc. — these don't change state. Use them freely for diagnosis.
- **If you find a manual change already exists in the cloud that disagrees with IaC, surface it.** Don't paper over drift; tell the user the rule says X, the cloud says Y, and propose codifying reality (or fixing reality to match code) via a PR.
- **Emergency exception:** if the user explicitly says "I know, just do it now via gcloud, we'll codify later," fine — but state in your reply that this creates drift and remind them to open the codification PR. Never make the call yourself.
- **Applies to:** firewall rules, VPC/subnets, IAM bindings, service accounts, Cloud Run services, GKE configs, load balancers, DNS records, Cloud Functions, secrets in Secret Manager, IAP configs, monitoring/alerting policies — anything that lives in the cloud account.
