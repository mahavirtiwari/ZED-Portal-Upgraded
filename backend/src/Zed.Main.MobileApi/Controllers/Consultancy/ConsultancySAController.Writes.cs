using System.Data;
using System.Data.Common;
using System.Text.Json;
using Zed.Core.Data;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models.Consultancy;

namespace Zed.Main.MobileApi.Controllers.Consultancy;

/// <summary>The consultant app's writes. Every one checks the allotment first, then the old stage checks.</summary>
public sealed partial class ConsultancySAController
{
    // ------------------------------------------------------------------ Actions also in the main SA app

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitAllocation(SubmitAllocationRequest request, CancellationToken ct) => Guarded(nameof(SubmitAllocation), async () =>
    {
        // Only the lead consultant allots parameters, and only to the unit's lead or co-consultants.
        var allotments = await AllotmentsAsync(request.zedId, request.certificationType, ct);
        if (!allotments.Any(a => a.Role == "Lead" && Same(a.UserId, request.saId)))
            return NotAllotted(nameof(SubmitAllocation), request.saId, request.zedId);

        var list = Table("Id", "SectionId", "SectionCode", "AssessorId");
        foreach (var p in request.allocatedParameters ?? [])
        {
            if (string.IsNullOrEmpty(p.assigneeId)) continue;
            if (!allotments.Any(a => a.Role is "Lead" or "Co" && Same(a.UserId, p.assigneeId)))
                return NotAllotted(nameof(SubmitAllocation), p.assigneeId, request.zedId);
            AddRow(list, "0", p.parameterId, p.parameterCode, p.assigneeId);
        }
        if (list.Rows.Count == 0) return EmptyList(nameof(SubmitAllocation));

        var args = new DynamicParameters();
        args.Add("ZedId", request.zedId);
        args.Add("CertificationType", request.certificationType);
        args.Add("AllotList", list.AsTableValuedParameter("DynamicSectionAllot"));
        return LegacyJson(await ExecAsync("SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR", args, ct));
    });

