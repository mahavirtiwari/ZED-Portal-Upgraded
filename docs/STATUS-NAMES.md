# Case statuses by assessment flow (for renaming)

Status code = `MsmeCertifications.CertificationStatus`. Two names are in use today:

- **Legacy name**: shown on Registered MSMEs and in the Excel reports (the old procedures).
- **V4 name**: shown in Monitoring, Admin → TAT and the delay checks (`Staff/Tat/TatCatalog.cs`).

**Suggested name** is a proposal: one clear name per code and flow, saying what has happened and who acts next. Write your own wording in **Your name**, or leave it empty to accept the suggestion. The Word copy is `STATUS-NAMES.docx`.

## ZED Certification (main portal), per flow

The Admin chooses the flow per level in Administration → Certification Levels. Each table lists only the codes that flow uses. Codes 10, 11 and 12 are not used anywhere.

### Desktop only

_Certified at the desktop stage. NCs are raised at the desktop stage (code 4), in the rounds and days the Admin sets._

| Code | Legacy name | V4 name | Suggested name | Your name |
|---|---|---|---|---|
| (no payment) | Payment Pending By MSME | — | **Registered – fee payment pending** |  |
| 1 | Payment done By MSME | Payment done, documents pending | **Fee paid – documents to be submitted** |  |
| 2 | Evidence upload done by MSME | Desktop assessment scheduled, not started | **Documents submitted – desktop assessment not started** |  |
| 3 | DA Verification in progress | Desktop assessment in progress | **Desktop assessment in progress** |  |
| 4 | DA Verification done with errors | Desktop assessment non-conformance | **Desktop NC raised – awaiting MSME response** |  |
| 5 | DA Verification done without errors | Desktop assessment quality check | **Desktop assessment done – agency quality check** |  |
| 6 | Agency Final submit done for DA (with its desktop certificate number) | Desktop assessment completed | **Certified (desktop)** |  |
| 7 | Failed in NC | Desktop assessment rejected | **Rejected – desktop NCs not closed** |  |
| 99 | (none) | Rejected | **Rejected** |  |

### Desktop + Onsite

_No NC at the desktop stage: the desktop assessor's final submit goes straight to the agency's quality check (code 5). NCs are raised only at the onsite assessment (code 14). Codes 4 and 7 are not used._

| Code | Legacy name | V4 name | Suggested name | Your name |
|---|---|---|---|---|
| (no payment) | Payment Pending By MSME | — | **Registered – fee payment pending** |  |
| 1 | Payment done By MSME | Payment done, documents pending | **Fee paid – documents to be submitted** |  |
| 2 | Evidence upload done by MSME | Desktop assessment scheduled, not started | **Documents submitted – desktop assessment not started** |  |
| 3 | DA Verification in progress | Desktop assessment in progress | **Desktop assessment in progress** |  |
| 5 | DA Verification done without errors | Desktop assessment quality check | **Desktop assessment done – agency quality check** |  |
| 6 | Agency Final submit done for DA | Desktop assessment completed | **Desktop assessment approved – onsite assessor to be allotted** |  |
| 8 | SA Allocation Done | Site assessment scheduled, not started | **Onsite assessor allotted – onsite assessment scheduled** |  |
| 9 | SA is ready to start | Parameters distributed (site assessment in progress) | **Onsite assessment in progress** |  |
| 13 | SA Verification in progress | Assessment submitted through mobile app | **Onsite assessment submitted** |  |
| 14 | SA Verification done with errors | Site assessment non-conformance | **Onsite NC raised – awaiting MSME response** |  |
| 15 | SA verification done without errors | Site assessment quality check | **Onsite assessment done – agency quality check** |  |
| 16 | Agency Final submit for SA | Certified | **Certified** |  |
| 17 | (none) | Site assessment rejected | **Rejected at onsite assessment** |  |
| 99 | (none) | Rejected | **Rejected** |  |

### Desktop + Remote

_As Desktop + Onsite, the visit being a remote assessment (meeting link). No NC at the desktop stage; NCs only at the remote assessment (code 14). Codes 4 and 7 are not used._

| Code | Legacy name | V4 name | Suggested name | Your name |
|---|---|---|---|---|
| (no payment) | Payment Pending By MSME | — | **Registered – fee payment pending** |  |
| 1 | Payment done By MSME | Payment done, documents pending | **Fee paid – documents to be submitted** |  |
| 2 | Evidence upload done by MSME | Desktop assessment scheduled, not started | **Documents submitted – desktop assessment not started** |  |
| 3 | DA Verification in progress | Desktop assessment in progress | **Desktop assessment in progress** |  |
| 5 | DA Verification done without errors | Desktop assessment quality check | **Desktop assessment done – agency quality check** |  |
| 6 | Agency Final submit done for DA | Desktop assessment completed | **Desktop assessment approved – remote assessor to be allotted** |  |
| 8 | SA Allocation Done | Site assessment scheduled, not started | **Remote assessor allotted – remote assessment scheduled** |  |
| 9 | SA is ready to start | Parameters distributed (site assessment in progress) | **Remote assessment in progress** |  |
| 13 | SA Verification in progress | Assessment submitted through mobile app | **Remote assessment submitted** |  |
| 14 | SA Verification done with errors | Site assessment non-conformance | **Remote NC raised – awaiting MSME response** |  |
| 15 | SA verification done without errors | Site assessment quality check | **Remote assessment done – agency quality check** |  |
| 16 | Agency Final submit for SA | Certified | **Certified** |  |
| 17 | (none) | Site assessment rejected | **Rejected at remote assessment** |  |
| 99 | (none) | Rejected | **Rejected** |  |

