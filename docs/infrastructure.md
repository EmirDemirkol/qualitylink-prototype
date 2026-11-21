# Infrastructure and cost comparison

How the QualityLink prototype is hosted, what it costs, and how that compares with the production design in Part 2 (Section 4, Infrastructure & Software Requirements).

All figures come from `template.yaml` and the Part 2 report. Prices are in USD, as in Part 2.

## 1. What the prototype runs on

| Layer | AWS service | Configuration (from `template.yaml`) | Why |
|---|---|---|---|
| Front end | S3 + CloudFront | Private bucket, AES-256 encryption, all public access blocked. Only CloudFront can read it (Origin Access Control). HTTPS only, managed security headers, `PriceClass_100` (edge locations in Europe and North America only, the cheapest option) | Static site, no web server to run or patch |
| Identity | Cognito user pool | 4 groups: operator, engineer, qa, client. No self sign-up, 12-character password policy, 60-minute tokens | Role-based access (FR08) |
| API | API Gateway HTTP API | JWT authorizer on every route, CORS only for our CloudFront domain, throttling at 10 requests/s (burst 20) | One controlled entry point to the backend |
| Compute | Lambda | 6 functions, Python 3.12 on arm64 (Graviton), 256 MB, 10 s timeout. 5 are API modules, 1 is the seed function (admin only, no API route) | Scales to zero when nobody is using it |
| Data | DynamoDB | 4 tables (Batches, Readings, Deviations, Audit), provisioned at 5 read + 5 write units each | 20 of the 25 always-free units, serverless, no database server |
| Logs | CloudWatch Logs | Lambda logs | Debugging. The browser only gets a short error message, never a stack trace |
| Deployment | CloudFormation / SAM | Whole stack in `template.yaml`, deployed by `scripts/deploy.sh` from AWS CloudShell | Rebuildable from scratch in about 5 minutes |

**Region:** eu-north-1 (Stockholm). Part 2 designs for eu-west-1 (Ireland), but our AWS Free plan account only allowed Stockholm. It's still in the EU, so GDPR data residency holds. Moving to Ireland means changing `REGION` in `scripts/deploy.sh` and `scripts/reset-demo.sh`.

### Lambda modules compared with Part 2

| Part 2 module | Prototype |
|---|---|
| Inspection, Specification Check, Hold/Alerts | One function: `inspection.py` |
| Deviations | `deviations.py` |
| Batch Release (+ e-signature) | `release.py`, the only code that can set a batch to Released |
| Audit Trail | `audit_trail.py`, read only |
| Client Portal | `batches.py`, clients only get their own batches |
| Authentication | Cognito directly, no Lambda needed |
| Integration (ERP) | Not built |

Each function has its own IAM role with only the permissions it needs. For example, the audit function can only read the Audit table, and no API function can edit or delete audit entries.

## 2. What the prototype costs

Monthly cost at demo and testing usage:

| Service | Free allowance | Our usage | Cost |
|---|---|---|---|
| Lambda | Always free: 1M requests and 400,000 GB-seconds a month | A few thousand requests | $0 |
| DynamoDB | Always free: 25 GB storage, 25 read and 25 write units | 20 read + 20 write units, under 1 MB of data | $0 |
| Cognito | Always free: 10,000 monthly active users | 4 demo users | $0 |
| CloudFront | Always free: 1 TB data out, 10M requests a month | A small static site | $0 |
| CloudWatch Logs | Always free: 5 GB of logs a month | Lambda logs | $0 |
| API Gateway (HTTP API) | Not always free, comes out of the Free plan credits | A few thousand calls, priced at around $1 per million | Under $0.01 |
| S3 | Not always free, comes out of the Free plan credits | Website files and Lambda packages, a few MB | Under $0.01 |
| CloudFormation | No charge for AWS resources | 1 stack | $0 |
| **Total** | | | **About $0** |

Nothing is billed. The few cents for API Gateway and S3 come out of the $100 credit the Free plan gives every new account, and a budget alert is set on the account (QL-23).

## 3. Prototype vs the Part 2 production design

Part 2 estimated the production baseline at **about $580 a month** (Section 4.2).

| Part 2 item | Part 2 cost / month | Prototype | Why it's different |
|---|---|---|---|
| RDS PostgreSQL db.m6g.large Multi-AZ, 100 GB, RDS Proxy | $306 | DynamoDB, 4 tables | RDS has no always-free tier, and the Part 2 Multi-AZ setup is the single biggest cost. DynamoDB is serverless and free at this size. Production keeps RDS because batch, reading and deviation records are relational and need SQL constraints and joins |
| Frankfurt pilot-light replica (disaster recovery) | $152 | Not built | A second region is design only |
| Site-to-Site VPN + VPC endpoints | $117 | Not built | No ERP link and no VPC. The Lambdas reach DynamoDB through AWS's HTTPS endpoints |
| Lambda, S3, IoT Core | Under $5 | Lambda + S3, no IoT Core | The gateway is simulated in the browser (`frontend/js/gateway.js`) |
| Front door, security, monitoring (Route 53, WAF + Shield, CloudTrail, GuardDuty, Security Hub, Config, Backup) | Extra on top | CloudFront, API Gateway throttling, Cognito, budget alert | WAF, GuardDuty and the rest are design only. Against floods we rely on API throttling and the Shield Standard DDoS protection that comes free with CloudFront |
| On-site hardware (gateway PC + spare, line terminals) | One-off hardware, not cloud | The browser plays the gateway and the terminal | No real edge hardware in a prototype |
| **Total** | **About $580** | **About $0** | |

**The main point:** the gap is almost all always-on data, disaster recovery and networking, not compute. At the Part 2 production load (about 0.7M Lambda invocations a month at 512 MB and 0.3 s, so about 105,000 GB-seconds), Lambda would still sit inside the always-free 1M requests and 400,000 GB-seconds. The serverless compute choice from Part 2 is what keeps that part cheap.

## 4. Would the prototype handle production load?

**Normal load: yes.** Part 2 sizes QualityLink at 240 readings an hour, about one every 15 seconds. Each reading writes to the Readings and Audit tables (plus Batches when the status changes), far below 5 write units per table.

**After an 8-hour outage: only just.** The gateway would have about 1,920 readings to sync. The browser sends them one at a time, and the API allows 10 requests a second. At around 5 readings a second, the Readings and Audit tables each take about 5 writes a second, right at their 5-unit limit. DynamoDB's burst capacity absorbs short spikes, and the AWS SDK retries throttled writes. If a request still fails, the gateway keeps that reading queued and sends it on the next sync, so nothing is lost, it just drains slower. In production we'd use on-demand capacity or auto scaling, or follow Part 2: RDS behind RDS Proxy with capped Lambda concurrency.

**Lists use scans.** `GET /batches` and `GET /deviations` scan the whole table. That's fine for 5 sample batches, but production would need indexes (for example by status or client).

## 5. Limitations

- Demo passwords are shared and public. Production uses company SSO + MFA.
- No WAF (only API throttling and CloudFront's free Shield Standard), no custom domain (the site uses the default `cloudfront.net` address) and no point-in-time recovery on the tables.
- Single region, so no disaster recovery.
- The AWS Free plan lasts up to 6 months or until the credits are used. After that, the account has to move to a paid plan to keep the prototype online.

## References

- Group Nuvola (2026) *QualityLink System Design Report, Project Part II*, Section 4.
- Amazon Web Services (2026) *Explore AWS services with AWS Free Tier*. https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html
- Amazon Web Services (2026) *AWS Free Tier*. https://aws.amazon.com/free/