    /// <summary>Changed in the consultancy code: only the database row is saved (from <c>selfie</c>); no file.</summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitSelfie(SubmitSelfieImageRequest request, CancellationToken ct) => Guarded(nameof(SubmitSelfie), async () =>
    {
        if (await RefuseAsync(nameof(SubmitSelfie), request.saId, request.zedId, request.certificationType, Role.Team, ct) is { } refused) return refused;
        if (await RequireOpenAsync(request.zedId, request.certificationType, request.saId, ct) is { } stage) return stage;
        if (request.selfie is not { } selfie) return Fail(ErrorText);

        var photos = PhotoTable();
        AddPhoto(photos, selfie.photoId, selfie.name, selfie.timeStamp, selfie.latitude, selfie.longitude);
        return LegacyJson(await SavePhotosAsync(nameof(SubmitSelfie), request.saId, request.zedId, request.certificationType, "Selfie", photos, ct));
    });

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitSiteTour(SubmitSiteTourRequest request, CancellationToken ct) => Guarded(nameof(SubmitSiteTour), async () =>
    {
        var certification = RequireCertification(request.certificationType);
        if (await RefuseAsync(nameof(SubmitSiteTour), request.saId, request.zedId, certification, Role.Team, ct) is { } refused) return refused;
        if (await RequireOpenAsync(request.zedId, request.certificationType, request.saId, ct) is { } stage) return stage;

        var photos = PhotoTable();
        foreach (var p in request.siteTourPhotos ?? [])
        {
            if (string.IsNullOrEmpty(p.photo)) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, certification, "SiteTour");
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.photoId, ".jpg"), ct);
            AddPhoto(photos, p.photoId, p.comment, p.timeStamp, p.latitude, p.longitude);
        }
        return LegacyJson(await SavePhotosAsync(nameof(SubmitSiteTour), request.saId, request.zedId, request.certificationType, "SiteTour", photos, ct));
    });

    /// <summary>
    /// A no-op in the consultancy code (its save call is commented out): the stage checks run and success is returned.
    /// The milestone screens use SubmitBaselineDiagnostic and the three actions after it.
    /// </summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitParameter(SubmitParameterRequest request, CancellationToken ct) => Guarded(nameof(SubmitParameter), async () =>
    {
        if (await RefuseAsync(nameof(SubmitParameter), request.saId, request.zedId, request.certificationType, Role.Team, ct) is { } refused) return refused;
        if (await RequireOpenAsync(request.zedId, request.certificationType, request.saId, ct) is { } stage) return stage;
        // The old code walked the requirements before doing nothing, and failed when there were none.
        if (request.allottedParameterObj?.requirements is null) return Fail(ErrorText);
        log.LogInformation("Consultancy SA/SubmitParameter for {ZedId} by {SaId}: no-op, as in the old service", request.zedId, request.saId);
        return LegacyJson(new ServiceResponse { status = "1" });
    });

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitOfiComments(SubmitOfiCommentsRequest request, CancellationToken ct) => Guarded(nameof(SubmitOfiComments), async () =>
    {
        if (await RefuseAsync(nameof(SubmitOfiComments), request.saId, request.zedId, request.certificationType, Role.Team, ct) is { } refused) return refused;
        if (await RequireOpenAsync(request.zedId, request.certificationType, request.saId, ct) is { } stage) return stage;

        return LegacyJson(await ExecAsync("SP_APP_SA_SAVE_OFI_COMMENTS", new
        {
            ZedId = request.zedId,
            AssessorId = request.saId,
            CertificationType = request.certificationType,
            ParameterId = request.parameterId,
            ParameterCode = request.parameterCode,
            OfiComments = request.ofiComments,
        }, ct));
    });

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitStartAssessment(SubmitAssessmentRequest request, CancellationToken ct) => Guarded(nameof(SubmitStartAssessment), async () =>
    {
        var certification = RequireCertification(request.certificationType);
        if (await RefuseAsync(nameof(SubmitStartAssessment), request.saId, request.zedId, certification, Role.Team, ct) is { } refused) return refused;

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (st.OpenMeetingSubmitted) return Fail(OpenSubmitted + request.zedId);

        var participants = Participants(request.startParticipants);
        var photos = await SaveMeetingPhotosAsync(request, certification, ct);
        return LegacyJson(await SaveMeetingAsync(request, participants, photos, "Open Meeting", request.inputComment, ct));
    });

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitEndAssessment(SubmitAssessmentRequest request, CancellationToken ct) => Guarded(nameof(SubmitEndAssessment), async () =>
    {
        var certification = RequireCertification(request.certificationType);
        // userType 2 (co-consultant) records its final submit; anything else is the lead's closing meeting, which
        // completes the milestone (status 13), so the role sent must be the real one.
        var coConsultant = request.userType == 2;
        if (await RefuseAsync(nameof(SubmitEndAssessment), request.saId, request.zedId, certification, coConsultant ? Role.Co : Role.Lead, ct) is { } refused)
            return refused;

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (coConsultant)
        {
            if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
            if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
            if (st.FinalSubmissionDone) return Fail(FinalDone + request.zedId);
            if (!st.AllParametersSyncedByCo) return Fail(NotSynced + request.zedId);
            return LegacyJson(await SaveMeetingAsync(request, null, null, "Final Submit", request.endComment, ct));
        }

        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
        if (!st.AllParametersSyncedByLead) return Fail(NotSynced + request.zedId);
        if (!st.AllParametersSyncedByCo) return Fail(NotSynced + request.zedId);
        if (!st.FinalSubmissionDone) return Fail(FinalNotSynced + request.zedId);

        var participants = Participants(request.endParticipants);
        var photos = await SaveMeetingPhotosAsync(request, certification, ct);
        return LegacyJson(await SaveMeetingAsync(request, participants, photos, "Close Meeting", request.endComment, ct));
    });

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> CheckParameterSyncStatus(CheckParameterSyncStatusRequest request, CancellationToken ct) => Guarded(nameof(CheckParameterSyncStatus), async () =>
    {
        if (await RefuseAsync(nameof(CheckParameterSyncStatus), request.saId, request.zedId, request.certificationType, Role.TeamOrDfo, ct) is { } refused)
            return refused;
        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        return LegacyJson(new CheckParameterSyncStatusResponse
        {
            status = "1",
            AllParametersSynced = request.userType == 2 ? st.AllParametersSyncedByCo : st.AllParametersSyncedByLead,
        });
    });

    /// <summary>Changed in the consultancy code: the handholding baseline figures (SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO).</summary>
    [HttpPost]
    [DeviceBound(App, "saId", "userName")]
    public Task<IActionResult> SubmitBasicInformation(BasicInfoConsultancyRequest request, CancellationToken ct) => Guarded(nameof(SubmitBasicInformation), async () =>
    {
        // The procedure does not record who sent the figures; the sender named in the request must be on the unit.
        if (await RefuseAsync(nameof(SubmitBasicInformation), First(request.saId, request.userName), request.zedId, request.certificationType, Role.Team, ct) is { } refused)
            return refused;
        if (request.basicInformation is not { } info) return Fail("No data found.");
        if (await RequireOpenAsync(request.zedId, request.certificationType, request.saId, ct) is { } stage) return stage;

        // The old code read every group without a null check and failed (exception text) when one was missing.
        if (info is not
            {
                occupationalSafety: { } safety, measurementOfTimelyDelivery: { } delivery, plannedMaintenanceCalibration: { } maintenance,
                energyManagement: { electrical: { } electrical, solar: { } solar, wind: { } wind, fossilFuel: { } fossil, gas: { } gas, others: { } others } energy,
                environmentManagement: { } env, humanResourceManagement: { } hr, measurementAnalysis: { } ma,
                naturalResourcesManagement: { } nrm, financialPerformance: { } fin,
            })
            return Fail(ErrorText);

        return LegacyJson(await ExecAsync("SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO", new
        {
            RefId = RefId(),
            ZedId = request.zedId,
            CertificationType = request.certificationType,
            NumOfAccidents = safety.numOfAccidents,
            NumOfNearMisses = safety.numOfNearMisses,
            ManHoursLast = safety.manHoursLast,
            LostTimeInjuryFrequencyRate = safety.lostTimeInjuryFrequencyRate,
            NumOfDeliveries = delivery.numOfDeliveries,
            NumOfDeliveriesOnTimeInFull = delivery.numOfDeliveriesOnTimeInFull,
            MeanTimeToRepair = maintenance.meanTimeToRepair,
            MeanTimeBetweenFailure = maintenance.meanTimeBetweenFailure,
            Electrical_Unit = electrical.unit,
            Electrical_TotalConsumptionPercentage = electrical.totalConsumptionPercentage,
            Solar_Unit = solar.unit,
            Solar_TotalConsumptionPercentage = solar.totalConsumptionPercentage,
            Wind_Unit = wind.unit,
            Wind_TotalConsumptionPercentage = wind.totalConsumptionPercentage,
            FossilFuel_Unit = fossil.unit,
            FossilFuel_TotalConsumptionPercentage = fossil.totalConsumptionPercentage,
            Gas_Unit = gas.unit,
            Gas_TotalConsumptionPercentage = gas.totalConsumptionPercentage,
            Others_unit = others.unit,
            Others_TotalConsumptionPercentage = others.totalConsumptionPercentage,
            TotalCost = energy.totalCost,
            EnergyMgmtMeasuresTaken = energy.measuresTaken,
            Cox = env.cox,
            Nox = env.nox,
            Sox = env.sox,
            SuspendedParticulateMaterial = env.suspendedParticulateMaterial,
            TotalSuspendedSolid = env.totalSuspendedSolid,
            BiochemicalOxygenDemand = env.biochemicalOxygenDemand,
            SolidWaste = env.solidWaste,
            PlasticWaste = env.plasticWaste,
            EWaste = env.eWaste,
            HazardousWaste = env.hazardousWaste,
            NoiseLevel = env.noiseLevel,
            EnviMgmtMeasuresTaken = env.measuresTaken,
            EmployeesEngagedInActivities = hr.employeesEngagedInActivities,
            NoOfSuggestions = hr.noOfSuggestions,
            HrmMeasuresTaken = hr.measuresTaken,
            Defects = ma.defects,
            Rework = ma.rework,
            CustomerRejections = ma.customerRejections,
            NumberOfCustomerComplaints = ma.numberOfCustomerComplaints,
            NumberOfComplaintsResolved = ma.numberOfComplaintsResolved,
            CustomerSatisfactionLevel = ma.customerSatisfactionLevel,
            CostOfPoorQuality = ma.costOfPoorQuality,
            Water = nrm.water,
            Minerals = nrm.minerals,
            Wood = nrm.wood,
            Others = nrm.others,
            WaterRecycling = nrm.waterRecycling,
            WaterReuse = nrm.waterReuse,
            RainWaterHarvesting = nrm.rainWaterHarvesting,
            NoOfTreePlanted = nrm.noOfTreePlanted,
            NrmMeasuresTaken = nrm.measuresTaken,
            Turnover = fin.turnover,
            GrossProfit = fin.grossProfit,
        }, ct));
    });

    [HttpPost]
    [DeviceBound(App, "userName")]
    public Task<IActionResult> SubmitBasicInfoPhotos(SubmitPhotosRequest request, CancellationToken ct) => Guarded(nameof(SubmitBasicInfoPhotos), async () =>
    {
        var certification = RequireCertification(request.certificationType);
        if (await RefuseAsync(nameof(SubmitBasicInfoPhotos), request.userName, request.zedId, certification, Role.Team, ct) is { } refused) return refused;
        if (request.photos is null) return Fail("No photos found.");
        if (await RequireOpenAsync(request.zedId, request.certificationType, null, ct) is { } stage) return stage;

        foreach (var p in request.photos)
        {
            if (p?.photo is null) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, certification, "BasicInfo");
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.photoId, p.isPdf ? ".pdf" : ".jpg"), ct);
        }
        return LegacyJson(new ServiceResponse { status = "1" });
    });

    /// <summary>Changed in the consultancy code: files go to SaPhotos/{zed}/{cert}/{sectionName} ("SiteTour" when empty).</summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitEvidences(SubmitAssessmentRequest request, CancellationToken ct) => Guarded(nameof(SubmitEvidences), async () =>
    {
        var certification = RequireCertification(request.certificationType);
        var section = Section(string.IsNullOrEmpty(request.sectionName) ? "SiteTour" : request.sectionName);
        var coConsultant = request.userType == 2;
        if (await RefuseAsync(nameof(SubmitEvidences), request.saId, request.zedId, certification, coConsultant ? Role.Co : Role.Team, ct) is { } refused)
            return refused;

        var st = await CheckSaStatusAsync(request.zedId, request.certificationType, request.saId, ct);
        if (st.ClosingMeetingSubmitted) return Fail(Closed + request.zedId);
        if (!st.OpenMeetingSubmitted) return Fail(OpenNotSubmitted + request.zedId);
        if (coConsultant && st.FinalSubmissionDone) return Fail(FinalSubmitDone + request.zedId);

        if (request.addedEvidences is not { Count: > 0 } evidences) return LegacyJson(new ServiceResponse { status = "1" });
        var photos = PhotoTable();
        foreach (var p in evidences)
        {
            if (string.IsNullOrEmpty(p.photo)) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, certification, section);
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.photoId, ".jpg"), ct);
            AddPhoto(photos, p.photoId, p.name, p.timeStamp, p.latitude, p.longitude);
        }
        return LegacyJson(await SavePhotosAsync(nameof(SubmitEvidences), request.saId, request.zedId, request.certificationType, "Evidences", photos, ct));
    });

    // ------------------------------------------------------------------ New in the consultancy code

    /// <summary>
    /// One multipart file (form part <c>FormFile</c>) with its details as form fields, saved as
    /// SaPhotos/{zed}/{cert}/{sectionName}/{photoId}.jpg (.pdf when isPdf) and recorded with PhotoType = sectionName.
    /// The old action had no stage check; none is added.
    /// </summary>
    [HttpPost]
    [DeviceBound(App, "userName")]
    public Task<IActionResult> SubmitPhotos(SubmitFileUploadRequest request, IFormFile? FormFile, CancellationToken ct) => Guarded(nameof(SubmitPhotos), async () =>
    {
        var certification = RequireCertification(request.certificationType);
        var section = Section(request.sectionName);
        if (await RefuseAsync(nameof(SubmitPhotos), request.userName, request.zedId, certification, Role.TeamOrDfo, ct) is { } refused) return refused;
        if (FormFile is null) return LegacyJson(new FileUploadResponse { status = "0", errorMessage = "No photos found." });

        var response = new FileUploadResponse { status = "1" };
        if (FormFile.Length > 0)
        {
            var fileName = MobileStorage.FileName(request.photoId, request.isPdf ? ".pdf" : ".jpg");
            var folder = storage.Folder("SaPhotos", request.zedId, certification, section);
            await storage.SaveAsync(FormFile, folder, fileName, ct);

            var photos = PhotoTable();
            AddPhoto(photos, request.photoId, request.name, request.timeStamp, request.latitude, request.longitude);
            response.fileName = fileName;
            // Path.Combine on the old Windows server.
            response.filePath = string.Join('\\', MobileStorage.Segment(request.zedId), certification, section, fileName);

            var saved = await SavePhotosAsync(nameof(SubmitPhotos), request.userName, request.zedId, request.certificationType, section, photos, ct);
            if (saved.status == "0") return LegacyJson(saved);
        }
        return LegacyJson(response);
    });

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitZedTrainingInfo(ZedTrainingInfoSubmissionRequest request, CancellationToken ct) =>
        Guarded(nameof(SubmitZedTrainingInfo), () => SaveTrainingAsync(nameof(SubmitZedTrainingInfo), request, "ZedTraining", ct));

    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitHouseholdingTrainingInfo(ZedTrainingInfoSubmissionRequest request, CancellationToken ct) =>
        Guarded(nameof(SubmitHouseholdingTrainingInfo), () => SaveTrainingAsync(nameof(SubmitHouseholdingTrainingInfo), request, "HouseholdingTraining", ct));

    /// <summary>Old SubmitZedTrainingInfo helper. The old actions had their stage checks commented out; kept so.</summary>
    private async Task<IActionResult> SaveTrainingAsync(string action, ZedTrainingInfoSubmissionRequest request, string trainingType, CancellationToken ct)
    {
        if (await RefuseAsync(action, request.saId, request.zedId, request.certificationType, Role.Team, ct) is { } refused) return refused;
        if (request.trainingInfo is not { } info) return Fail("No data found.");

        // Only the details are recorded; the files come through SubmitPhotos.
        var photos = PhotoTable();
        foreach (var p in info.trainingPhoto ?? [])
            AddPhoto(photos, p.photoId, "Training Photo", p.timeStamp, p.latitude, p.longitude, p.isPdf ? "pdf" : "jpg");
        foreach (var p in info.attendanceSheet ?? [])
            AddPhoto(photos, p.photoId, "Attendance Sheet", p.timeStamp, p.latitude, p.longitude, p.isPdf ? "pdf" : "jpg");

        var args = new DynamicParameters();
        args.Add("RefId", RefId());
        args.Add("AssessorId", request.saId);
        args.Add("ZedId", request.zedId);
        args.Add("CertificationType", request.certificationType);
        args.Add("TrainingTopic", info.trainingTopic);
        args.Add("TrainingDate", info.trainingDate);
        args.Add("TrainingTime", info.trainingTime);
        args.Add("Remarks", info.remarks);
        args.Add("TrainingType", trainingType);
        if (photos.Rows.Count > 0) args.Add("TrainingPhotos", photos.AsTableValuedParameter("DynamicPhotoList2"));
        return LegacyJson(await ExecAsync("SP_APP_SA_CONSULTANCY_TRAINING_INFO", args, ct));
    }

    /// <summary>Gaps identified: conformance and remarks, bullets per requirement, photos from capturedEvidences.</summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitBaselineDiagnostic(SubmitParameterRequest request, CancellationToken ct) =>
        Guarded(nameof(SubmitBaselineDiagnostic), () => SaveParameterAsync(nameof(SubmitBaselineDiagnostic), request, "BaselineDiagnostic",
            r => (r.code, r.conformance), r => r.gapsIdentified, r => r.capturedEvidences, ct));

    /// <summary>Planned activities: Conformance carries estimatedTimeInDays; photos from addedEvidences and capturedEvidences.</summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitHandholdingActionPlan(SubmitParameterRequest request, CancellationToken ct) =>
        Guarded(nameof(SubmitHandholdingActionPlan), () => SaveParameterAsync(nameof(SubmitHandholdingActionPlan), request, "HandholdingActionPlan",
            r => (r.code, r.estimatedTimeInDays), r => r.plannedActivities, r => [.. r.addedEvidences ?? [], .. r.capturedEvidences ?? []], ct));

    /// <summary>RequirementCode carries the rationale and Conformance the fixed text "Conformance"; photos from addedEvidences.</summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitTechnologyIntervention(SubmitParameterRequest request, CancellationToken ct) =>
        Guarded(nameof(SubmitTechnologyIntervention), () => SaveParameterAsync(nameof(SubmitTechnologyIntervention), request, "TechnologyIntervention",
            r => (r.technologyInterventionRationale, "Conformance"), r => r.suggestedTechnologyIntervention, r => r.addedEvidences, ct));

    /// <summary>Conformance carries isProposedActivityCompleted; no bullets; photos from capturedEvidences.</summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitProgressReview(SubmitParameterRequest request, CancellationToken ct) =>
        Guarded(nameof(SubmitProgressReview), () => SaveParameterAsync(nameof(SubmitProgressReview), request, "ProgressReview",
            r => (r.code, r.isProposedActivityCompleted), _ => null, r => r.capturedEvidences, ct));

    /// <summary>
    /// SP_APP_SA_SAVE_PARAMETER with @Phototype naming the milestone screen: @RequirementsList (DynamicRequirementsList1)
    /// always, @PhotoList (photo ids only; the files came through SubmitPhotos) and @BulletList (DynamicParticipants:
    /// Name = requirement id, Designation = bullet text) only when they have rows, as before.
    /// </summary>
    private async Task<IActionResult> SaveParameterAsync(string action, SubmitParameterRequest request, string type,
        Func<RequirementDetails, (string? Code, string? Conformance)> fields, Func<RequirementDetails, List<string>?> bullets,
        Func<RequirementDetails, List<PhotoInformation>?> evidences, CancellationToken ct)
    {
        if (await RefuseAsync(action, request.saId, request.zedId, request.certificationType, Role.Team, ct) is { } refused) return refused;
        if (await RequireOpenAsync(request.zedId, request.certificationType, request.saId, ct) is { } stage) return stage;
        if (request.allottedParameterObj is not { requirements: { } requirements } parameter) return Fail(ErrorText);

        var reqs = Table("RequirementId", "RequirementCode", "Conformance", "AssessorRemarks");
        var photos = PhotoTable();
        var bulletRows = ParticipantTable();
        foreach (var r in requirements)
        {
            var id = Invariant(r.id);
            var (code, conformance) = fields(r);
            AddRow(reqs, id, code ?? "", conformance, r.comments ?? "");
            foreach (var b in bullets(r) ?? []) AddRow(bulletRows, id, b ?? "");
            foreach (var p in evidences(r) ?? [])
                if (!string.IsNullOrEmpty(p.photoId))
                    AddPhoto(photos, p.photoId, p.name, p.timeStamp, p.latitude, p.longitude, id);
        }
        if (reqs.Rows.Count == 0) return EmptyList(action);

        var args = new DynamicParameters();
        args.Add("ZedId", request.zedId);
        args.Add("AssessorId", request.saId);
        args.Add("CertificationType", request.certificationType);
        args.Add("ParameterId", parameter.parameterId);
        args.Add("ParameterCode", parameter.parameterCode);
        args.Add("PhotoType", type);
        args.Add("RequirementsList", reqs.AsTableValuedParameter("DynamicRequirementsList1"));
        if (photos.Rows.Count > 0) args.Add("PhotoList", photos.AsTableValuedParameter("DynamicPhotoList2"));
        if (bulletRows.Rows.Count > 0) args.Add("BulletList", bulletRows.AsTableValuedParameter("DynamicParticipants"));
        return LegacyJson(await ExecAsync("SP_APP_SA_SAVE_PARAMETER", args, ct));
    }

    /// <summary>
    /// Daily attendance: the selfie is the multipart part <c>files</c>, its details the JSON text in <c>selfieMetadata</c>.
    /// Saved as Attendance/{zed}/{cert}/{photoId}.jpg (the portal reads .jpg; the old code kept the client's extension,
    /// finding #91). Used by consultants and by the TU verifier (the procedure links the row to the TU application).
    /// </summary>
    [HttpPost]
    [DeviceBound(App, "saId")]
    public Task<IActionResult> SubmitAttendance(SubmitAttendanceRequest request, IFormFile? files, CancellationToken ct) => Guarded(nameof(SubmitAttendance), async () =>
    {
        var certification = RequireCertification(request.certificationType);
        if (await RefuseAsync(nameof(SubmitAttendance), request.saId, request.zedId, certification, Role.TeamOrDfo, ct) is { } refused) return refused;
        if (files is null || files.Length <= 0) return Fail("Consultant selfie data not found.");

        PhotoInformation? selfie = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(request.selfieMetadata))
                selfie = JsonSerializer.Deserialize<PhotoInformation>(request.selfieMetadata, Zed.Core.Mobile.LegacyJson.Read);
        }
        catch (JsonException)
        {
            selfie = null;
        }
        // The old code failed on a missing or unreadable selfieMetadata (exception text).
        if (selfie is null || string.IsNullOrWhiteSpace(selfie.photoId)) return Fail(ErrorText);

        var folder = storage.Folder("Attendance", request.zedId, certification);
        await storage.SaveAsync(files, folder, MobileStorage.FileName(selfie.photoId, ".jpg"), ct);

        ResultSets sets;
        try
        {
            sets = await db.QueryProcMultipleAsync("SP_APP_SA_INSERT_DAILY_ATTENDANCE", new
            {
                RefId = RefId(),
                ZedId = request.zedId,
                AssessorId = request.saId,
                CertificationType = request.certificationType,
                AttendanceType = request.attendanceType,
                Comments = request.comments,
                PhotoId = selfie.photoId,
                Latitude = selfie.latitude,
                Longitude = selfie.longitude,
                TimeStamp = selfie.timeStamp,
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_APP_SA_INSERT_DAILY_ATTENDANCE failed");
            return Fail(ErrorText);
        }
        // The procedure answers one row: Status, Message (read by position in the old code).
        if (sets.Count == 0 || sets[0].Count == 0) return Fail(ErrorText);
        var values = sets[0][0].Values.ToList();
        return LegacyJson(new ServiceResponse
        {
            status = values.Count > 0 ? Convert.ToString(values[0], System.Globalization.CultureInfo.InvariantCulture) : null,
            errorMessage = values.Count > 1 ? Convert.ToString(values[1], System.Globalization.CultureInfo.InvariantCulture) : null,
        });
    });

    // ------------------------------------------------------------------ Meeting helpers

    private async Task<DataTable> SaveMeetingPhotosAsync(SubmitAssessmentRequest request, string certification, CancellationToken ct)
    {
        var photos = PhotoTable();
        foreach (var p in request.assessmentPhotos ?? [])
        {
            if (string.IsNullOrEmpty(p.photo)) continue;
            var folder = storage.Folder("SaPhotos", request.zedId, certification);
            await storage.SaveBase64Async(p.photo, folder, MobileStorage.FileName(p.name + "_" + p.photoId, ".jpg"), ct);
            AddPhoto(photos, p.photoId, p.name, p.timeStamp, p.latitude, p.longitude);
        }
        return photos;
    }

    private Task<ServiceResponse> SaveMeetingAsync(SubmitAssessmentRequest request, DataTable? participants, DataTable? photos,
        string photoType, string? comments, CancellationToken ct)
    {
        var args = new DynamicParameters();
        args.Add("ZedId", request.zedId);
        args.Add("AssessorId", request.saId);
        args.Add("CertificationType", request.certificationType);
        args.Add("PhotoType", photoType);
        args.Add("Latitude", request.latitude);
        args.Add("Longitude", request.longitude);
        args.Add("Comments", comments);
        if (participants is { Rows.Count: > 0 }) args.Add("ParticipantsList", participants.AsTableValuedParameter("DynamicParticipants"));
        if (photos is { Rows.Count: > 0 }) args.Add("PhotoList", photos.AsTableValuedParameter("DynamicPhotoList2"));
        return ExecAsync("SP_SA_APP_INSERT_OPEN_MEETING", args, ct);
    }

    private static DataTable Participants(List<Participant>? participants)
    {
        var table = ParticipantTable();
        foreach (var p in participants ?? []) AddRow(table, p.name, p.designation ?? "");
        return table;
    }
}
