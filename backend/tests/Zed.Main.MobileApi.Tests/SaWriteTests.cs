using System.Text.Json;
using Zed.Core.Mobile;

namespace Zed.Main.MobileApi.Tests;

public sealed class SaWriteTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Lead = "ZEDAS0001";
    private const string Co = "ZEDAS0002";
    private const string Other = "ZEDAS0099";
    private readonly AssessorTestHost _t = new();
    private readonly Dictionary<string, object?> _flags = new()
    {
        ["SaStatus"] = 1, ["OpenMeetingSubmitted"] = true, ["AllParametersSyncedByLead"] = true, ["AllParametersSyncedByCo"] = true,
        ["FinalSubmissionDone"] = false, ["ClosingMeetingSubmitted"] = false, ["LeadAssessor"] = true,
    };

    public SaWriteTests()
    {
        _t.Sql.Allot(Zed, "Silver", Lead, Co);
        _t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>(_flags)]);
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

    private void AssertNotAllotted(JsonElement e, string proc)
    {
        AssertFail(e, "Site Assessment data not yet allocated for the ZEDID: " + Zed);
        Assert.Empty(_t.CallsTo(proc));
        Assert.Empty(_t.AllFiles());
    }

    // ---------------------------------------------------------------- SubmitAllocation

    [Fact]
    public async Task Allocation_by_the_lead_passes_the_assignees()
    {
        var e = await _t.Json("/SA/SubmitAllocation", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            allocatedParameters = new object[]
            {
                new { parameterId = "1", parameterCode = "1", assigneeId = Co },
                new { parameterId = "2", parameterCode = "2", assigneeId = Lead },
                new { parameterId = "3", parameterCode = "3", assigneeId = "" },
            },
        });
        AssertOk(e);
        var args = _t.LastArgs("SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR");
        Assert.Equal(Zed, AssessorTestHost.Arg(args, "ZedId"));
        var rows = AssessorTestHost.Tvp(args, "AllotList")!;
        Assert.Equal(2, rows.Rows.Count);
        Assert.Equal(["0", "1", "1", Co], rows.Rows[0].ItemArray.Select(x => x?.ToString()));
    }

    [Fact]
    public async Task Allocation_by_the_co_assessor_or_another_assessor_is_refused()
    {
        foreach (var sa in new[] { Co, Other })
        {
            var e = await _t.Json("/SA/SubmitAllocation", new
            {
                saId = sa, zedId = Zed, certificationType = "Silver",
                allocatedParameters = new[] { new { parameterId = "1", parameterCode = "1", assigneeId = Co } },
            });
            AssertNotAllotted(e, "SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR");
        }
    }

    [Fact]
    public async Task Allocation_to_an_assessor_not_on_the_unit_is_refused()
    {
        var e = await _t.Json("/SA/SubmitAllocation", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            allocatedParameters = new[] { new { parameterId = "1", parameterCode = "1", assigneeId = Other } },
        });
        AssertNotAllotted(e, "SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR");
    }

    [Fact]
    public async Task Allocation_with_no_assignee_fails_as_before()
    {
        var e = await _t.Json("/SA/SubmitAllocation", new { saId = Lead, zedId = Zed, certificationType = "Silver", allocatedParameters = Array.Empty<object>() });
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Empty(_t.CallsTo("SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR"));
    }

    // ---------------------------------------------------------------- SubmitSelfie

    [Fact]
    public async Task Selfie_is_stored_in_the_old_folder_and_recorded()
    {
        var e = await _t.Json("/SA/SubmitSelfie", new { saId = Co, zedId = Zed, certificationType = "Silver", selfieImage = Photo("s1", "Selfie") });
        AssertOk(e);
        Assert.Equal(new[] { "status", "errorMessage", "refId", "token" }, e.EnumerateObject().Select(p => p.Name));
        Assert.Equal("hello", File.ReadAllText(_t.FileUnderRoot("SaPhotos", Zed, "Silver", Co + ".jpg")));
        var args = _t.LastArgs("SP_APP_SA_SAVE_PHOTOS");
        Assert.Equal("Selfie", AssessorTestHost.Arg(args, "PhotoType"));
        Assert.Equal(Co, AssessorTestHost.Arg(args, "AssessorId"));
        Assert.Equal("s1", AssessorTestHost.Tvp(args, "PhotoList")!.Rows[0]["PhotoId"]);
    }

    [Fact]
    public async Task Selfie_for_another_assessors_unit_is_refused()
    {
        var e = await _t.Json("/SA/SubmitSelfie", new { saId = Other, zedId = Zed, certificationType = "Silver", selfieImage = Photo("s1") });
        AssertNotAllotted(e, "SP_APP_SA_SAVE_PHOTOS");
        // Same assessor, but a certification it is not allotted to.
        e = await _t.Json("/SA/SubmitSelfie", new { saId = Lead, zedId = Zed, certificationType = "Gold", selfieImage = Photo("s1") });
        AssertNotAllotted(e, "SP_APP_SA_SAVE_PHOTOS");
    }

    [Fact]
    public async Task Selfie_gets_the_old_status_messages()
    {
        _flags["OpenMeetingSubmitted"] = false;
        AssertFail(await _t.Json("/SA/SubmitSelfie", new { saId = Lead, zedId = Zed, certificationType = "Silver", selfieImage = Photo("s1") }),
            "MSME SA Open Meeting not Submitted for the ZEDID: " + Zed);
        _flags["ClosingMeetingSubmitted"] = true;
        AssertFail(await _t.Json("/SA/SubmitSelfie", new { saId = Lead, zedId = Zed, certificationType = "Silver", selfieImage = Photo("s1") }),
            "MSME SA Closing Meeting Submitted, hence SA is deemed completed for the ZEDID: " + Zed);
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task Selfie_refuses_path_traversal_in_every_path_value()
    {
        // A unit id with path characters can only get past the allotment check if such a row exists.
        _t.Sql.Allot("..\\..\\x", "Silver", Lead);
        _t.Sql.Allot(Zed, "..\\Silver", Lead);
        var requests = new object[]
        {
            new { saId = "..\\..\\evil", zedId = Zed, certificationType = "Silver", selfieImage = Photo("s1") },
            new { saId = Lead, zedId = "..\\..\\x", certificationType = "Silver", selfieImage = Photo("s1") },
            new { saId = Lead, zedId = Zed, certificationType = "..\\Silver", selfieImage = Photo("s1") },
        };
        _t.Sql.Allot(Zed, "Silver", "..\\..\\evil");
        foreach (var r in requests)
        {
            var e = await _t.Json("/SA/SubmitSelfie", r);
            Assert.Equal("0", e.GetProperty("status").GetString());
        }
        Assert.Empty(_t.AllFiles());
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
    }

    [Fact]
    public async Task Enforce_mode_refuses_a_write_from_an_unknown_device()
    {
        _t.Settings["Mobile:DeviceBinding"] = "Enforce";
        await _t.Devices.RememberAsync(MobileApps.SiteAssessor, Lead, new DeviceInfo { deviceId = "sa-phone" }, null);
        var refused = await _t.Json("/SA/SubmitSelfie", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", selfieImage = Photo("s1"), deviceInfo = new { deviceId = "attacker" },
        });
        Assert.Contains("not registered", refused.GetProperty("errorMessage").GetString());
        Assert.Empty(_t.AllFiles());
        var ok = await _t.Json("/SA/SubmitSelfie", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", selfieImage = Photo("s1"), deviceInfo = new { deviceId = "sa-phone" },
        });
        AssertOk(ok);
    }

    // ---------------------------------------------------------------- SubmitSiteTour

    [Fact]
    public async Task Site_tour_photos_are_stored_and_named_from_the_comment()
    {
        var e = await _t.Json("/SA/SubmitSiteTour", new
        {
            saId = Lead, zedId = Zed, certificationType = "silver", siteTourPhotos = new[] { Photo("t1"), Photo("t2", data: "") },
        });
        AssertOk(e);
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "silver", "SiteTour", "t1.jpg")));
        var rows = AssessorTestHost.Tvp(_t.LastArgs("SP_APP_SA_SAVE_PHOTOS"), "PhotoList")!;
        Assert.Equal(1, rows.Rows.Count);
        Assert.Equal("c-t1", rows.Rows[0]["Name"]);
        Assert.Equal("SiteTour", AssessorTestHost.Arg(_t.LastArgs("SP_APP_SA_SAVE_PHOTOS"), "PhotoType"));
    }

    [Fact]
    public async Task Site_tour_refuses_other_units_and_path_traversal()
    {
        AssertNotAllotted(await _t.Json("/SA/SubmitSiteTour", new { saId = Other, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { Photo("t1") } }),
            "SP_APP_SA_SAVE_PHOTOS");
        var e = await _t.Json("/SA/SubmitSiteTour", new { saId = Lead, zedId = Zed, certificationType = "Silver", siteTourPhotos = new[] { Photo("..\\..\\..\\evil") } });
        AssertFail(e, "Invalid Data.");
        Assert.Empty(_t.AllFiles());
    }

    // ---------------------------------------------------------------- SubmitParameter / SubmitOfiComments

    [Fact]
    public async Task Parameter_passes_requirements_and_linked_evidence_ids()
    {
        var e = await _t.Json("/SA/SubmitParameter", new
        {
            saId = Co, zedId = Zed, certificationType = "Silver",
            allottedParameterObj = new
            {
                parameterId = "1", parameterCode = "A1",
                requirements = new object[]
                {
                    new { id = 21, code = "R1", conformance = "True", comments = "fine", addedEvidences = new[] { Photo("e1"), Photo("") } },
                    new { id = 22, code = "R2", conformance = "False" },
                },
            },
        });
        AssertOk(e);
        var args = _t.LastArgs("SP_APP_SA_SAVE_PARAMETER");
        Assert.Equal("A1", AssessorTestHost.Arg(args, "ParameterCode"));
        Assert.Equal("Parameters", AssessorTestHost.Arg(args, "PhotoType"));
        var reqs = AssessorTestHost.Tvp(args, "RequirementsList")!;
        Assert.Equal(["21", "R1", "True", "fine"], reqs.Rows[0].ItemArray.Select(x => x?.ToString()));
        Assert.Equal("", reqs.Rows[1]["AssessorRemarks"]);
        var photos = AssessorTestHost.Tvp(args, "PhotoList")!;
        Assert.Equal(1, photos.Rows.Count);
        Assert.Equal("21", photos.Rows[0]["PhotoType"]);
    }

    [Fact]
    public async Task Parameter_and_ofi_comments_for_another_assessors_unit_are_refused()
    {
        AssertNotAllotted(await _t.Json("/SA/SubmitParameter", new
        {
            saId = Other, zedId = Zed, certificationType = "Silver",
            allottedParameterObj = new { parameterId = "1", parameterCode = "A1", requirements = new[] { new { id = 1, code = "R1", conformance = "True" } } },
        }), "SP_APP_SA_SAVE_PARAMETER");
        AssertNotAllotted(await _t.Json("/SA/SubmitOfiComments", new { saId = Other, zedId = Zed, certificationType = "Silver", parameterCode = "A1", ofiComments = "x" }),
            "SP_APP_SA_SAVE_OFI_COMMENTS");
    }

    [Fact]
    public async Task Ofi_comments_are_saved()
    {
        AssertOk(await _t.Json("/SA/SubmitOfiComments", new { saId = Lead, zedId = Zed, certificationType = "Silver", parameterId = "1", parameterCode = "A1", ofiComments = "improve" }));
        var args = _t.LastArgs("SP_APP_SA_SAVE_OFI_COMMENTS");
        Assert.Equal("improve", AssessorTestHost.Arg(args, "OfiComments"));
        Assert.Equal(Lead, AssessorTestHost.Arg(args, "AssessorId"));
    }

    // ---------------------------------------------------------------- Start / End assessment

    [Fact]
    public async Task Open_meeting_saves_photos_and_participants()
    {
        _flags["OpenMeetingSubmitted"] = false;
        var e = await _t.Json("/SA/SubmitStartAssessment", new
        {
            userType = 1, saId = Lead, zedId = Zed, certificationType = "Silver", latitude = "1", longitude = "2", inputComment = "start",
            assessmentPhotos = new[] { Photo("m1", "Exterior") },
            startParticipants = new[] { new { name = "A", designation = (string?)null } },
        });
        AssertOk(e);
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Exterior_m1.jpg")));
        var args = _t.LastArgs("SP_SA_APP_INSERT_OPEN_MEETING");
        Assert.Equal("Open Meeting", AssessorTestHost.Arg(args, "PhotoType"));
        Assert.Equal("start", AssessorTestHost.Arg(args, "Comments"));
        Assert.Equal("", AssessorTestHost.Tvp(args, "ParticipantsList")!.Rows[0]["Designation"]);
    }

    [Fact]
    public async Task Open_meeting_twice_gets_the_old_message_and_traversal_is_refused()
    {
        AssertFail(await _t.Json("/SA/SubmitStartAssessment", new { saId = Lead, zedId = Zed, certificationType = "Silver" }),
            "MSME SA Open Meeting Submitted for the ZEDID: " + Zed);
        _flags["OpenMeetingSubmitted"] = false;
        AssertFail(await _t.Json("/SA/SubmitStartAssessment", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver", assessmentPhotos = new[] { Photo("m1", "..\\..\\..\\x") },
        }), "Invalid Data.");
        AssertNotAllotted(await _t.Json("/SA/SubmitStartAssessment", new { saId = Other, zedId = Zed, certificationType = "Silver" }),
            "SP_SA_APP_INSERT_OPEN_MEETING");
    }

    [Fact]
    public async Task Co_assessor_final_submit_and_lead_closing_meeting()
    {
        AssertOk(await _t.Json("/SA/SubmitEndAssessment", new { userType = 2, saId = Co, zedId = Zed, certificationType = "Silver", endComment = "done" }));
        Assert.Equal("Final Submit", AssessorTestHost.Arg(_t.LastArgs("SP_SA_APP_INSERT_OPEN_MEETING"), "PhotoType"));

        _flags["FinalSubmissionDone"] = true;
        AssertOk(await _t.Json("/SA/SubmitEndAssessment", new
        {
            userType = 1, saId = Lead, zedId = Zed, certificationType = "Silver", endComment = "closed",
            assessmentPhotos = new[] { Photo("c1", "Closing") }, endParticipants = new[] { new { name = "B", designation = "CEO" } },
        }));
        Assert.Equal("Close Meeting", AssessorTestHost.Arg(_t.LastArgs("SP_SA_APP_INSERT_OPEN_MEETING"), "PhotoType"));
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "Closing_c1.jpg")));
    }

    [Fact]
    public async Task End_assessment_role_must_match_the_allotment()
    {
        // The co-assessor cannot close the assessment by claiming to be the lead, and the reverse.
        AssertNotAllotted(await _t.Json("/SA/SubmitEndAssessment", new { userType = 1, saId = Co, zedId = Zed, certificationType = "Silver" }),
            "SP_SA_APP_INSERT_OPEN_MEETING");
        AssertNotAllotted(await _t.Json("/SA/SubmitEndAssessment", new { userType = 2, saId = Lead, zedId = Zed, certificationType = "Silver" }),
            "SP_SA_APP_INSERT_OPEN_MEETING");
    }

    [Fact]
    public async Task End_assessment_gets_the_old_status_messages()
    {
        AssertFail(await _t.Json("/SA/SubmitEndAssessment", new { userType = 1, saId = Lead, zedId = Zed, certificationType = "Silver" }),
            "Final submissions not synced yet by Assessors for the ZEDID: " + Zed);
        _flags["AllParametersSyncedByCo"] = false;
        AssertFail(await _t.Json("/SA/SubmitEndAssessment", new { userType = 2, saId = Co, zedId = Zed, certificationType = "Silver" }),
            "All Parameters not synced yet for the ZEDID: " + Zed);
        _flags["FinalSubmissionDone"] = true;
        AssertFail(await _t.Json("/SA/SubmitEndAssessment", new { userType = 2, saId = Co, zedId = Zed, certificationType = "Silver" }),
            "MSME SA Final Submission done for the ZEDID: " + Zed);
    }

    [Fact]
    public async Task Closing_meeting_refuses_path_traversal()
    {
        _flags["FinalSubmissionDone"] = true;
        AssertFail(await _t.Json("/SA/SubmitEndAssessment", new
        {
            userType = 1, saId = Lead, zedId = Zed, certificationType = "Silver", assessmentPhotos = new[] { Photo("..\\..\\x", "a") },
        }), "Invalid Data.");
        Assert.Empty(_t.AllFiles());
    }

    // ---------------------------------------------------------------- Basic information

    [Fact]
    public async Task Basic_information_is_saved_with_products_and_raw_materials()
    {
        var e = await _t.Json("/SA/SubmitBasicInformation", new
        {
            saId = Lead, zedId = Zed, certificationType = "Silver",
            basicInformation = new
            {
                auditsConducted = "Yes", energySources = new[] { "Solar", "Grid" },
                productDetailsList = new[] { new { productName = "Bolt", exported = "No", productPhoto = Photo("pp1"), productDescriptionPhoto = Photo("pd1", isPdf: true) } },
                rawMaterialsList = new[] { new { rawMaterialName = "Steel", rawMaterialPercentage = "80", countryName = "India" } },
            },
        });
        AssertOk(e);
        var args = _t.LastArgs("SP_APP_SA_INSERT_BASIC_INFO");
        Assert.Equal("Solar,Grid", AssessorTestHost.Arg(args, "EnergySources"));
        Assert.Equal(["Bolt", "No", "pp1.jpg", "pd1.pdf"], AssessorTestHost.Tvp(args, "ProductList")!.Rows[0].ItemArray.Select(x => x?.ToString()));
        Assert.Equal("Product Photo", AssessorTestHost.Tvp(args, "ProductPhotos")!.Rows[0]["Name"]);
        Assert.Equal("pdf", AssessorTestHost.Tvp(args, "ProductDescriptionPhotos")!.Rows[0]["PhotoType"]);
        Assert.Equal("Steel", AssessorTestHost.Tvp(args, "RawMaterialList")!.Rows[0]["Name"]);
    }

    [Fact]
    public async Task Basic_information_checks_a_named_assessor_and_keeps_old_texts()
    {
        AssertNotAllotted(await _t.Json("/SA/SubmitBasicInformation", new
        {
            saId = Other, zedId = Zed, certificationType = "Silver", basicInformation = new { energySources = new[] { "x" } },
        }), "SP_APP_SA_INSERT_BASIC_INFO");
        AssertFail(await _t.Json("/SA/SubmitBasicInformation", new { saId = Lead, zedId = Zed, certificationType = "Silver" }), "No data found.");
        // No assessor named: cannot be checked, still served (logged).
        AssertOk(await _t.Json("/SA/SubmitBasicInformation", new { zedId = Zed, certificationType = "Silver", basicInformation = new { energySources = new[] { "x" } } }));
    }

    [Fact]
    public async Task Basic_info_photos_are_stored_as_jpg_or_pdf()
    {
        var e = await _t.Json("/SA/SubmitBasicInfoPhotos", new
        {
            userName = Lead, zedId = Zed, certificationType = "Silver", photos = new[] { Photo("b1"), Photo("b2", isPdf: true) },
        });
        AssertOk(e);
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "BasicInfo", "b1.jpg")));
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "BasicInfo", "b2.pdf")));
        AssertFail(await _t.Json("/SA/SubmitBasicInfoPhotos", new { userName = Lead, zedId = Zed, certificationType = "Silver" }), "No photos found.");
    }

    [Fact]
    public async Task Basic_info_photos_refuse_other_units_and_path_traversal()
    {
        AssertNotAllotted(await _t.Json("/SA/SubmitBasicInfoPhotos", new { userName = Other, zedId = Zed, certificationType = "Silver", photos = new[] { Photo("b1") } }),
            "SP_SA_APP_CHECK_STATUS");
        AssertFail(await _t.Json("/SA/SubmitBasicInfoPhotos", new { userName = Lead, zedId = Zed, certificationType = "Silver", photos = new[] { Photo("..\\..\\b1") } }),
            "Invalid Data.");
        AssertFail(await _t.Json("/SA/SubmitBasicInfoPhotos", new { userName = Lead, zedId = Zed, certificationType = "../../x", photos = new[] { Photo("b1") } }),
            "Invalid Data.");
        Assert.Empty(_t.AllFiles());
    }

    // ---------------------------------------------------------------- Evidences

    [Fact]
    public async Task Evidences_are_stored_in_the_site_tour_folder()
    {
        AssertOk(await _t.Json("/SA/SubmitEvidences", new { userType = 2, saId = Co, zedId = Zed, certificationType = "Silver", addedEvidences = new[] { Photo("ev1") } }));
        Assert.True(File.Exists(_t.FileUnderRoot("SaPhotos", Zed, "Silver", "SiteTour", "ev1.jpg")));
        Assert.Equal("Evidences", AssessorTestHost.Arg(_t.LastArgs("SP_APP_SA_SAVE_PHOTOS"), "PhotoType"));
        // Nothing to add: success without a database write, as before.
        _t.Fake.Calls.Clear();
        AssertOk(await _t.Json("/SA/SubmitEvidences", new { userType = 1, saId = Lead, zedId = Zed, certificationType = "Silver" }));
        Assert.Empty(_t.CallsTo("SP_APP_SA_SAVE_PHOTOS"));
    }

    [Fact]
    public async Task Evidences_keep_the_old_texts_and_refuse_other_units_and_traversal()
    {
        _flags["FinalSubmissionDone"] = true;
        AssertFail(await _t.Json("/SA/SubmitEvidences", new { userType = 2, saId = Co, zedId = Zed, certificationType = "Silver", addedEvidences = new[] { Photo("ev1") } }),
            "MSME SA Final Submit done for the ZEDID: " + Zed);
        AssertNotAllotted(await _t.Json("/SA/SubmitEvidences", new { userType = 1, saId = Other, zedId = Zed, certificationType = "Silver", addedEvidences = new[] { Photo("ev1") } }),
            "SP_APP_SA_SAVE_PHOTOS");
        AssertFail(await _t.Json("/SA/SubmitEvidences", new { userType = 1, saId = Lead, zedId = Zed, certificationType = "Silver", addedEvidences = new[] { Photo("../../ev1") } }),
            "Invalid Data.");
        Assert.Empty(_t.AllFiles());
    }

    // ---------------------------------------------------------------- Database errors

    [Fact]
    public async Task A_database_error_is_a_status_0_answer_without_its_text()
    {
        _t.Sql.Failing["SP_APP_SA_SAVE_OFI_COMMENTS"] = true;
        var (body, _, status) = await _t.Post("/SA/SubmitOfiComments", new { saId = Lead, zedId = Zed, certificationType = "Silver", parameterCode = "A1" });
        Assert.Equal(200, status);
        AssertFail(body, "An error has occurred, please try again later.");
        Assert.DoesNotContain("stored procedure", body.GetRawText());
    }
}
