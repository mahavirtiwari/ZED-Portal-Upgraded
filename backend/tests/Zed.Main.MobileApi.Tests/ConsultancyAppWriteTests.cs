using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Controllers.Consultancy;

namespace Zed.Main.MobileApi.Tests;

public sealed class ConsultancyAppWriteTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Lead = "ZEDCC0001";
    private const string Co = "ZEDCC1019";
    private const string Expert = "ZEDCC0500";
    private const string Dfo = "ZEDCC0756";
    private const string Other = "ZEDCC0099";
    private readonly ConsultancyAppHost _t = new();
    private readonly Dictionary<string, object?> _flags = new()
    {
        ["SaStatus"] = 1, ["OpenMeetingSubmitted"] = true, ["AllParametersSyncedByLead"] = true, ["AllParametersSyncedByCo"] = false,
        ["FinalSubmissionDone"] = false, ["ClosingMeetingSubmitted"] = false, ["LeadAssessor"] = true,
    };

    public ConsultancyAppWriteTests()
    {
        _t.Sql.Allot(Zed, "Silver", "Lead", Lead);
        _t.Sql.Allot(Zed, "Silver", "Co", Co);
        _t.Sql.Allot(Zed, "Silver", "Expert", Expert);
        _t.Sql.Allot(Zed, "Silver", "Dfo", Dfo);
        _t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(_flags)]);
        _t.Fake.Procs["SP_APP_SA_INSERT_DAILY_ATTENDANCE"] = _ => FakeSql.Sets([new { Status = 1, Message = "LOGIN ATTENDANCE SUBMITTED SUCCESSFULLY" }]);
    }

    public void Dispose() => _t.Dispose();

    private static object Photo(string photoId, string? name = "p", string data = "aGVsbG8=", bool isPdf = false) =>
        new { photoId, name, photo = data, timeStamp = "t", latitude = "1", longitude = "2", comment = "c-" + photoId, isPdf };

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    private static void AssertOk(JsonElement e) => Assert.Equal("1", e.GetProperty("status").GetString());

    private void AssertNotAllotted(JsonElement e, params string[] procs)
    {
        AssertFail(e, ConsultancySAController.NotAllocated + Zed);
        foreach (var proc in procs) Assert.Empty(_t.CallsTo(proc));
        Assert.Empty(_t.AllFiles());
    }

    private static object Parameter(string saId, object requirement) => new
    {
        saId, zedId = Zed, certificationType = "Silver",
        allottedParameterObj = new { Id = "7", parameterId = "1", parameterCode = "1", requirements = new[] { requirement } },
    };

    private static object Requirement() => new
    {
        id = 210, code = "R1", conformance = "True", comments = "remark", estimatedTimeInDays = "30", technologyInterventionRationale = "Use IoT",
        isProposedActivityCompleted = "Yes",
        gapsIdentified = new[] { "Gap A", "Gap B" }, plannedActivities = new[] { "Train" }, suggestedTechnologyIntervention = new[] { "Sensors" },
        addedEvidences = new[] { new { photoId = "a1", name = "added" } },
        capturedEvidences = new[] { new { photoId = "c1", name = "captured" } },
    };

    private static MultipartFormDataContent PhotoForm(string userName, string section, string photoId = "ph1", bool isPdf = false, string fileName = "shot.aspx")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(userName), "userName" },
            { new StringContent(Zed), "zedId" },
            { new StringContent("Silver"), "certificationType" },
            { new StringContent(section), "sectionName" },
            { new StringContent(photoId), "photoId" },
            { new StringContent(isPdf ? "true" : "false"), "isPdf" },
            { new StringContent("Gate"), "name" },
            { new StringContent("ts"), "timeStamp" },
            { new StringContent("11"), "latitude" },
            { new StringContent("22"), "longitude" },
        };
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes("file-bytes"));
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "FormFile", fileName);
        return form;
    }

    private static MultipartFormDataContent AttendanceForm(string saId, string? metadata = """{"photoId":"att1","latitude":"1","longitude":"2","timeStamp":"t"}""", bool withFile = true)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(saId), "saId" },
            { new StringContent(Zed), "zedId" },
            { new StringContent("Silver"), "certificationType" },
            { new StringContent("LOGIN"), "attendanceType" },
            { new StringContent("on site"), "comments" },
        };
        if (metadata is not null) form.Add(new StringContent(metadata), "selfieMetadata");
        if (withFile) form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("selfie")), "files", "selfie.aspx");
        return form;
    }

    // ---------------------------------------------------------------- Allotment on every call

    public static TheoryData<string> JsonActions =>
    [
        "SubmitAllocation", "SubmitSelfie", "SubmitSiteTour", "SubmitParameter", "SubmitOfiComments", "SubmitStartAssessment",
        "SubmitEndAssessment", "CheckParameterSyncStatus", "SubmitBasicInformation", "SubmitBasicInfoPhotos", "SubmitEvidences",
        "SubmitZedTrainingInfo", "SubmitHouseholdingTrainingInfo", "SubmitBaselineDiagnostic", "SubmitHandholdingActionPlan",
        "SubmitTechnologyIntervention", "SubmitProgressReview",
    ];

    [Theory]
    [MemberData(nameof(JsonActions))]
    public async Task Every_action_refuses_a_user_not_allotted_to_the_unit(string action)
    {
        var e = await _t.Json("/SA/" + action, new
        {
            saId = Other, userName = Other, zedId = Zed, certificationType = "Silver", userType = 1,
            selfie = Photo("s1"), siteTourPhotos = new[] { Photo("t1") }, assessmentPhotos = new[] { Photo("m1", "Opening Meeting Photo") },
            addedEvidences = new[] { Photo("e1") }, photos = new[] { Photo("b1") },
            allottedParameterObj = new { parameterId = "1", parameterCode = "1", requirements = new[] { Requirement() } },
            allocatedParameters = new[] { new { parameterId = "1", parameterCode = "1", assigneeId = Co } },
            trainingInfo = new { trainingTopic = "x" }, basicInformation = new { },
        });
        AssertNotAllotted(e, "SP_SA_APP_CHECK_STATUS", "SP_APP_SA_SAVE_PHOTOS", "SP_APP_SA_SAVE_PARAMETER", "SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR",
            "SP_SA_APP_INSERT_OPEN_MEETING", "SP_APP_SA_SAVE_OFI_COMMENTS", "SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO", "SP_APP_SA_CONSULTANCY_TRAINING_INFO");
    }

    [Fact]
    public async Task Multipart_actions_refuse_a_user_not_allotted_to_the_unit()
    {
        AssertNotAllotted(await _t.Form("/SA/SubmitPhotos", PhotoForm(Other, "SiteTour")), "SP_APP_SA_SAVE_PHOTOS");
        AssertNotAllotted(await _t.Form("/SA/SubmitAttendance", AttendanceForm(Other)), "SP_APP_SA_INSERT_DAILY_ATTENDANCE");
    }

    [Fact]
    public async Task An_id_that_only_contains_an_allotted_id_is_refused()
    {
        // ZEDCC101 is a prefix of the allotted co-consultant ZEDCC1019 (the old CoAssessorId LIKE, #93).
        var e = await _t.Json("/SA/SubmitBaselineDiagnostic", Parameter("ZEDCC101", Requirement()));
        AssertNotAllotted(e, "SP_APP_SA_SAVE_PARAMETER");
    }

    [Fact]
    public async Task Another_certification_of_the_unit_is_not_an_allotment()
    {
        var e = await _t.Json("/SA/SubmitOfiComments", new { saId = Lead, zedId = Zed, certificationType = "Gold", parameterCode = "1", ofiComments = "x" });
        AssertNotAllotted(e, "SP_APP_SA_SAVE_OFI_COMMENTS");
    }

    [Fact]
    public async Task A_technical_expert_works_on_the_unit_but_cannot_allot_or_close()
    {
        AssertOk(await _t.Json("/SA/SubmitProgressReview", Parameter(Expert, Requirement())));
        AssertNotAllotted(await _t.Json("/SA/SubmitAllocation", new
        {
            saId = Expert, zedId = Zed, certificationType = "Silver",
            allocatedParameters = new[] { new { parameterId = "1", parameterCode = "1", assigneeId = Co } },
        }), "SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR");
        AssertNotAllotted(await _t.Json("/SA/SubmitEndAssessment", new { saId = Expert, zedId = Zed, certificationType = "Silver", userType = 1 }),
            "SP_SA_APP_INSERT_OPEN_MEETING");
    }

    [Fact]
    public async Task The_DFO_may_send_attendance_and_files_but_not_consultant_work()
    {
        AssertOk(await _t.Form("/SA/SubmitAttendance", AttendanceForm(Dfo)));
        AssertOk(await _t.Form("/SA/SubmitPhotos", PhotoForm(Dfo, "TU Evidence")));
        var e = await _t.Json("/SA/SubmitBaselineDiagnostic", Parameter(Dfo, Requirement()));
        AssertFail(e, ConsultancySAController.NotAllocated + Zed);
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PARAMETER"));
    }

    [Fact]
    public async Task An_unknown_device_is_refused_in_enforce_mode()
    {
        using var t = new ConsultancyAppHost();
        t.Settings["Mobile:DeviceBinding"] = "Enforce";
        t.Sql.Allot(Zed, "Silver", "Lead", Lead);
        t.Devices.Known[(MobileApps.SiteAssessor, Lead)] = ["known-phone"];
        var e = await t.Json("/SA/SubmitOfiComments", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", ofiComments = "x", deviceInfo = new { deviceId = "other-phone" },
        });
        AssertFail(e, "This device is not registered for your account. Please login again.");
        Assert.Empty(t.CallsTo("SP_APP_SA_SAVE_OFI_COMMENTS"));
    }

    // ---------------------------------------------------------------- Changed actions

    [Fact]
    public async Task Selfie_records_only_the_database_row()
    {
        var e = await _t.Json("/SA/SubmitSelfie", new { saId = Co, zedId = Zed, certificationType = "Silver", selfie = Photo("s1", "Selfie") });
        AssertOk(e);
        Assert.Empty(_t.AllFiles());
        var args = _t.LastArgs("SP_APP_SA_SAVE_PHOTOS");
        Assert.Equal("Selfie", ConsultancyAppHost.Arg(args, "PhotoType"));
        Assert.Equal(Co, ConsultancyAppHost.Arg(args, "AssessorId"));
        Assert.Equal("s1", AssessorTestHost.Tvp(args, "PhotoList")!.Rows[0]["PhotoId"]);
    }

    [Fact]
    public async Task Stage_checks_use_the_consultancy_texts()
    {
        _flags["ClosingMeetingSubmitted"] = true;
        AssertFail(await _t.Json("/SA/SubmitSelfie", new { saId = Lead, zedId = Zed, certificationType = "Silver", selfie = Photo("s1") }),
            "Closing Meeting Submitted for the ZEDID: " + Zed);
        _flags["ClosingMeetingSubmitted"] = false;
        _flags["OpenMeetingSubmitted"] = false;
        AssertFail(await _t.Json("/SA/SubmitTechnologyIntervention", Parameter(Lead, Requirement())), "Open Meeting not Submitted for the ZEDID: " + Zed);
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PARAMETER"));
    }

    [Fact]
    public async Task SubmitParameter_is_a_no_op_success()
    {
        AssertOk(await _t.Json("/SA/SubmitParameter", Parameter(Lead, Requirement())));
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PARAMETER"));
        Assert.Single(_t.CallsTo("SP_SA_APP_CHECK_STATUS"));
    }

    [Fact]
    public async Task Evidences_go_to_the_section_folder_named_in_the_request()
    {
        AssertOk(await _t.Json("/SA/SubmitEvidences", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", sectionName = "Baseline Diagnostic Selfie", addedEvidences = new[] { Photo("e1") },
        }));
        Assert.Equal("hello", File.ReadAllText(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Baseline Diagnostic Selfie", "e1.jpg")));
        Assert.Equal("Evidences", ConsultancyAppHost.Arg(_t.LastArgs("SP_APP_SA_SAVE_PHOTOS"), "PhotoType"));

        AssertOk(await _t.Json("/SA/SubmitEvidences", new { saId = Lead, zedId = Zed, certificationType = "Silver", addedEvidences = new[] { Photo("e2") } }));
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "SiteTour", "e2.jpg")));
    }

    [Theory]
    [InlineData("..")]
    [InlineData("../../Views")]
    [InlineData("a\\b")]
    [InlineData("x:y")]
    public async Task A_section_name_that_is_not_a_plain_name_is_refused(string section)
    {
        var e = await _t.Json("/SA/SubmitEvidences", new { saId = Lead, zedId = Zed, certificationType = "Silver", sectionName = section, addedEvidences = new[] { Photo("e1") } });
        AssertFail(e, "Invalid Data.");
        Assert.Empty(_t.AllFiles());
        Assert.Equal("Invalid Data.", (await _t.Form("/SA/SubmitPhotos", PhotoForm(Lead, section))).GetProperty("errorMessage").GetString());
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task Co_consultant_evidences_after_final_submit_are_refused()
    {
        _flags["FinalSubmissionDone"] = true;
        AssertFail(await _t.Json("/SA/SubmitEvidences", new { saId = Co, userType = 2, zedId = Zed, certificationType = "Silver", addedEvidences = new[] { Photo("e1") } }),
            "MSME SA Final Submit done for the ZEDID: " + Zed);
    }

    [Fact]
    public async Task Basic_information_passes_the_handholding_figures()
    {
        var p = new { unit = "kWh", totalConsumptionPercentage = "10" };
        var e = await _t.Json("/SA/SubmitBasicInformation", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            basicInformation = new
            {
                occupationalSafety = new { numOfAccidents = "1", numOfNearMisses = "2", manHoursLast = "3", lostTimeInjuryFrequencyRate = "4" },
                measurementOfTimelyDelivery = new { numOfDeliveries = "5", numOfDeliveriesOnTimeInFull = "6" },
                plannedMaintenanceCalibration = new { meanTimeToRepair = "7", meanTimeBetweenFailure = "8" },
                energyManagement = new { electrical = p, solar = p, wind = p, fossilFuel = p, gas = p, others = new { unit = "L", totalConsumptionPercentage = "9" }, totalCost = "100", measuresTaken = "LED" },
                environmentManagement = new { cox = "c", nox = "n", sox = "s", noiseLevel = "60", measuresTaken = "env" },
                humanResourceManagement = new { employeesEngagedInActivities = "50", noOfSuggestions = "3", measuresTaken = "hr" },
                measurementAnalysis = new { defects = "1", costOfPoorQuality = "2" },
                naturalResourcesManagement = new { water = "w", noOfTreePlanted = "12", measuresTaken = "nrm" },
                financialPerformance = new { turnover = "1000", grossProfit = "100" },
            },
        });
        AssertOk(e);
        var args = _t.LastArgs("SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO");
        Assert.Equal("1", ConsultancyAppHost.Arg(args, "NumOfAccidents"));
        Assert.Equal("6", ConsultancyAppHost.Arg(args, "NumOfDeliveriesOnTimeInFull"));
        Assert.Equal("L", ConsultancyAppHost.Arg(args, "Others_unit"));
        Assert.Equal("9", ConsultancyAppHost.Arg(args, "Others_TotalConsumptionPercentage"));
        Assert.Equal("LED", ConsultancyAppHost.Arg(args, "EnergyMgmtMeasuresTaken"));
        Assert.Equal("env", ConsultancyAppHost.Arg(args, "EnviMgmtMeasuresTaken"));
        Assert.Equal("hr", ConsultancyAppHost.Arg(args, "HrmMeasuresTaken"));
        Assert.Equal("nrm", ConsultancyAppHost.Arg(args, "NrmMeasuresTaken"));
        Assert.Equal("12", ConsultancyAppHost.Arg(args, "NoOfTreePlanted"));
        Assert.Equal("100", ConsultancyAppHost.Arg(args, "GrossProfit"));
        Assert.Matches("^[0-9]{14}$", ConsultancyAppHost.Arg(args, "RefId")!);
    }

    [Fact]
    public async Task Basic_information_with_a_missing_group_fails_as_before_and_without_a_sender_is_refused()
    {
        AssertFail(await _t.Json("/SA/SubmitBasicInformation", new { saId = Lead, zedId = Zed, certificationType = "Silver", basicInformation = new { } }),
            ConsultancySAController.ErrorText);
        AssertFail(await _t.Json("/SA/SubmitBasicInformation", new { saId = Lead, zedId = Zed, certificationType = "Silver" }), "No data found.");
        AssertFail(await _t.Json("/SA/SubmitBasicInformation", new { zedId = Zed, certificationType = "Silver", basicInformation = new { } }),
            ConsultancySAController.NotAllocated + Zed);
        Assert.Empty(_t.CallsTo("SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO"));
    }

    // ---------------------------------------------------------------- Milestone parameter screens

    [Fact]
    public async Task Baseline_diagnostic_sends_conformance_gaps_and_captured_photos()
    {
        AssertOk(await _t.Json("/SA/SubmitBaselineDiagnostic", Parameter(Lead, Requirement())));
        var args = _t.LastArgs("SP_APP_SA_SAVE_PARAMETER");
        Assert.Equal("BaselineDiagnostic", ConsultancyAppHost.Arg(args, "PhotoType"));
        Assert.Equal("1", ConsultancyAppHost.Arg(args, "ParameterCode"));
        var req = AssessorTestHost.Tvp(args, "RequirementsList")!;
        Assert.Equal(["210", "R1", "True", "remark"], req.Rows[0].ItemArray.Select(x => x?.ToString()));
        var bullets = AssessorTestHost.Tvp(args, "BulletList")!;
        Assert.Equal([("210", "Gap A"), ("210", "Gap B")], bullets.Rows.Cast<System.Data.DataRow>().Select(r => (r[0].ToString(), r[1].ToString())));
        var photos = AssessorTestHost.Tvp(args, "PhotoList")!;
        Assert.Equal(["c1"], photos.Rows.Cast<System.Data.DataRow>().Select(r => r["PhotoId"].ToString()));
        Assert.Equal("210", photos.Rows[0]["PhotoType"]);
    }

    [Fact]
    public async Task Handholding_action_plan_sends_days_activities_and_both_photo_lists()
    {
        AssertOk(await _t.Json("/SA/SubmitHandholdingActionPlan", Parameter(Co, Requirement())));
        var args = _t.LastArgs("SP_APP_SA_SAVE_PARAMETER");
        Assert.Equal("HandholdingActionPlan", ConsultancyAppHost.Arg(args, "PhotoType"));
        Assert.Equal("30", AssessorTestHost.Tvp(args, "RequirementsList")!.Rows[0]["Conformance"]);
        Assert.Equal("Train", AssessorTestHost.Tvp(args, "BulletList")!.Rows[0]["Designation"]);
        Assert.Equal(["a1", "c1"], AssessorTestHost.Tvp(args, "PhotoList")!.Rows.Cast<System.Data.DataRow>().Select(r => r["PhotoId"].ToString()));
    }

    [Fact]
    public async Task Technology_intervention_sends_the_rationale_as_requirement_code()
    {
        AssertOk(await _t.Json("/SA/SubmitTechnologyIntervention", Parameter(Lead, Requirement())));
        var args = _t.LastArgs("SP_APP_SA_SAVE_PARAMETER");
        var row = AssessorTestHost.Tvp(args, "RequirementsList")!.Rows[0];
        Assert.Equal("Use IoT", row["RequirementCode"]);
        Assert.Equal("Conformance", row["Conformance"]);
        Assert.Equal("Sensors", AssessorTestHost.Tvp(args, "BulletList")!.Rows[0]["Designation"]);
        Assert.Equal(["a1"], AssessorTestHost.Tvp(args, "PhotoList")!.Rows.Cast<System.Data.DataRow>().Select(r => r["PhotoId"].ToString()));
    }

    [Fact]
    public async Task Progress_review_sends_completion_and_no_bullets()
    {
        AssertOk(await _t.Json("/SA/SubmitProgressReview", Parameter(Lead, Requirement())));
        var args = _t.LastArgs("SP_APP_SA_SAVE_PARAMETER");
        Assert.Equal("ProgressReview", ConsultancyAppHost.Arg(args, "PhotoType"));
        Assert.Equal("Yes", AssessorTestHost.Tvp(args, "RequirementsList")!.Rows[0]["Conformance"]);
        Assert.Null(AssessorTestHost.Tvp(args, "BulletList"));
        Assert.Equal(["c1"], AssessorTestHost.Tvp(args, "PhotoList")!.Rows.Cast<System.Data.DataRow>().Select(r => r["PhotoId"].ToString()));
    }

    [Fact]
    public async Task A_parameter_screen_without_requirements_fails_as_before()
    {
        AssertFail(await _t.Json("/SA/SubmitBaselineDiagnostic", new { saId = Lead, zedId = Zed, certificationType = "Silver" }), ConsultancySAController.ErrorText);
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PARAMETER"));
    }

    [Fact]
    public async Task A_failing_procedure_returns_the_fixed_text()
    {
        _t.Sql.Failing["SP_APP_SA_SAVE_PARAMETER"] = true;
        var e = await _t.Json("/SA/SubmitBaselineDiagnostic", Parameter(Lead, Requirement()));
        AssertFail(e, ConsultancySAController.ErrorText);
        Assert.DoesNotContain("internal detail", e.GetRawText());
    }

    // ---------------------------------------------------------------- Training, sync status, meetings

    [Theory]
    [InlineData("SubmitZedTrainingInfo", "ZedTraining")]
    [InlineData("SubmitHouseholdingTrainingInfo", "HouseholdingTraining")]
    public async Task Training_info_is_recorded_with_its_type(string action, string type)
    {
        var e = await _t.Json("/SA/" + action, new
        {
            saId = Co, zedId = Zed, certificationType = "Silver",
            trainingInfo = new
            {
                trainingTopic = "ZED basics", trainingDate = "01/02/2024", trainingTime = "10:00", remarks = "r",
                trainingPhoto = new[] { new { photoId = "tp1", isPdf = false } }, attendanceSheet = new[] { new { photoId = "as1", isPdf = true } },
            },
        });
        AssertOk(e);
        var args = _t.LastArgs("SP_APP_SA_CONSULTANCY_TRAINING_INFO");
        Assert.Equal(type, ConsultancyAppHost.Arg(args, "TrainingType"));
        Assert.Equal(Co, ConsultancyAppHost.Arg(args, "AssessorId"));
        Assert.Equal("ZED basics", ConsultancyAppHost.Arg(args, "TrainingTopic"));
        var photos = AssessorTestHost.Tvp(args, "TrainingPhotos")!;
        Assert.Equal([("tp1", "Training Photo", "jpg"), ("as1", "Attendance Sheet", "pdf")],
            photos.Rows.Cast<System.Data.DataRow>().Select(r => (r["PhotoId"].ToString(), r["Name"].ToString(), r["PhotoType"].ToString())));
        Assert.Empty(_t.CallsTo("SP_SA_APP_CHECK_STATUS"));

        AssertFail(await _t.Json("/SA/" + action, new { saId = Co, zedId = Zed, certificationType = "Silver" }), "No data found.");
    }

    [Fact]
    public async Task Sync_status_answers_for_the_role_sent()
    {
        var lead = await _t.Json("/SA/CheckParameterSyncStatus", new { saId = Lead, zedId = Zed, certificationType = "Silver", userType = 1 });
        AssertOk(lead);
        Assert.True(lead.GetProperty("AllParametersSynced").GetBoolean());
        var co = await _t.Json("/SA/CheckParameterSyncStatus", new { saId = Co, zedId = Zed, certificationType = "Silver", userType = 2 });
        Assert.False(co.GetProperty("AllParametersSynced").GetBoolean());
    }

    [Fact]
    public async Task Closing_meeting_is_the_leads_and_final_submit_the_co_consultants()
    {
        _flags["AllParametersSyncedByCo"] = true;
        AssertNotAllotted(await _t.Json("/SA/SubmitEndAssessment", new { saId = Co, zedId = Zed, certificationType = "Silver", userType = 1 }),
            "SP_SA_APP_INSERT_OPEN_MEETING");
        AssertNotAllotted(await _t.Json("/SA/SubmitEndAssessment", new { saId = Lead, zedId = Zed, certificationType = "Silver", userType = 2 }),
            "SP_SA_APP_INSERT_OPEN_MEETING");
        AssertOk(await _t.Json("/SA/SubmitEndAssessment", new { saId = Co, zedId = Zed, certificationType = "Silver", userType = 2, endComment = "done" }));
        Assert.Equal("Final Submit", ConsultancyAppHost.Arg(_t.LastArgs("SP_SA_APP_INSERT_OPEN_MEETING"), "PhotoType"));

        AssertFail(await _t.Json("/SA/SubmitEndAssessment", new { saId = Lead, zedId = Zed, certificationType = "Silver", userType = 1 }),
            "Final submissions not synced yet by Assessors for the ZEDID: " + Zed);
        _flags["FinalSubmissionDone"] = true;
        AssertOk(await _t.Json("/SA/SubmitEndAssessment", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", userType = 1, assessmentPhotos = new[] { Photo("cm1", "Closing Meeting Photo") },
        }));
        Assert.Equal("Close Meeting", ConsultancyAppHost.Arg(_t.LastArgs("SP_SA_APP_INSERT_OPEN_MEETING"), "PhotoType"));
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Closing Meeting Photo_cm1.jpg")));
    }

    [Fact]
    public async Task Open_meeting_twice_gets_the_old_text()
    {
        AssertFail(await _t.Json("/SA/SubmitStartAssessment", new { saId = Lead, zedId = Zed, certificationType = "Silver" }),
            "MSME SA Open Meeting Submitted for the ZEDID: " + Zed);
    }

    [Fact]
    public async Task Allocation_by_the_lead_to_team_members_only()
    {
        AssertOk(await _t.Json("/SA/SubmitAllocation", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            allocatedParameters = new[] { new { parameterId = "1", parameterCode = "1", assigneeId = Co } },
        }));
        Assert.Equal(Co, AssessorTestHost.Tvp(_t.LastArgs("SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR"), "AllotList")!.Rows[0]["AssessorId"]);
        AssertFail(await _t.Json("/SA/SubmitAllocation", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            allocatedParameters = new[] { new { parameterId = "1", parameterCode = "1", assigneeId = Other } },
        }), ConsultancySAController.NotAllocated + Zed);
    }

    // ---------------------------------------------------------------- Multipart uploads

    [Fact]
    public async Task SubmitPhotos_saves_the_file_with_a_fixed_extension_and_records_it()
    {
        var e = await _t.Form("/SA/SubmitPhotos", PhotoForm(Lead, "Training on ZED"));
        AssertOk(e);
        Assert.Equal("ph1.jpg", e.GetProperty("fileName").GetString());
        Assert.Equal($"{Zed}\\Silver\\Training on ZED\\ph1.jpg", e.GetProperty("filePath").GetString());
        Assert.Equal(["status", "errorMessage", "filePath", "fileName"], e.EnumerateObject().Select(p => p.Name));
        Assert.Equal("file-bytes", File.ReadAllText(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Training on ZED", "ph1.jpg")));
        Assert.Single(_t.AllFiles());

        var args = _t.LastArgs("SP_APP_SA_SAVE_PHOTOS");
        Assert.Equal("Training on ZED", ConsultancyAppHost.Arg(args, "PhotoType"));
        Assert.Equal(Lead, ConsultancyAppHost.Arg(args, "AssessorId"));
        Assert.Equal("Gate", AssessorTestHost.Tvp(args, "PhotoList")!.Rows[0]["Name"]);

        AssertOk(await _t.Form("/SA/SubmitPhotos", PhotoForm(Lead, "Training on ZED", "doc1", isPdf: true)));
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Training on ZED", "doc1.pdf")));
    }

    [Fact]
    public async Task SubmitPhotos_without_a_file_gets_the_old_text_and_a_bad_photo_id_is_refused()
    {
        var form = new MultipartFormDataContent { { new StringContent(Lead), "userName" }, { new StringContent(Zed), "zedId" },
            { new StringContent("Silver"), "certificationType" }, { new StringContent("SiteTour"), "sectionName" } };
        AssertFail(await _t.Form("/SA/SubmitPhotos", form), "No photos found.");
        AssertFail(await _t.Form("/SA/SubmitPhotos", PhotoForm(Lead, "SiteTour", "../../web")), "Invalid Data.");
        Assert.Empty(_t.AllFiles());
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
    }

    [Fact]
    public async Task Attendance_selfie_is_saved_as_jpg_whatever_the_client_name()
    {
        var e = await _t.Form("/SA/SubmitAttendance", AttendanceForm(Lead));
        AssertOk(e);
        Assert.Equal("LOGIN ATTENDANCE SUBMITTED SUCCESSFULLY", e.GetProperty("errorMessage").GetString());
        Assert.Equal("selfie", File.ReadAllText(_t.FileUnderRoot("Attendance", Zed, "Silver", "att1.jpg")));
        Assert.Single(_t.AllFiles());
        var args = _t.LastArgs("SP_APP_SA_INSERT_DAILY_ATTENDANCE");
        Assert.Equal("att1", ConsultancyAppHost.Arg(args, "PhotoId"));
        Assert.Equal("LOGIN", ConsultancyAppHost.Arg(args, "AttendanceType"));
        Assert.Equal("on site", ConsultancyAppHost.Arg(args, "Comments"));
        Assert.Equal(Lead, ConsultancyAppHost.Arg(args, "AssessorId"));
    }

    [Fact]
    public async Task Attendance_without_selfie_or_metadata_fails_as_before()
    {
        AssertFail(await _t.Form("/SA/SubmitAttendance", AttendanceForm(Lead, withFile: false)), "Consultant selfie data not found.");
        AssertFail(await _t.Form("/SA/SubmitAttendance", AttendanceForm(Lead, metadata: "not json")), ConsultancySAController.ErrorText);
        AssertFail(await _t.Form("/SA/SubmitAttendance", AttendanceForm(Lead, metadata: """{"photoId":"../x"}""")), "Invalid Data.");
        Assert.Empty(_t.AllFiles());
        Assert.Empty(_t.CallsTo("SP_APP_SA_INSERT_DAILY_ATTENDANCE"));
    }

    // ---------------------------------------------------------------- Procedure contract (ZED_CONSULTANT)

    /// <summary>sys.parameters of ZED_CONSULTANT, checked when this port was written.</summary>
    private static readonly Dictionary<string, string[]> ConsultantProcedures = new(StringComparer.OrdinalIgnoreCase)
    {
        ["SP_SA_APP_CHECK_STATUS"] = ["ZedId", "Certification", "AssessorId"],
        ["SP_APP_SA_SAVE_PHOTOS"] = ["ZedId", "AssessorId", "PhotoType", "CertificationType", "RefId", "EvidenceId", "PhotoList"],
        ["SP_APP_SA_SAVE_PARAMETER"] = ["ZedId", "AssessorId", "ParameterId", "ParameterCode", "CertificationType", "Phototype", "PhotoList", "RequirementsList", "BulletList"],
        ["SP_APP_SA_CONSULTANCY_TRAINING_INFO"] = ["RefId", "ZedId", "CertificationType", "TrainingTopic", "TrainingDate", "TrainingTime", "Remarks", "TrainingType", "AssessorId", "TrainingPhotos"],
        ["SP_APP_SA_INSERT_DAILY_ATTENDANCE"] = ["RefId", "ZedId", "AssessorId", "CertificationType", "PhotoId", "TimeStamp", "Latitude", "Longitude", "PhotoPath", "AttendanceType", "Comments"],
        ["SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR"] = ["ZedId", "CertificationType", "AllotList"],
        ["SP_APP_SA_SAVE_OFI_COMMENTS"] = ["ZedId", "AssessorId", "ParameterId", "ParameterCode", "CertificationType", "OfiComments", "PhotoList", "RequirementsList"],
        ["SP_SA_APP_INSERT_OPEN_MEETING"] = ["RefId", "ZedId", "AssessorId", "CertificationType", "PhotoType", "Latitude", "Longitude", "Comments", "ParticipantsList", "PhotoList"],
    };

    [Fact]
    public async Task Every_procedure_call_uses_only_parameters_the_ZED_CONSULTANT_procedure_has()
    {
        _flags["AllParametersSyncedByCo"] = true;
        AssertOk(await _t.Json("/SA/SubmitSelfie", new { saId = Co, zedId = Zed, certificationType = "Silver", selfie = Photo("s1", "Selfie") }));
        AssertOk(await _t.Json("/SA/SubmitBaselineDiagnostic", Parameter(Lead, Requirement())));
        AssertOk(await _t.Json("/SA/SubmitZedTrainingInfo", new
        {
            saId = Co, zedId = Zed, certificationType = "Silver",
            trainingInfo = new { trainingTopic = "t", trainingPhoto = new[] { new { photoId = "tp1" } } },
        }));
        AssertOk(await _t.Form("/SA/SubmitAttendance", AttendanceForm(Lead)));
        AssertOk(await _t.Json("/SA/SubmitAllocation", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            allocatedParameters = new[] { new { parameterId = "1", parameterCode = "1", assigneeId = Co } },
        }));
        AssertOk(await _t.Json("/SA/SubmitOfiComments", new { saId = Lead, zedId = Zed, certificationType = "Silver", parameterId = "1", parameterCode = "1", ofiComments = "x" }));
        AssertOk(await _t.Json("/SA/SubmitEndAssessment", new { saId = Co, zedId = Zed, certificationType = "Silver", userType = 2 }));

        foreach (var (name, args) in _t.Fake.Calls)
        {
            if (!ConsultantProcedures.TryGetValue(name, out var allowed)) continue;
            var names = args is Dapper.DynamicParameters dp ? dp.ParameterNames : args!.GetType().GetProperties().Select(p => p.Name);
            foreach (var n in names) Assert.Contains(n, allowed, StringComparer.OrdinalIgnoreCase);
        }
        Assert.All(ConsultantProcedures.Keys, k => Assert.NotEmpty(_t.CallsTo(k)));
    }
}
