using System.Data.Common;
using System.Net;
using Zed.Core.Data;
using Zed.Core.Email;

namespace Zed.Portal.Features.Consultancy.Milestones;

/// <summary>
/// 2026-11-16 (approved): the CO's send-back remark reaches the consultants. SP_MONITORING_SEND_BACK_TO_ASSESSOR keeps the
/// remark in dbo.AssessorComments (AssessmentType "Milestone {n}") and sets SendBackStatus 1 with status 13, but nothing showed
/// it: the milestone page and the consultant app now show it while the milestone is back with the consultants, and the
/// lead and co-consultants are mailed.
/// </summary>
public static class MilestoneSendBack
{
    public sealed record Info(string Remarks, DateTime? SentOn);

    internal const string Sql =
        "SELECT TOP (1) A.AssessorRemarks AS Remarks, A.CertificationStatusDate AS SentOn FROM dbo.MsmeCertifications C " +
        "JOIN dbo.AssessorComments A ON A.ZedId = C.ZedId AND A.Certification = C.Certification AND A.AssessmentType = CONCAT('Milestone ', C.NcCount) " +
        "WHERE C.Id = @Id AND C.CertificationStatus = 13 AND C.SendBackStatus = 1 ORDER BY A.Id DESC;";

    private sealed class Row
    {
        public string? Remarks { get; init; }
        public DateTime? SentOn { get; init; }
    }

    /// <summary>The remark of a milestone that is back with the consultants (status 13, sent back), else null.</summary>
    public static async Task<Info?> ReadAsync(ISqlExecutor db, long recordId, ILogger log, CancellationToken ct)
    {
        try
        {
            var row = (await db.QuerySqlAsync<Row>(Sql, new { Id = recordId }, ct)).FirstOrDefault();
            return string.IsNullOrWhiteSpace(row?.Remarks) ? null : new Info(row.Remarks.Trim(), row.SentOn);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Send-back remark of milestone record {Id} not readable", recordId);
            return null;
        }
    }

    internal const string ConsultantsSql =
        "SELECT LTRIM(RTRIM(Email)) AS Email, UserName FROM dbo.Users WHERE UserId IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Ids, ',')) " +
        "AND ISNULL(LTRIM(RTRIM(Email)), '') <> '';";

    private sealed class Consultant
    {
        public string? Email { get; init; }
        public string? UserName { get; init; }
    }

    /// <summary>Mails the lead and the co-consultants; false when nobody could be mailed (the send-back is saved anyway).</summary>
    public static async Task<bool> MailAsync(ISqlExecutor db, IEmailSender email, IEnumerable<string?> consultantIds, string zedId, string level, int milestone,
        string remarks, ILogger log, CancellationToken ct)
    {
        try
        {
            var ids = string.Join(',', consultantIds.Where(i => !string.IsNullOrWhiteSpace(i)).Select(i => i!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase));
            if (ids.Length == 0) return false;
            var people = await db.QuerySqlAsync<Consultant>(ConsultantsSql, new { Ids = ids }, ct);
            var sent = false;
            foreach (var p in people.Where(p => !string.IsNullOrWhiteSpace(p.Email)).DistinctBy(p => p.Email!.ToUpperInvariant()))
            {
                var html =
                    $"<p>Dear {WebUtility.HtmlEncode(p.UserName ?? "Consultant")},</p>" +
                    $"<p>The Consultant Organisation has sent <b>Milestone {milestone}</b> of the {WebUtility.HtmlEncode(level)} handholding of " +
                    $"<b>{WebUtility.HtmlEncode(zedId)}</b> back to you with the following remarks:</p>" +
                    $"<blockquote>{WebUtility.HtmlEncode(remarks).Replace("\n", "<br>", StringComparison.Ordinal)}</blockquote>" +
                    "<p>Please make the changes in the ZED Consultant app or on the portal and submit the milestone again.</p>" +
                    "<p>Regards,<br>ZED Team</p>";
                await email.SendAsync(new EmailMessage(p.Email!, $"Milestone {milestone} sent back by the Consultant Organisation - {zedId}", html,
                    EmailProfiles.Certification, null, null), ct);
                sent = true;
            }
            return sent;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Send-back mail of {ZedId} {Level} milestone {Milestone} failed", zedId, level, milestone);
            return false;
        }
    }
}