### Onsite only

_No desktop step: once the case has its agency it moves to code 6, waiting for the agency to allot the onsite assessor (the Master Admin can re-allot it to another agency meanwhile). NCs only at the onsite assessment (code 14). Codes 3, 4, 5 and 7 are not used._

| Code | Legacy name | V4 name | Suggested name | Your name |
|---|---|---|---|---|
| (no payment) | Payment Pending By MSME | — | **Registered – fee payment pending** |  |
| 1 | Payment done By MSME | Payment done, documents pending | **Fee paid – documents to be submitted** |  |
| 2 | Evidence upload done by MSME | Desktop assessment scheduled, not started | **Documents submitted – allotted to agency (moves on at once)** |  |
| 6 | Agency Final submit done for DA | Desktop assessment completed | **Allotted to agency – onsite assessor to be allotted** |  |
| 8 | SA Allocation Done | Site assessment scheduled, not started | **Onsite assessor allotted – onsite assessment scheduled** |  |
| 9 | SA is ready to start | Parameters distributed (site assessment in progress) | **Onsite assessment in progress** |  |
| 13 | SA Verification in progress | Assessment submitted through mobile app | **Onsite assessment submitted** |  |
| 14 | SA Verification done with errors | Site assessment non-conformance | **Onsite NC raised – awaiting MSME response** |  |
| 15 | SA verification done without errors | Site assessment quality check | **Onsite assessment done – agency quality check** |  |
| 16 | Agency Final submit for SA | Certified | **Certified** |  |
| 17 | (none) | Site assessment rejected | **Rejected at onsite assessment** |  |
| 99 | (none) | Rejected | **Rejected** |  |

### Remote only

_As Onsite only, the visit being a remote assessment. Codes 3, 4, 5 and 7 are not used._

| Code | Legacy name | V4 name | Suggested name | Your name |
|---|---|---|---|---|
| (no payment) | Payment Pending By MSME | — | **Registered – fee payment pending** |  |
| 1 | Payment done By MSME | Payment done, documents pending | **Fee paid – documents to be submitted** |  |
| 2 | Evidence upload done by MSME | Desktop assessment scheduled, not started | **Documents submitted – allotted to agency (moves on at once)** |  |
| 6 | Agency Final submit done for DA | Desktop assessment completed | **Allotted to agency – remote assessor to be allotted** |  |
| 8 | SA Allocation Done | Site assessment scheduled, not started | **Remote assessor allotted – remote assessment scheduled** |  |
| 9 | SA is ready to start | Parameters distributed (site assessment in progress) | **Remote assessment in progress** |  |
| 13 | SA Verification in progress | Assessment submitted through mobile app | **Remote assessment submitted** |  |
| 14 | SA Verification done with errors | Site assessment non-conformance | **Remote NC raised – awaiting MSME response** |  |
| 15 | SA verification done without errors | Site assessment quality check | **Remote assessment done – agency quality check** |  |
| 16 | Agency Final submit for SA | Certified | **Certified** |  |
| 17 | (none) | Site assessment rejected | **Rejected at remote assessment** |  |
| 99 | (none) | Rejected | **Rejected** |  |

## Surveillance

_Bronze surveillance is done in the ZED assessor app (Remote or Onsite per the level's surveillance mode)._

| Code | V4 name | Suggested name | Your name |
|---|---|---|---|
| 1 | Desktop assessment scheduled, not started | **Surveillance desktop assessment scheduled** |  |
| 2 | Desktop assessment started | **Surveillance desktop assessment started** |  |
| 3 | Desktop assessment in progress | **Surveillance desktop assessment in progress** |  |
| 4 | Desktop assessment non-conformance | **Desktop NC raised – awaiting MSME response** |  |
| 5 | Desktop assessment quality check | **Desktop assessment done – agency quality check** |  |
| 6 | Desktop assessment completed | **Desktop assessment approved – site assessor to be allotted** |  |
| 7 | Desktop assessment rejected | **Rejected – desktop NCs not closed** |  |
| 8 | Site assessment scheduled, not started | **Site assessor allotted – site assessment scheduled** |  |
| 9 | Parameters distributed (site assessment in progress) | **Site assessment in progress** |  |
| 13 | Assessment submitted through mobile app | **Site assessment submitted** |  |
| 14 | Site assessment non-conformance | **Site NC raised – awaiting MSME response** |  |
| 15 | Site assessment quality check | **Site assessment done – agency quality check** |  |
| 16 | Surveillance completed | **Surveillance completed** |  |
| 17 | Site assessment rejected | **Rejected at site assessment** |  |
| 99 | Rejected | **Rejected** |  |

## Handholding (Consultancy), per milestone

| Code | V4 name | Suggested name | Your name |
|---|---|---|---|
| 1 | Milestone payment done | **Milestone fee paid – consulting organisation to be allotted** |  |
| 8 | Allotted to the consulting organisation | **Allotted to consulting organisation – consultants to be allotted** |  |
| 9 | Consultants allotted | **Consultants allotted – work in progress** |  |
| 13 | Submitted by the consultant (closing meeting done) | **Milestone work submitted by the consultant** |  |
| 15 | Quality check by the consulting organisation | **Consulting organisation quality check** |  |
| 16 | Milestone completed | **Milestone completed – awaiting MSME acceptance** |  |
| 100 | Deliverables accepted by the MSME | **Milestone accepted by the MSME** |  |
| 99 | Milestone rejected | **Milestone rejected** |  |

Milestones of the history (no code): Opening meeting conducted, Baseline diagnostic study scheduled, Handholding action plan scheduled.
