# Demo script (5 minutes)

Group demonstration for the Part 3 assessment. The examiner gives about 5 minutes for the demo, then about 10 minutes of individual questions.

**Live prototype:** https://d2gnxounew3gia.cloudfront.net
**Password for every demo account:** `Nuvola-Demo-2026` (the sign-in page also has one-click buttons)

## Before the session

- [ ] Run `bash scripts/reset-demo.sh` in CloudShell so every batch starts in the same state
- [ ] Open the live URL and check sign-in works
- [ ] Make sure the line terminal shows **Online** (if it was left offline, click it once)
- [ ] Have the architecture diagram open in a second tab (`QL_Architecture_Draft2.drawio.png`)
- [ ] Have the GitHub repo and Jira board open in case the examiner asks
- [ ] Backup: if the live site is down, run `pip install boto3 "moto[dynamodb,cognitoidp]"` then `python tests/local_server.py` and demo on http://localhost:8765 (test this on the laptop beforehand)

## Timing

| Time | Part | What the examiner sees |
|---|---|---|
| 0:00 to 0:30 | 1. Problem and solution | Sign-in page |
| 0:30 to 1:30 | 2. Line operator + offline gateway | B-24121 recorded, outage, sync, automatic hold |
| 1:30 to 2:15 | 3. Quality engineer | DEV-0412 investigated and closed |
| 2:15 to 3:00 | 4. QA approver | Release checks, wrong password refused, e-signature |
| 3:00 to 3:30 | 5. Client portal + audit trail | Halden sees only its batches, certificate, audit log |
| 3:30 to 5:00 | 6. Architecture and deployment | Diagram, built vs proposed, how it's deployed |

## 1. Problem and solution (30 s)

Say:
- Meridian Medical Components makes inhaler parts for Halden Pharma. Today inspections are on paper and spreadsheets, gauge readings are copied by hand, QA signs batch records by hand and holds are typed into the ERP manually.
- That means a bad batch can slip through and audits are slow and risky under GMP and 21 CFR Part 11.
- QualityLink records every inspection, puts failing batches on hold automatically, and only lets QA release a batch with an electronic signature once every check passes.

## 2. Line operator and offline gateway (60 s)

1. Sign in as **operator.kelly**.
2. Select batch **B-24121** (Dose counter DC-115, spec QS-115 rev A). Visual has already been recorded.
3. Choose **Actuation force**, type **6.4** (limit 5.0 to 8.0 N). The badge turns green. Click **Save result**.
   - Say: the reading is checked against the approved spec automatically, the operator never decides pass or fail.
4. Click the green **Online** button to simulate an internet outage.
5. Choose **Window height**, type **5.18** (limit 4.90 to 5.10 mm). Click **Save result**. It fails and the reading is stored on the gateway, shown as waiting to sync.
   - Say: in the real design this is the Greengrass gateway on the factory floor. Here the browser plays the gateway, so the line keeps working when the internet drops (QR04).
6. Click the **Offline** button to go back online. The reading syncs to AWS with its original time.
7. Point out that B-24121 is now **on hold** and a deviation was opened automatically. Sign out.

## 3. Quality engineer (45 s)

1. Sign in as **engineer.murphy**. Open **Deviations** and select **DEV-0412** (B-24117, cap-fit force 23.6 N against a 22.0 N limit).
2. Type a reason for change, e.g. `Starting investigation`, and click **Start investigation**.
3. Fill in:
   - Investigation notes: `Retained parts re-measured on a calibrated gauge, all within spec`
   - Root cause: `Gauge G-07 reading high, calibration drift`
   - Outcome: **Batch acceptable: no impact on product quality**
   - Reason for change: `Investigation complete`
4. Click **Close deviation**. The hold on B-24117 is cleared and it moves to ready for review.
   - Say: every edit needs a reason for change and goes into the audit trail. A deviation can't be closed without a root cause.
5. Sign out.

## 4. QA approver (45 s)

1. Sign in as **qa.walsh**. Open the **Release queue** and select **B-24117**.
2. Show the release checks are all green, including **Independent reviewer** (the approver didn't record any results for this batch).
3. Enter a **wrong password** and click **Sign and release**. It's refused and logged.
4. Enter `Nuvola-Demo-2026` and sign. B-24117 is **Released** and certificate CoC-B-24117 is generated.
   - Say: re-entering the password at the moment of signing is the e-signature rule from 21 CFR Part 11. Only the release module can set a batch to released, and the database write is conditional, so two approvers can't release it twice.
5. Sign out.

## 5. Client portal and audit trail (30 s)

1. Sign in as **client.larsen** (Halden Pharma).
2. Show only Halden's batches are listed. B-24125 belongs to another client (Orion Respiratory) and doesn't appear.
3. Click **Download CoC** on B-24117, which was just released.
4. If there's time: sign in as engineer or QA, open **Audit trail** and show the B-24117 entries, including the failed signature attempt.

## 6. Architecture and deployment (90 s)

Show the architecture diagram, then say:

- **Built and live on AWS (eu-north-1, Stockholm):** CloudFront serving a private S3 bucket, Cognito sign-in with four role groups, API Gateway with a JWT authorizer, five Lambda modules in Python, each with its own least-privilege IAM role, and four DynamoDB tables.
- **Simulated:** the on-site gateway (browser cache and offline queue instead of Greengrass and IoT Core).
- **Design only (Part 2):** RDS PostgreSQL Multi-AZ, ERP link over SQS and VPN, SNS alerts, EventBridge, S3 Object Lock audit archive, Frankfurt disaster recovery, WAF and GuardDuty.
- **Deployment:** everything is in one CloudFormation/SAM template (`template.yaml`). `scripts/deploy.sh` packages the Lambdas, deploys the stack, uploads the site and refreshes CloudFront from AWS CloudShell. A fresh deploy takes about 5 minutes.
- **Cost:** it runs inside the AWS Free plan, so effectively $0 a month, against about $580 a month for the Part 2 production design. See `docs/infrastructure.md`.

## If something goes wrong

| Problem | What to do |
|---|---|
| Batch not in the state the script expects | Run `bash scripts/reset-demo.sh` and start again |
| Sync says rejected | The batch was released or rejected before the reading synced. Reset and repeat |
| Live site not loading | Switch to the local server (`python tests/local_server.py`) and say the same thing runs on AWS |
| Sign-in fails | Use the one-click demo buttons on the sign-in page |
