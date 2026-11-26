# Case statuses by assessment flow (for renaming)

Status code = `MsmeCertifications.CertificationStatus`. Two names are in use today:

- **Legacy name**: shown on Registered MSMEs and in the Excel reports. It comes from the old procedures (`SP_DASHBOARD_REGISTERED_MSME`, report procedures).
- **V4 name**: shown in Monitoring, Admin → TAT and the delay checks (`Staff/Tat/TatCatalog.cs`).

Fill the **New name** column with the wording you want. One name per code and flow is enough: where a flow does not use a code, it is marked "—".

## ZED Certification (main portal)

The Admin chooses the flow per level in Administration → Certification Levels: Desktop only, Desktop + Onsite, Desktop + Remote, Remote only, Onsite only.

| Code | Legacy name | V4 name | Desktop only | Desktop + Onsite / Desktop + Remote | Remote only / Onsite only | New name |
|---|---|---|---|---|---|---|
| (no payment) | Payment Pending By MSME | — | yes | yes | yes | |
| 1 | Payment done By MSME | Payment done, documents pending | yes | yes | yes | |
| 2 | Evidence upload done by MSME | Desktop assessment scheduled, not started | yes | yes | for a moment only: allotted to the agency, then 6 | |
| 3 | DA Verification in progress | Desktop assessment in progress | yes | yes | — | |
| 4 | DA Verification done with errors | Desktop assessment non-conformance | yes | yes | — | |
| 5 | DA Verification done without errors | Desktop assessment quality check | yes | yes | — | |
| 6 | Agency Final submit done for DA | Desktop assessment completed | **Certified** (with its desktop certificate number) | Desktop done, waiting for the site/remote assessor allotment | **No desktop step**: allotted to the agency, site / remote assessor to be allotted (since 2026-11-26 the portal shows "Allotted to agency · site assessor to be allotted (Onsite only)") | |
| 7 | Failed in NC | Desktop assessment rejected | yes | yes | — | |
| 8 | SA Allocation Done | Site assessment scheduled, not started | — | yes | yes | |
| 9 | SA is ready to start | Parameters distributed (site assessment in progress) | — | yes | yes | |
| 13 | SA Verification in progress | Assessment submitted through mobile app | — | yes | yes | |
| 14 | SA Verification done with errors | Site assessment non-conformance | — | yes | yes | |
| 15 | SA verification done without errors | Site assessment quality check | — | yes | yes | |
| 16 | Agency Final submit for SA | Certified | — | yes | yes | |
| 17 | (none) | Site assessment rejected | — | yes | yes | |
| 99 | (none) | Rejected | yes | yes | yes | |

Codes 10, 11 and 12 are not used.

Milestones of a case's history (no status code; used by TAT and Monitoring): Registration (application received), Basic information and documents submitted, Allotted to the assessment agency, Opening meeting conducted, First non-conformance raised, Non-conformances closed.

## Surveillance

| Code | V4 name | New name |
|---|---|---|
| 1 | Desktop assessment scheduled, not started | |
| 2 | Desktop assessment started | |
| 3 | Desktop assessment in progress | |
| 4 | Desktop assessment non-conformance | |
| 5 | Desktop assessment quality check | |
| 6 | Desktop assessment completed | |
| 7 | Desktop assessment rejected | |
| 8 | Site assessment scheduled, not started | |
| 9 | Parameters distributed (site assessment in progress) | |
| 13 | Assessment submitted through mobile app | |
| 14 | Site assessment non-conformance | |
| 15 | Site assessment quality check | |
| 16 | Surveillance completed | |
| 17 | Site assessment rejected | |
| 99 | Rejected | |

Bronze surveillance is done in the ZED assessor app (Remote or Onsite per the level's surveillance mode).

## Handholding (Consultancy), per milestone

| Code | V4 name | New name |
|---|---|---|
| 1 | Milestone payment done | |
| 8 | Allotted to the consulting organisation | |
| 9 | Consultants allotted | |
| 13 | Submitted by the consultant (closing meeting done) | |
| 15 | Quality check by the consulting organisation | |
| 16 | Milestone completed | |
| 100 | Deliverables accepted by the MSME | |
| 99 | Milestone rejected | |

Milestones: Opening meeting conducted, Baseline diagnostic study scheduled, Handholding action plan scheduled.
