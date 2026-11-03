# Handoff: bookit-app.com AWS Migration & `/support` Contact Form

Date: 2026-11-03 · Repo: `bookitapp-aicha/bookitapp-aicha.github.io` (branch `main`) · Local path: `/Users/hisham/Documents/GitHub/bookitapp-aicha.github.io`

## Status: COMPLETED & LIVE ON AWS

1. **Bug 1 (FIXED):** The "give us a bit more detail" field was `<input type="email" required>`, demanding an `@`. Converted to `<textarea name="Details" required>`.
2. **Bug 2 (FIXED):** Replaced the broken Webflow form handler and stale Cloudflare Turnstile DOM snapshots on `support.html`, `support-ar.html`, `support.htm`, and `support-ar.htm` with a custom PHP backend (`/support-submit.php`) delivering formatted HTML + plain-text emails via Brevo (`https://api.brevo.com/v3/smtp/email`) to `go@bookit-app.com`. Also merged `FirstName` and `LastName` into the main `<form>` and gave all 5 checkboxes unique IDs and distinct `HelpTopics[]` values.
3. **AWS Migration & Route 53 Cutover (COMPLETED):**
   - **CloudFormation Stack:** `bookit-website-prod` (`eu-north-1`), defined in `infra/bookit-website-stack.yaml`.
   - **Compute Origin:** `i-0f157a9bdf9f6d010` (`t4g.micro`, Amazon Linux 2023 ARM64, Nginx + PHP-FPM 8.5, Elastic IP `13.63.250.127`, origin DNS `origin-web.bookit-app.com`).
   - **Security:** Origin Security Group (`WebsiteOriginSecurityGroup`) allows TCP 80 strictly from the AWS-managed CloudFront origin-facing prefix list (`pl-fab65393`). No SSH port 22 is open; management is 100% via AWS Systems Manager (SSM) Session Manager / Run Command with IMDSv2 enforced (`HttpTokens: required`).
   - **Secrets:** The EC2 instance fetches the Brevo API key from SSM Parameter Store (`/prod/brevo/api_key`) into `/etc/bookit/brevo_api_key` (`0640 root:nginx`).
   - **CDN & TLS:** CloudFront distribution `E38ZK10BJBZDJ0` (`d2ggfh871sd094.cloudfront.net`) with ACM wildcard certificate `arn:aws:acm:us-east-1:524522255968:certificate/755dff7e-7dc3-454b-816a-c1272b7224a2` and AWS-managed `SecurityHeadersPolicy`.
   - **Route 53 (`Z06421913CQ4E97W7RL5B`):** `bookit-app.com` and `www.bookit-app.com` (`A` and `AAAA` Alias records) now point to `d2ggfh871sd094.cloudfront.net`.

## Deploying Future Changes

Every push to `main` automatically deploys to AWS via GitHub Actions (`.github/workflows/deploy.yml`) using keyless OIDC authentication (`arn:aws:iam::524522255968:role/bookit-website-prod-github-deploy`).

You can also run the deployment script manually from the repository root:

```bash
./infra/deploy.sh
```

This packages the repository (excluding `.git`, `.github`, `infra/`, and internal `.md` files), uploads the release tarball to `s3://bookit-website-prod-artifacts-524522255968/releases/latest.tar.gz`, extracts it to `/var/www/bookit` on `i-0f157a9bdf9f6d010` via SSM Run Command, reloads Nginx + PHP-FPM, and invalidates CloudFront (`E38ZK10BJBZDJ0`).
