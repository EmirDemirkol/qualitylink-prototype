#!/usr/bin/env bash
# Wipes the demo data and reloads the sample batches and demo accounts.
# Run before every demo so the story starts from the same place:
#   ./scripts/reset-demo.sh
set -euo pipefail
REGION="eu-west-1"
SEED_FN=$(aws cloudformation describe-stacks --region "$REGION" --stack-name qualitylink \
  --query "Stacks[0].Outputs[?OutputKey=='SeedFunctionName'].OutputValue" --output text)
aws lambda invoke --region "$REGION" --function-name "$SEED_FN" --payload '{}' \
  --cli-binary-format raw-in-base64-out /tmp/seed.json >/dev/null
cat /tmp/seed.json; echo
echo "Demo data reset."
