namespace Zed.Portal.Features.Incentives;

/// <summary>
/// What happens after the applicant acts on a scheme application (the applicant side calls it; the staff side implements it,
/// Features/Incentives/Staff): the confirmation mail, the history and the allotment. A failure is logged by the implementation
/// and never undoes the applicant's action.
/// </summary>
public interface ISchemeWorkflow
{
    /// <summary>The application <paramref name="id"/> was submitted (SchemeStatus Submitted): mail the unit, allot an agency.</summary>
    Task AfterSubmitAsync(int id, CancellationToken ct);

    /// <summary>The applicant answered the open correction round (SchemeStatus back to Verifying): tell the assessor.</summary>
    Task AfterCorrectionAsync(int id, CancellationToken ct);
}
