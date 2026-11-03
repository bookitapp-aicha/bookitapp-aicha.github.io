#!/usr/bin/env bash
set -euo pipefail

# Deploy Bookit Website + PHP Support Handler to AWS (EC2 + CloudFront in eu-north-1)
# Works both in GitHub Actions (via OIDC ambient credentials) and locally (via AWS_PROFILE).
STACK_NAME="${STACK_NAME:-bookit-website-prod}"
AWS_REGION="${AWS_REGION:-eu-north-1}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROFILE_ARGS=()
if [[ -z "${GITHUB_ACTIONS:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE="${AWS_PROFILE:-bookit}"
  PROFILE_ARGS=(--profile "${AWS_PROFILE}")
fi

echo "==> Resolving stack outputs for ${STACK_NAME} (${AWS_REGION})..."
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  "${PROFILE_ARGS[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" \
  --output text)

ARTIFACT_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  "${PROFILE_ARGS[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" \
  --output text)

CF_DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  "${PROFILE_ARGS[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)

echo "    Instance ID:       ${INSTANCE_ID}"
echo "    Artifact Bucket:   ${ARTIFACT_BUCKET}"
echo "    CloudFront Dist:   ${CF_DIST_ID}"

BUNDLE_PATH="/tmp/bookit-site-bundle.tar.gz"
echo "==> Packaging website bundle (${BUNDLE_PATH})..."
COPYFILE_DISABLE=1 tar -czf "${BUNDLE_PATH}" \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.DS_Store' \
  --exclude='infra' \
  --exclude='AGENTS.md' \
  --exclude='CLAUDE.md' \
  --exclude='HANDOFF-support-form.md' \
  --exclude='qa-specs/_build' \
  -C "${REPO_ROOT}" .

echo "==> Uploading bundle to s3://${ARTIFACT_BUCKET}/releases/latest.tar.gz..."
aws s3 cp "${BUNDLE_PATH}" "s3://${ARTIFACT_BUCKET}/releases/latest.tar.gz" \
  --region "${AWS_REGION}" \
  "${PROFILE_ARGS[@]}"

echo "==> Waiting for EC2 instance ${INSTANCE_ID} to be Online in SSM..."
for i in {1..30}; do
  PING_STATUS=$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=${INSTANCE_ID}" \
    --region "${AWS_REGION}" \
    "${PROFILE_ARGS[@]}" \
    --query "InstanceInformationList[0].PingStatus" \
    --output text 2>/dev/null || echo "None")
  if [[ "${PING_STATUS}" == "Online" ]]; then
    break
  fi
  sleep 5
done

echo "==> Deploying bundle to EC2 instance ${INSTANCE_ID} via SSM Run Command..."
CMD_ID=$(aws ssm send-command \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"set -euxo pipefail\",
    \"mkdir -p /var/www/bookit /tmp/bookit-release\",
    \"aws s3 cp s3://${ARTIFACT_BUCKET}/releases/latest.tar.gz /tmp/bookit-release/latest.tar.gz --region ${AWS_REGION}\",
    \"tar -xzf /tmp/bookit-release/latest.tar.gz -C /var/www/bookit\",
    \"chown -R nginx:nginx /var/www/bookit\",
    \"find /var/www/bookit -type d -exec chmod 0755 {} +\",
    \"find /var/www/bookit -type f -exec chmod 0644 {} +\",
    \"systemctl reload nginx php-fpm\"
  ]" \
  --region "${AWS_REGION}" \
  "${PROFILE_ARGS[@]}" \
  --query "Command.CommandId" \
  --output text)

echo "    Waiting for SSM command ${CMD_ID}..."
aws ssm wait command-executed \
  --command-id "${CMD_ID}" \
  --instance-id "${INSTANCE_ID}" \
  --region "${AWS_REGION}" \
  "${PROFILE_ARGS[@]}"

echo "==> Creating CloudFront cache invalidation on ${CF_DIST_ID}..."
aws cloudfront create-invalidation \
  --distribution-id "${CF_DIST_ID}" \
  --paths "/*" \
  "${PROFILE_ARGS[@]}" \
  --query "Invalidation.{Id:Id,Status:Status}"

echo "==> Deployment complete!"
