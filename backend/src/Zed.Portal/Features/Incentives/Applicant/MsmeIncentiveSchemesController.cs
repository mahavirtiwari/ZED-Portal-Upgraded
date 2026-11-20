using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Msme.Schemes;
using Zed.Portal.Features.Staff.Schemes;
using static Zed.Portal.Features.Incentives.Applicant.ApplicantForm;
using static Zed.Portal.Features.Incentives.SchemeEligibility;
using Row = Zed.Portal.Features.Incentives.SchemeApplications.Row;

namespace Zed.Portal.Features.Incentives.Applicant;

/// <summary>
/// The applicant side of the incentive schemes (2026-11-20, approved design): the dashboard tiles of the Admin's schemes (and
/// the Technology Upgradation card's direct scheme, the Financial Assistance card's "Activates after"), and one scheme's page:
/// the draft for the open claim window, the plain sections and the "Add more" items saved one by one, the documents, the bank
/// block, the submission (claim and eligible amount computed here, documents recorded as FinancialAssistancePhotos rows, then
/// <see cref="ISchemeWorkflow.AfterSubmitAsync"/>), and the answers to a correction round. One application in progress per
/// scheme; the ZED ID always comes from the sign-in.
/// </summary>
[Route("api/msme/incentive-schemes")]
public sealed class MsmeIncentiveSchemesController(
    ISqlExecutor db,
    SchemeStore store,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<MsmeIncentiveSchemesController> log) : MsmeApiController
{
    public const string TuCard = "TECHNOLOGY_UPGRADATION";
    public const string FaCard = "FINANCIAL_ASSISTANCE";

    /// <summary>Masters → Technologies (main), active ones, of the unit's 2-digit NIC sector (as SP_TECHNOLOGIES_GET_LIST) when filtered.</summary>
    public const string TechnologiesSql =
        "SELECT TechnologyCode AS Code, TechnologyName AS Name, Description FROM dbo.Technologies WHERE IsActive = 1 AND TechnologyCode IS NOT NULL " +
        "AND (@Filter = 0 OR Sectors IS NULL OR (@Sector IS NOT NULL AND CHARINDEX(@Sector, Sectors) > 0)) ORDER BY OrderNo, TechnologyCode;";

    /// <summary>The answers of a draft (or of an application in correction).</summary>
    public const string SaveAnswersSql =
        "UPDATE dbo.FinancialAssistance SET FormAnswers = @FormAnswers WHERE Id = @Id AND ZedId = @ZedId AND SchemeStatus = @Status;";

    /// <summary>The documents of an application as FinancialAssistancePhotos rows (replaced as a whole), from a JSON list.</summary>
    private const string PhotosSql =
        "DELETE FROM dbo.FinancialAssistancePhotos WHERE FinancialAssistanceId = @Id AND CertificationType = @SchemeCode;\n" +
        "INSERT INTO dbo.FinancialAssistancePhotos (ZedId, PhotoId, Name, TimeStamp, Latitude, Longitude, PhotoType, CreatedDate, CertificationType, FinancialAssistanceId) " +
        "SELECT @ZedId, d.PhotoId, d.Name, d.TimeStamp, ' ', ' ', d.PhotoType, GETDATE(), @SchemeCode, @Id " +
        "FROM OPENJSON(@Documents) WITH (PhotoId varchar(50) '$.photoId', Name varchar(200) '$.name', TimeStamp varchar(50) '$.timeStamp', PhotoType varchar(50) '$.photoType') d;";

    /// <summary>Submits a draft: answers, the window's level / certificate / grade, the amounts, the bank account and the documents.</summary>
    public const string SubmitSql =
        "SET XACT_ABORT ON;\nBEGIN TRAN;\n" +
        "UPDATE dbo.FinancialAssistance SET FormAnswers = @FormAnswers, SchemeStatus = 'Submitted', VerificationStatus = 1, SubmittedOn = GETDATE(), " +
        "SchemeLevel = @SchemeLevel, SchemeCertNo = @SchemeCertNo, SharePercent = @SharePercent, MaxAmount = @MaxAmount, " +
        "ClaimAmount = @ClaimAmount, AmountPaid = @AmountPaid, EligibleAmount = @EligibleAmount, " +
        "AccountNo = @AccountNo, IfscCode = @IfscCode, BranchAddress = @BranchAddress, BankName = @BankName, CorrectionRound = 0 " +
        "WHERE Id = @Id AND ZedId = @ZedId AND SchemeStatus = 'Draft';\n" +
        "DECLARE @Updated int = @@ROWCOUNT;\nIF @Updated = 1\nBEGIN\n" + PhotosSql + "\nEND\nCOMMIT;\nSELECT @Updated;";

    /// <summary>Answers a correction round: back to the assessor (Verifying), the corrected answers, account and documents.</summary>
    public const string CorrectionSql =
        "SET XACT_ABORT ON;\nBEGIN TRAN;\n" +
        "UPDATE dbo.FinancialAssistance SET FormAnswers = @FormAnswers, SchemeStatus = 'Verifying', VerificationStatus = 2, " +
        "AccountNo = @AccountNo, IfscCode = @IfscCode, BranchAddress = @BranchAddress, BankName = @BankName " +
        "WHERE Id = @Id AND ZedId = @ZedId AND SchemeStatus = 'Correction';\n" +
        "DECLARE @Updated int = @@ROWCOUNT;\nIF @Updated = 1\nBEGIN\n" + PhotosSql + "\nEND\nCOMMIT;\nSELECT @Updated;";

    // ----- responses -----

    public sealed record GradeDto(decimal SharePercent, decimal MaxAmount);

    /// <summary>A dashboard tile of a scheme.</summary>
    /// <param name="State">locked, open, progress, onhold or availed.</param>
    /// <param name="Note">Why it is locked (a reason key: notEligible, notCertified, levelNotCovered, handholding).</param>
    public sealed record SchemeTileDto(string Code, string Title, string? Highlight, string? Details, string Icon, string State, string? Note,
        string? Message, int? ApplicationId, string? Status, string? Level, GradeDto? Grade, string ActivationMode, IReadOnlyList<string> ActivationLevels);

    /// <param name="Direct">The card opens the direct scheme (no consultant's recommendation needed).</param>
    /// <param name="Scheme">The direct scheme's tile: while the card is direct, or (the card back on the recommendation) while the
    /// unit's application of the direct scheme is not final.</param>
    /// <param name="Legacy">A consultant-recommended Technology Upgradation application of the unit is in progress (the old page).</param>
    public sealed record TuDto(bool Direct, SchemeTileDto? Scheme, bool Legacy = false);

    /// <param name="Scheme">2026-11-20: the Financial Assistance scheme's tile (<see cref="SchemeTemplates.FaCode"/>), the card opens it.</param>
    /// <param name="Legacy">An application made before the framework is in progress: the card shows it and opens the old page.</param>
    public sealed record FaDto(SchemeTileDto? Scheme, bool Legacy);

    public sealed record DashboardDto(IReadOnlyList<SchemeTileDto> Schemes, TuDto Tu, FaDto Fa);

    /// <param name="Disclaimer">The scheme's own disclaimer (plain text), or null: the global Texts wording.</param>
    public sealed record SchemeDto(string Code, string Name, SchemeCard Card, SchemeBlocks Blocks, IReadOnlyList<FormSection> Sections,
        IReadOnlyList<DocumentRule> Rules, SchemeGrading Grading, string ActivationMode, IReadOnlyList<string> ActivationLevels, int CorrectionRounds, int CorrectionDays,
        string? Disclaimer = null, string? Instructions = null, string? Declaration = null);

    public sealed record WindowDto(string Level, string CertRef, string? OpenedOn, GradeDto? Grade);

    public sealed record CheckDto(string Path, string? Remarks);

    public sealed record AccountDto(string? AccountNo, string? IfscCode, string? BranchAddress, string? BankName);

    /// <param name="Checks">During a correction round: the answers and documents the assessor found not valid, with the remarks.</param>
    /// <param name="CorrectionOpen">A correction round is open and not past its date.</param>
    public sealed record ApplicationDto(int Id, string Status, string? Level, FormAnswers Answers, IReadOnlyList<CheckDto> Checks,
        decimal ClaimAmount, decimal EligibleAmount, decimal? ApprovedAmount, decimal? SharePercent, decimal? MaxAmount,
        int? CorrectionRound, string? CorrectionDueOn, bool CorrectionOpen, string? SubmittedOn, string? DecidedOn, string? Reason, string? HoldReason,
        AccountDto? Account, string? HoldKind = null);

    public sealed record HistoryDto(int Id, string? Date, string Status, string? Level, decimal? Amount, string? Reason);

    public sealed record PageDto(SchemeDto Scheme, Dictionary<string, object?> Unit, WindowDto? Window, string State, string? Note, bool CanApply,
        string? Message, ApplicationDto? Application, IReadOnlyDictionary<string, IReadOnlyList<PickEntry>> Picks, IReadOnlyList<HistoryDto> History);

    public sealed record UploadDto(string FileName, bool IsPdf, string Url);

    // ----- requests -----

    public sealed record SectionRequest(Dictionary<string, string?>? Values);

    public sealed record ItemRequest(string? Pick, Dictionary<string, string?>? Values);

    public sealed record SubmitRequest(SchemeAccount? Account, IReadOnlyList<string>? Cheque, bool UnitConfirmed, bool Declaration);

    public sealed record CorrectionRequest(SchemeAccount? Account, IReadOnlyList<string>? Cheque);

    // ----- dashboard -----

    /// <summary>
    /// GET api/msme/incentive-schemes — the schemes' tiles, the Financial Assistance card's scheme (2026-11-20) and the Technology
    /// Upgradation card's direct scheme, with the legacy applications in progress the two cards open instead.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<DashboardDto>> Dashboard(CancellationToken ct)
    {
        var unit = await SchemeUnit.LoadAsync(db, ZedId, ct);
        if (unit is null) return NotFound();
        var facts = await FactsAsync(db, ZedId, unit.EligibleForBenefits, log, ct, unit.EligibleForFinancial, legacy: true);
        var all = await store.EnsureBuiltInAsync(ct);
        var tu = (await store.CardSettingsAsync(ct)).GetValueOrDefault(TuCard);
        var directCode = SchemeStore.DirectCodeOf(tu);
        var apps = await db.QuerySqlAsync<Row>(SchemeApplications.AllOfUnitSql, new { ZedId = SchemeApplications.Ansi(ZedId, 50) }, ct);
        List<Row> AppsOf(string code) => apps.Where(a => SchemeStore.Same(a.SchemeCode, code)).ToList();

        // The two built-in schemes appear on their cards, never as tiles of their own.
        var tiles = all.Where(d => d.Active && !SchemeStore.Same(d.Code, SchemeTemplates.FaCode) && !SchemeStore.Same(d.Code, directCode))
            .OrderBy(d => d.OrderNo).Select(d => Tile(d, facts, AppsOf(d.Code))).ToList();

        var fa = all.FirstOrDefault(d => SchemeStore.Same(d.Code, SchemeTemplates.FaCode));
        var faApps = fa is null ? new List<Row>() : AppsOf(fa.Code);
        var faTile = fa is not null && (fa.Active || faApps.Count > 0) ? Tile(fa, facts, faApps, LegacyKind.FinancialAssistance, fa.Active) : null;
        var faLegacy = facts.LegacyFa.Any(c => c.InProgress) && faTile?.State is not (ApplicantState.Progress or ApplicantState.OnHold);

        var direct = tu?.Direct == true;
        var tuDef = all.FirstOrDefault(d => SchemeStore.Same(d.Code, directCode));
        var tuApps = tuDef is null ? new List<Row>() : AppsOf(tuDef.Code);
        // Card on the recommendation again: a direct application not final (a draft too) still shows, to be continued.
        var tuShown = tuDef is not null && (direct ? tuDef.Active || tuApps.Count > 0 : tuApps.Any(a => !SchemeApplications.Final.Contains(a.Status)));
        var tuTile = tuShown ? Tile(tuDef!, facts, tuApps, LegacyKind.TechnologyUpgradation, direct && tuDef!.Active) : null;
        var tuLegacy = facts.LegacyTu.Any(c => c.InProgress) && tuTile?.State is not (ApplicantState.Progress or ApplicantState.OnHold);

        return new DashboardDto(tiles, new TuDto(direct, tuTile, tuLegacy), new FaDto(faTile, faLegacy));
    }

    private static SchemeTileDto Tile(SchemeDefinition d, UnitFacts facts, IReadOnlyList<Row> apps, LegacyKind legacy = LegacyKind.None, bool offered = true)
    {
        var s = ApplicantState.Of(d, facts, apps, legacy, offered);
        var grade = s.Window?.Grade is { } g ? new GradeDto(g.SharePercent, g.MaxAmount) : null;
        return new SchemeTileDto(d.Code, d.Card.Title, d.Card.Highlight, d.Card.Details, d.Card.Icon, s.State, s.Note,
            s.State == ApplicantState.Locked ? ApplicantState.LockedMessage(s.Note, d.Activation) : null,
            s.Application?.Id, s.Application?.Status, s.Application?.SchemeLevel ?? s.Window?.Level, grade, d.Activation.Mode, d.Activation.Levels);
    }

    // ----- the page -----

    /// <summary>GET api/msme/incentive-schemes/{code} — the scheme's form, the unit, the claim window, the application and its history.</summary>
    [HttpGet("{code}")]
    public async Task<ActionResult<PageDto>> Page(string code, CancellationToken ct)
    {
        var (c, error) = await LoadAsync(code, ct);
        return c is null ? error! : await PageAsync(c, ct);
    }

    /// <summary>POST api/msme/incentive-schemes/{code}/draft — starts (or returns) the application of the open claim window.</summary>
    [HttpPost("{code}/draft")]
    [MsmeEditAudit("Incentive scheme: application started")]
    public async Task<ActionResult<PageDto>> Draft(string code, CancellationToken ct)
    {
        using (await SchemeLocks.EnterAsync(ct))
        {
            var (c, error) = await LoadAsync(code, ct);
            if (c is null) return error!;
            var s = c.Standing;
            if (s.State != ApplicantState.Open || s.Window is not { } w) return this.Problem400(Refusal(c));
            if (s.Draft is null)
            {
                var id = (await db.QuerySqlAsync<int>(SchemeApplications.InsertDraftSql, new
                {
                    ZedId = SchemeApplications.Ansi(ZedId, 50), SchemeCode = SchemeApplications.Ansi(c.Def.Code, 40),
                    SchemeLevel = SchemeApplications.Ansi(w.Level, 50), SchemeCertNo = SchemeApplications.Ansi(w.CertRef, 100),
                    FormAnswers = new FormAnswers().Serialize(), SharePercent = w.Grade?.SharePercent, MaxAmount = w.Grade?.MaxAmount,
                }, ct)).FirstOrDefault();
                log.LogInformation("Scheme {Code}: draft {Id} started by {ZedId} for {Level}/{Cert}", c.Def.Code, id, ZedId, w.Level, w.CertRef);
            }
            (c, error) = await LoadAsync(code, ct);
            return c is null ? error! : await PageAsync(c, ct);
        }
    }

    /// <summary>PUT api/msme/incentive-schemes/{code}/sections/{section} — a plain section's values, checked as a whole.</summary>
    [HttpPut("{code}/sections/{section}")]
    [MsmeEditAudit("Incentive scheme: section saved")]
    public Task<ActionResult<PageDto>> SaveSection(string code, string section, SectionRequest req, CancellationToken ct) =>
        SaveItemAsync(code, section, 0, new ItemRequest(null, req.Values), repeating: false, ct);

    /// <summary>PUT api/msme/incentive-schemes/{code}/sections/{section}/items/{index} — an "Add more" item (index = count: a new one).</summary>
    [HttpPut("{code}/sections/{section}/items/{index:int}")]
    [MsmeEditAudit("Incentive scheme: item saved")]
    public Task<ActionResult<PageDto>> SaveItem(string code, string section, int index, ItemRequest req, CancellationToken ct) =>
        SaveItemAsync(code, section, index, req, repeating: true, ct);

    private async Task<ActionResult<PageDto>> SaveItemAsync(string code, string sectionKey, int index, ItemRequest req, bool repeating, CancellationToken ct)
    {
        using (await SchemeLocks.EnterAsync(ct))
        {
            var (c, error) = await LoadAsync(code, ct);
            if (c is null) return error!;
            var s = c.Def.Form.Sections.FirstOrDefault(x => x.Key == sectionKey);
            if (s is null || s.Repeating != repeating) return NotFound();
            var (app, refusal) = Editable(c);
            if (app is null) return this.Problem400(refusal!);
            var correction = app.Status == SchemeApplications.Correction;

            var answers = app.Answers;
            var items = answers.Sections.GetValueOrDefault(s.Key) ?? [];
            if (index < 0 || index > items.Count || (correction && index >= items.Count)) return this.Problem400("Invalid item.");
            if (repeating && index >= s.MaxItems) return this.Problem400($"\"{s.Title}\": at most {s.MaxItems}.");

            var input = new FormItem { Pick = req.Pick, Values = req.Values ?? new() };
            if (correction)
            {
                // Only the answers the assessor found not valid change; the others stay as submitted.
                var notValid = NotValidPaths(app);
                var old = items[index];
                var values = new Dictionary<string, string?>(old.Values);
                foreach (var f in s.Fields)
                    if (notValid.Contains(SchemeApplications.PathOf(s.Key, index, f.Key)) && input.Values.TryGetValue(f.Key, out var v)) values[f.Key] = v;
                var pickAllowed = notValid.Contains(SchemeApplications.PathOf(s.Key, index, PickField));
                input = new FormItem { Pick = pickAllowed ? input.Pick : old.Pick, PickName = old.PickName, Values = values };
            }

            var picks = await PicksAsync(c, s, ct);
            var (item, problem) = ApplicantForm.Item(c.Def.Form, s, input, answers, index, ContextOf(c, app), picks);
            if (problem is not null) return this.Problem400(problem);
            var list = new List<FormItem>(items);
            if (index == list.Count) list.Add(item!); else list[index] = item!;
            answers.Sections[s.Key] = list;
            if (UniqueProblem(UniqueValues(c.Def.Form, answers, s.Key, index), Taken(c, app)) is { } used) return this.Problem400(used);
            await SaveAnswersAsync(app, answers, ct);
            (c, error) = await LoadAsync(code, ct);
            return c is null ? error! : await PageAsync(c, ct);
        }
    }

    /// <summary>DELETE api/msme/incentive-schemes/{code}/sections/{section}/items/{index} — removes an "Add more" item of the draft.</summary>
    [HttpDelete("{code}/sections/{section}/items/{index:int}")]
    [MsmeEditAudit("Incentive scheme: item removed")]
    public async Task<ActionResult<PageDto>> RemoveItem(string code, string section, int index, CancellationToken ct)
    {
        using (await SchemeLocks.EnterAsync(ct))
        {
            var (c, error) = await LoadAsync(code, ct);
            if (c is null) return error!;
            var s = c.Def.Form.Sections.FirstOrDefault(x => x.Key == section && x.Repeating);
            if (s is null) return NotFound();
            var (app, refusal) = Editable(c);
            if (app is null) return this.Problem400(refusal!);
            if (app.Status != SchemeApplications.Draft) return this.Problem400("An item cannot be removed after submission.");
            var answers = app.Answers;
            var items = answers.Sections.GetValueOrDefault(s.Key) ?? [];
            if (index < 0 || index >= items.Count) return this.Problem400("Invalid item.");
            answers.Sections[s.Key] = items.Where((_, i) => i != index).ToList();
            await SaveAnswersAsync(app, answers, ct);
            (c, error) = await LoadAsync(code, ct);
            return c is null ? error! : await PageAsync(c, ct);
        }
    }

    /// <summary>
    /// POST api/msme/incentive-schemes/{code}/documents (multipart: section, item, field, file) — one document of a field (or the
    /// cancelled cheque: section "_bank", field "cheque"), PDF / JPEG / PNG up to 5 MB (a photo field: JPEG / PNG). The page then
    /// saves the item with the returned name.
    /// </summary>
    [HttpPost("{code}/documents")]
    [MsmeEditAudit("Incentive scheme: document uploaded")]
    [RequestSizeLimit(SchemeUploads.MaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = SchemeUploads.MaxBytes + 64 * 1024)]
    public async Task<ActionResult<UploadDto>> Upload(string code, [FromForm] string? section, [FromForm] int? item, [FromForm] string? field,
        IFormFile? file, CancellationToken ct)
    {
        if (file is null || await SchemeUploads.KindAsync(file, ct) is not { } ext)
            return this.Problem400("Please upload valid document (PDF / JPG / PNG, less than 5 MB).");
        var (c, error) = await LoadAsync(code, ct);
        if (c is null) return error!;
        var (app, refusal) = Editable(c);
        if (app is null) return this.Problem400(refusal!);

        var index = item ?? 0;
        string path;
        if (section == BankSection && field == ChequeField && c.Def.Form.Blocks.BankAccount)
        {
            path = ChequePath;
        }
        else
        {
            var s = c.Def.Form.Sections.FirstOrDefault(x => x.Key == section);
            var f = s?.Fields.FirstOrDefault(x => x.Key == field && IsDocument(x));
            if (s is null || f is null || index < 0 || index >= (s.Repeating ? s.MaxItems : 1)) return this.Problem400("Invalid document.");
            if (f.Type == "photo" && ext == ".pdf") return this.Problem400("Please upload a photo (JPG / PNG, less than 5 MB).");
            path = SchemeApplications.PathOf(s.Key, index, f.Key);
        }
        if (app.Status == SchemeApplications.Correction && !NotValidPaths(app).Contains(path))
            return this.Problem400("Only the documents marked not valid can be uploaded again.");

        var root = SchemeUploads.StorageRoot(env, portal.Value);
        var name = await SchemeUploads.SaveAsync(root, ZedId, Folder, file, ext, ct);
        if (name is null) return this.Problem400("The document could not be saved. Please try again.");
        log.LogInformation("Scheme {Code} document {Name} ({Path}) uploaded by {ZedId}", c.Def.Code, name, path, ZedId);
        return new UploadDto(name, SchemeUploads.IsPdf(name), FileUrl(c.Def.Code, name));
    }

    /// <summary>GET api/msme/incentive-schemes/{code}/files/{name} — one of the signed-in unit's own scheme documents.</summary>
    [HttpGet("{code}/files/{name}")]
    public IActionResult Document(string code, string name)
    {
        var full = SchemeUploads.Find(SchemeUploads.StorageRoot(env, portal.Value), ZedId, Folder, name);
        return full is null ? NotFound() : SchemeUploads.Serve(this, full);
    }

    /// <summary>POST api/msme/incentive-schemes/{code}/submit — the whole form checked, the amounts computed, then the staff workflow.</summary>
    [HttpPost("{code}/submit")]
    [MsmeEditAudit("Incentive scheme: application submitted")]
    public async Task<ActionResult<PageDto>> Submit(string code, SubmitRequest req, CancellationToken ct)
    {
        int id;
        using (await SchemeLocks.EnterAsync(ct))
        {
            var (c, error) = await LoadAsync(code, ct);
            if (c is null) return error!;
            var app = c.Standing.Draft;
            if (c.Standing.State != ApplicantState.Open || c.Standing.Window is not { } w || app is null)
                return this.Problem400(app is null && c.Standing.State == ApplicantState.Open ? "Please fill in the application first." : Refusal(c));
            var blocks = c.Def.Form.Blocks;
            if (blocks.UnitConfirm && !req.UnitConfirmed) return this.Problem400("Please confirm the unit details.");

            var ctx = ContextOf(c, app);
            var answers = app.Answers;
            SchemeAccount? account = null;
            if (blocks.BankAccount)
            {
                if (MsmeFinancialAssistanceController.AccountProblem(req.Account) is { } bad) return this.Problem400(bad);
                if (ChequeProblem(req.Cheque, ctx) is { } cheque) return this.Problem400(cheque);
                account = req.Account;
                answers.Sections[BankSection] = [new FormItem { Values = new() { [ChequeField] = ListValue(req.Cheque!) }, Saved = true }];
            }
            if (blocks.Declaration && !req.Declaration) return this.Problem400("Please accept the declaration.");

            var (clean, problem) = Check(c.Def.Form, answers, ctx);
            if (problem is not null) return this.Problem400(problem);
            if (UniqueProblem(UniqueValues(c.Def.Form, clean!), Taken(c, app)) is { } used) return this.Problem400(used);
            // The state refuses a window without a grade (notGraded); checked again so a claim is never stored at Rs. 0.
            if (w.Grade is null) return this.Problem400(ApplicantState.LockedMessage("notGraded", c.Def.Activation));
            var claim = clean!.Claim(c.Def.Form);
            var eligible = Eligible(claim, w.Grade);
            var updated = (await db.QuerySqlAsync<int>(SubmitSql, new
            {
                app.Id, ZedId = SchemeApplications.Ansi(ZedId, 50), SchemeCode = SchemeApplications.Ansi(c.Def.Code, 40),
                FormAnswers = clean.Serialize(), SchemeLevel = SchemeApplications.Ansi(w.Level, 50), SchemeCertNo = SchemeApplications.Ansi(w.CertRef, 100),
                SharePercent = w.Grade?.SharePercent, MaxAmount = w.Grade?.MaxAmount, ClaimAmount = claim,
                AmountPaid = SchemeApplications.Ansi(Money(claim), 50), EligibleAmount = SchemeApplications.Ansi(Money(eligible), 50),
                AccountNo = SchemeApplications.Ansi(account?.AccountNo?.Trim(), 50),
                IfscCode = SchemeApplications.Ansi(account?.IfscCode?.Trim().ToUpperInvariant(), 50),
                BranchAddress = SchemeApplications.Ansi(account is null ? null : SchemeInput.Text(account.BranchAddress, 500), 2000),
                BankName = SchemeApplications.Ansi(account is null ? null : SchemeInput.Text(account.BankName, 200), 200),
                Documents = DocumentsJson(c.Def.Form, clean),
            }, ct)).FirstOrDefault();
            if (updated != 1) return this.Problem400("The application could not be submitted. It may already have been submitted.");
            id = app.Id;
            log.LogInformation("Scheme {Code}: application {Id} submitted by {ZedId} for {Level}/{Cert}: claim {Claim}, eligible {Eligible}",
                c.Def.Code, id, ZedId, w.Level, w.CertRef, claim, eligible);
        }

        if (HttpContext.RequestServices.GetService<ISchemeWorkflow>() is { } workflow)
        {
            try { await workflow.AfterSubmitAsync(id, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Scheme workflow after the submission of {Id} failed", id); }
        }
        var (after, err) = await LoadAsync(code, ct);
        return after is null ? err! : await PageAsync(after, ct);
    }

    /// <summary>
    /// POST api/msme/incentive-schemes/{code}/correction — the corrected answers (saved by the section / item PUTs) go back to the
    /// assessor; the bank account and the cancelled cheque change here when they were found not valid. Refused after the round's date.
    /// </summary>
    [HttpPost("{code}/correction")]
    [MsmeEditAudit("Incentive scheme: corrections submitted")]
    public async Task<ActionResult<PageDto>> Correction(string code, CorrectionRequest req, CancellationToken ct)
    {
        int id;
        using (await SchemeLocks.EnterAsync(ct))
        {
            var (c, error) = await LoadAsync(code, ct);
            if (c is null) return error!;
            var (app, refusal) = Editable(c);
            if (app is null) return this.Problem400(refusal!);
            if (app.Status != SchemeApplications.Correction) return this.Problem400("No correction is asked for this application.");

            var notValid = NotValidPaths(app);
            var ctx = ContextOf(c, app);
            var answers = app.Answers;
            var account = new SchemeAccount(app.AccountNo, app.AccountNo, app.IfscCode, app.BranchAddress, app.BankName);
            if (notValid.Contains(AccountPath) && req.Account is not null)
            {
                if (MsmeFinancialAssistanceController.AccountProblem(req.Account) is { } bad) return this.Problem400(bad);
                account = req.Account;
            }
            if (notValid.Contains(ChequePath) && req.Cheque is not null)
            {
                if (ChequeProblem(req.Cheque, ctx) is { } cheque) return this.Problem400(cheque);
                answers.Sections[BankSection] = [new FormItem { Values = new() { [ChequeField] = ListValue(req.Cheque) }, Saved = true }];
            }

            var (clean, problem) = Check(c.Def.Form, answers, ctx);
            if (problem is not null) return this.Problem400(problem);
            var updated = (await db.QuerySqlAsync<int>(CorrectionSql, new
            {
                app.Id, ZedId = SchemeApplications.Ansi(ZedId, 50), SchemeCode = SchemeApplications.Ansi(c.Def.Code, 40), FormAnswers = clean!.Serialize(),
                AccountNo = SchemeApplications.Ansi(account.AccountNo?.Trim(), 50), IfscCode = SchemeApplications.Ansi(account.IfscCode?.Trim().ToUpperInvariant(), 50),
                BranchAddress = SchemeApplications.Ansi(account.BranchAddress?.Trim(), 2000), BankName = SchemeApplications.Ansi(account.BankName?.Trim(), 200),
                Documents = DocumentsJson(c.Def.Form, clean),
            }, ct)).FirstOrDefault();
            if (updated != 1) return this.Problem400("The corrections could not be submitted. Please refresh the page.");
            id = app.Id;
            log.LogInformation("Scheme {Code}: corrections of {Id} (round {Round}) submitted by {ZedId}", c.Def.Code, id, app.CorrectionRound, ZedId);
        }

        if (HttpContext.RequestServices.GetService<ISchemeWorkflow>() is { } workflow)
        {
            try { await workflow.AfterCorrectionAsync(id, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Scheme workflow after the corrections of {Id} failed", id); }
        }
        var (after, err) = await LoadAsync(code, ct);
        return after is null ? err! : await PageAsync(after, ct);
    }

    // ----- helpers -----

    private sealed record Ctx(SchemeDefinition Def, SchemeUnit Unit, UnitFacts Facts, IReadOnlyList<Row> Apps, ApplicantState.Standing Standing,
        LegacyKind Legacy = LegacyKind.None);

    private async Task<(Ctx? Ctx, ActionResult? Error)> LoadAsync(string code, CancellationToken ct)
    {
        var def = (await store.EnsureBuiltInAsync(ct)).FirstOrDefault(d => SchemeStore.Same(d.Code, code));
        if (def is null) return (null, NotFound());
        var unit = await SchemeUnit.LoadAsync(db, ZedId, ct);
        if (unit is null) return (null, NotFound());
        var apps = await SchemeApplications.OfUnitAsync(db, ZedId, def.Code, ct);
        // An inactive scheme, or the direct Technology Upgradation scheme while the card needs the recommendation, takes no new
        // application: it shows only the applications already made (a draft or one in progress continues).
        var tu = (await store.CardSettingsAsync(ct)).GetValueOrDefault(TuCard);
        var isDirect = SchemeStore.Same(def.Code, SchemeStore.DirectCodeOf(tu));
        var offered = def.Active && (!isDirect || tu?.Direct == true);
        if (apps.Count == 0 && !offered) return (null, NotFound());
        var legacy = SchemeStore.Same(def.Code, SchemeTemplates.FaCode) ? LegacyKind.FinancialAssistance
            : isDirect ? LegacyKind.TechnologyUpgradation : LegacyKind.None;
        var facts = await FactsAsync(db, ZedId, unit.EligibleForBenefits, log, ct, unit.EligibleForFinancial, legacy: legacy != LegacyKind.None);
        return (new Ctx(def, unit, facts, apps, ApplicantState.Of(def, facts, apps, legacy, offered), legacy), null);
    }

    /// <summary>
    /// The values of the scheme's unique fields already used: in the unit's other applications of the scheme that are not
    /// rejected, and (Financial Assistance) the invoice numbers of its applications made before the framework.
    /// </summary>
    private static IEnumerable<TakenValue> Taken(Ctx c, Row app)
    {
        foreach (var other in c.Apps.Where(a => a.Id != app.Id && a.Status != SchemeApplications.Rejected))
            foreach (var (f, v) in UniqueValues(c.Def.Form, other.Answers))
                yield return new TakenValue(f.Key, v, $"your application no. {other.Id}");
        if (c.Legacy == LegacyKind.FinancialAssistance)
            foreach (var l in c.Facts.LegacyFa.Where(l => !string.IsNullOrWhiteSpace(l.InvoiceNo)))
                yield return new TakenValue(LegacyInvoiceField, l.InvoiceNo!, "your earlier Financial Assistance application");
    }

    /// <summary>The Financial Assistance field the legacy applications' invoice numbers (FinancialAssistance.InvoiceNo) are compared with.</summary>
    public const string LegacyInvoiceField = "invoice_no";

    /// <summary>The application the applicant may change now (the draft of the open window, or one in an open correction round).</summary>
    private static (Row? App, string? Refusal) Editable(Ctx c)
    {
        var s = c.Standing;
        if (s.Application is { Status: SchemeApplications.Correction } corr)
        {
            if (corr.CorrectionDueOn is { } due && DateTime.Today > due.Date)
                return (null, $"The corrections were due by {due:dd-MM-yyyy}.");
            return (corr, null);
        }
        if (s.State == ApplicantState.Open && s.Draft is { } draft) return (draft, null);
        if (s.State == ApplicantState.Open) return (null, "Please start the application first.");
        return (null, s.State == ApplicantState.Progress || s.State == ApplicantState.OnHold
            ? "The application has been submitted and cannot be changed now."
            : Refusal(c));
    }

    private static string Refusal(Ctx c) => c.Standing.State switch
    {
        ApplicantState.Locked => ApplicantState.LockedMessage(c.Standing.Note, c.Def.Activation),
        ApplicantState.Availed => "You have availed this scheme for your current certification.",
        ApplicantState.Progress or ApplicantState.OnHold => "An application for this scheme is already in progress.",
        _ => "You cannot apply for this scheme now.",
    };

    /// <summary>The paths the assessor found not valid (the latest check of each path is kept).</summary>
    private static HashSet<string> NotValidPaths(Row app) =>
        app.Checks.Where(kv => string.Equals(kv.Value.Status, "No", StringComparison.OrdinalIgnoreCase)).Select(kv => kv.Key).ToHashSet();

    private Context ContextOf(Ctx c, Row app)
    {
        var opened = app.Status == SchemeApplications.Draft ? c.Standing.Window?.OpenedOn : ApplicantState.OpenedOn(app, c.Facts);
        var root = SchemeUploads.StorageRoot(env, portal.Value);
        var zedId = ZedId;
        return new Context(DateOnly.FromDateTime(DateTime.Today), opened is { } o ? DateOnly.FromDateTime(o) : null,
            name => SchemeUploads.Find(root, zedId, Folder, name) is not null);
    }

    private static string? ChequeProblem(IReadOnlyList<string>? cheque, Context ctx)
    {
        if (cheque is null || cheque.Count == 0) return "Please upload the cancelled cheque.";
        if (cheque.Count > MaxChequeFiles) return $"Up to {MaxChequeFiles} files can be uploaded for the cancelled cheque.";
        if (cheque.Distinct(StringComparer.OrdinalIgnoreCase).Count() != cheque.Count || cheque.Any(n => !SchemeUploads.IsGenerated(n) || !ctx.FileExists(n)))
            return "Please upload the cancelled cheque again.";
        return null;
    }

    private Task SaveAnswersAsync(Row app, FormAnswers answers, CancellationToken ct) =>
        db.ExecuteSqlAsync(SaveAnswersSql, new { FormAnswers = answers.Serialize(), app.Id, ZedId = SchemeApplications.Ansi(ZedId, 50), Status = SchemeApplications.Ansi(app.Status, 30) }, ct);

    private string DocumentsJson(SchemeForm form, FormAnswers answers)
    {
        var root = SchemeUploads.StorageRoot(env, portal.Value);
        var docs = ApplicantForm.Documents(form, answers).Select(d =>
        {
            var full = SchemeUploads.Find(root, ZedId, Folder, d.File);
            return new
            {
                photoId = d.File, name = d.Path, timeStamp = full is null ? " " : SchemeUploads.TimeStamp(full),
                photoType = d.Label.Length <= 50 ? d.Label : d.Label[..50],
            };
        });
        return System.Text.Json.JsonSerializer.Serialize(docs);
    }

    /// <summary>The entries an "Add more" section picks from: the unit's technologies, or the section's options.</summary>
    private async Task<IReadOnlyList<PickEntry>?> PicksAsync(Ctx c, FormSection s, CancellationToken ct)
    {
        if (s.Pick is not { } p) return null;
        if (p.Kind == SchemeRules.PickOptions) return p.Options.Select(o => new PickEntry(o, o, null)).ToList();
        var sector = c.Facts.TwoDigitActivity?.Trim();
        try
        {
            return (await db.QuerySqlAsync<PickEntry>(TechnologiesSql, new
            {
                Filter = p.SectorFilter ? 1 : 0,
                Sector = SchemeApplications.Ansi(string.IsNullOrEmpty(sector) ? null : sector, 50),
            }, ct)).Where(e => !string.IsNullOrWhiteSpace(e.Code)).ToList();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Technologies not readable for {ZedId}", ZedId);
            return [];
        }
    }

    private async Task<PageDto> PageAsync(Ctx c, CancellationToken ct)
    {
        var d = c.Def;
        var s = c.Standing;
        var current = c.Apps.FirstOrDefault(a => !SchemeApplications.Final.Contains(a.Status)) ?? c.Apps.FirstOrDefault();
        var picks = new Dictionary<string, IReadOnlyList<PickEntry>>();
        foreach (var section in d.Form.Sections.Where(x => x.Pick is not null))
            picks[section.Key] = await PicksAsync(c, section, ct) ?? [];

        var w = s.Window;
        var window = w is null ? null : new WindowDto(w.Level, w.CertRef, Date(w.OpenedOn), w.Grade is { } g ? new GradeDto(g.SharePercent, g.MaxAmount) : null);
        var message = s.State switch
        {
            ApplicantState.Locked or ApplicantState.Availed => Refusal(c),
            ApplicantState.OnHold => "The application is on hold. " + ApplicantState.HoldMessage(ApplicantState.HoldKind(s.Application?.HoldReason, SchemeApplications.OnHold)),
            _ => null,
        };
        var history = c.Apps.Where(a => a.Id != current?.Id && a.Status != SchemeApplications.Draft)
            .Select(a => new HistoryDto(a.Id, Date(a.SubmittedOn ?? a.CreatedDate), a.Status, a.SchemeLevel, Amount(a), Reason(a))).ToList();
        var scheme = new SchemeDto(d.Code, d.Name, d.Card, d.Form.Blocks, d.Form.Sections, d.Form.Rules, d.Grading, d.Activation.Mode, d.Activation.Levels,
            d.Verification.CorrectionRounds, d.Verification.CorrectionDays, Text(d.Disclaimer), Text(d.Instructions), Text(d.Declaration));
        return new PageDto(scheme, c.Unit.Panel(), window, s.State, s.Note, s.State == ApplicantState.Open, message,
            current is null ? null : ToDto(c, current), picks, history);
    }

    private static ApplicationDto ToDto(Ctx c, Row a)
    {
        var answers = a.Answers;
        var draft = a.Status == SchemeApplications.Draft;
        var grade = draft ? c.Standing.Window?.Grade : a.SharePercent is { } sp ? new SchemeGrade(a.SchemeLevel ?? "", sp, a.MaxAmount ?? SchemeRules.AmountCeiling) : null;
        var claim = draft ? answers.Claim(c.Def.Form) : a.ClaimAmount ?? answers.Claim(c.Def.Form);
        var eligible = draft || !decimal.TryParse(a.EligibleAmount, NumberStyles.Number, CultureInfo.InvariantCulture, out var e) ? Eligible(claim, grade) : e;
        var correction = a.Status == SchemeApplications.Correction;
        var checks = correction
            ? a.Checks.Where(kv => string.Equals(kv.Value.Status, "No", StringComparison.OrdinalIgnoreCase)).Select(kv => new CheckDto(kv.Key, kv.Value.Remarks)).ToList()
            : [];
        // The stored hold reason is the staff's ("Certificate X SUSPENDED (was Verifying)"): the applicant sees a sentence of its own.
        var hold = ApplicantState.HoldKind(a.HoldReason, a.Status);
        // The cancelled cheque is shown with the bank block, not as an answer.
        var account = a.AccountNo is null ? null : new AccountDto(a.AccountNo, a.IfscCode, a.BranchAddress, a.BankName);
        return new ApplicationDto(a.Id, a.Status, a.SchemeLevel, answers, checks, claim, eligible, a.ApprovedAmount, grade?.SharePercent, grade?.MaxAmount,
            a.CorrectionRound, Date(a.CorrectionDueOn), correction && (a.CorrectionDueOn is not { } due || DateTime.Today <= due.Date),
            Date(a.SubmittedOn), Date(a.DecidedOn), Reason(a), ApplicantState.HoldMessage(hold), account, hold);
    }

    private static decimal? Amount(Row a) =>
        a.ApprovedAmount ?? a.ApproverAmount ?? (decimal.TryParse(a.EligibleAmount, NumberStyles.Number, CultureInfo.InvariantCulture, out var e) ? e : a.ClaimAmount);

    private static string? Reason(Row a) => a.Status == SchemeApplications.Rejected
        ? (string.IsNullOrWhiteSpace(a.ReasonForRejection) ? a.ReasonForRejectionAgency : a.ReasonForRejection)?.Trim()
        : null;

    private static string? Date(DateTime? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>A scheme text for the page: null when empty (the page then shows the global Texts wording).</summary>
    private static string? Text(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string FileUrl(string code, string name) =>
        $"/api/msme/incentive-schemes/{Uri.EscapeDataString(code)}/files/{Uri.EscapeDataString(name)}";
}
