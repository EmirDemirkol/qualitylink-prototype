# QualityLink End-to-End Test Checklist

Date: 22 November 2026 
Tester: Aston Tellis  
Live URL: https://d2gnxounew3gia.cloudfront.net

## Operator — operator.kelly

| Test | Expected Result | Result | Notes |
|---|---|---|---|
| Open batch B-24121 | Batch opens successfully | PASS | B-24121 opened successfully in production state and displayed inspection options and specification QS-115 rev A. |
| Enter reading outside limits | Reading is recorded as Fail against the specification limits | PASS | Entered Actuation force 9.5 N against the allowed 5.0–8.0 N range; QualityLink correctly marked it as out of specification. |
| Failed reading places batch On Hold | Batch status changes to On Hold | PASS | Saving the 9.5 N failed reading automatically placed B-24121 On Hold and blocked further recording. |
| Failed reading creates deviation | New deviation opens automatically | PASS | Failed reading automatically created deviation DEV-428C and displayed that the quality engineer was alerted. |
| Operator access control | No batch release button is available | PASS | Operator page shows inspection batches and gateway status only; no release control is available. |

## Engineer — engineer.murphy

| Test | Expected Result | Result | Notes |
|---|---|---|---|
| Open deviation for B-24121 | Deviation is visible | PASS | DEV-428C was visible for B-24121 and showed the failed 9.5 N actuation-force reading. |
| Add reason | Reason is saved | PASS | Investigation notes, root cause and reason for change were saved; DEV-428C moved from Open to Under investigation. |
| Close deviation as Accept | Deviation closes successfully | PASS | DEV-428C closed successfully with Accept outcome; screen confirmed "batch acceptable, hold cleared" and recorded A. Murphy as the closer. |
| Dashboard tab | Dashboard loads and displays KPIs | PASS | Dashboard loads successfully and displays live KPIs including batches on hold, open deviations, first-pass yield and average time to release. |

## QA — qa.walsh

| Test | Expected Result | Result | Notes |
|---|---|---|---|
| Open QA-ready batch B-24109 | Batch is visible for QA review | PASS | B-24109 appeared in Ready for review and all four release checks passed. |
| Release while deviation is open | Release must be blocked | PASS | B-24117 remained blocked because 1 deviation was still open; the Sign and release button was disabled until all release checks passed. |
| Release eligible batch B-24109 | Release is allowed | PASS | B-24109 was successfully signed and released by C. Walsh and moved to Recently released. Certificate CoC-B-24109 was generated. |
| E-signature | Password is requested again before release | PASS | QA had to re-enter the shared demo password before signing. The release was recorded with signer C. Walsh, signature meaning "Approved for release", and timestamp. |
| Dashboard tab | Dashboard loads and displays KPIs | PASS | QA Dashboard loaded successfully and displayed live KPIs including batches on hold, open deviations, first-pass yield, average time to release, batch status counts and recent failed results. |

## Client — client.larsen

| Test | Expected Result | Result | Notes |
|---|---|---|---|
| View batches | Only Halden Pharma batches are visible | PASS | Portal displays Halden Pharma batches only. |
| Access B-24125 | B-24125 must NOT be visible | PASS | B-24125 is not visible to the Halden Pharma client. |
| Released batch certificate | Certificate can be downloaded | PASS | CoC for released batch B-24098 opens correctly and can be saved as a PDF. |

## Audit Trail

| Test | Expected Result | Result | Notes |
|---|---|---|---|
| Operator action logged | User, time and action are recorded | PASS | Audit trail recorded S. Kelly at 12:59 entering Actuation force 9.5 N for B-24121 as FAIL, opening DEV-428C automatically and changing the batch from IN_PRODUCTION to ON_HOLD. |
| Engineer action logged | User, time and action are recorded | PASS | Audit trail recorded A. Murphy starting the DEV-428C investigation at 13:07 and closing it as batch acceptable at 13:08, including the logged reasons for change. |
| QA release logged | User, time and action are recorded | PASS | Audit trail recorded C. Walsh releasing B-24109 with an e-signature at 13:16, meaning "Approved for release", and generating certificate CoC-B-24109. |
| Client/certificate action logged where applicable | Relevant action is recorded | PASS | Audit trail recorded M. Larsen downloading the B-24098 certificate from the client portal at 12:51. |

## Overall Result

Overall status: PASS  
Jira defects created: None  
Additional notes: Full end-to-end workflow tested successfully on the live CloudFront deployment. Demo data was reset before testing by the team lead. The workflow covered operator inspection, automatic hold/deviation creation, engineer investigation and closure, QA release with password re-authentication, client access isolation, certificate download, live dashboards and audit logging.
