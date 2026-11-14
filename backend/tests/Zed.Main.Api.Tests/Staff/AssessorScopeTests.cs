using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>2026-11-14: one kind of assessor, with the levels and modes the agency ticks (Users.AssessmentModes, migration 0072).</summary>
public sealed class AssessorScopeTests
{
    private static readonly Dictionary<string, string> Flows = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Bronze"] = LevelFlows.Desktop, ["Silver"] = LevelFlows.DesktopOnsite, ["Gold"] = LevelFlows.DesktopOnsite,
    };

    [Fact]
    public void Ticks_are_checked_against_the_levels_flows_and_set_the_old_type()
    {
        var (stored, map, error) = AssessorScope.Validate(
            [new("bronze", ["Desktop"]), new("Silver", ["Desktop", "Onsite"])], Flows);
        Assert.Null(error);
        Assert.Equal("Bronze=D;Silver=D,O", stored);
        Assert.Equal(StaffUserRules.AssessorTypeAssessor, AssessorScope.TypeOf(map!));
        Assert.Equal(StaffUserRules.AssessorTypeBronze, AssessorScope.TypeOf(AssessorScope.Parse("Bronze=D")));

        Assert.Equal("Bronze has no onsite assessment.", AssessorScope.Validate([new("Bronze", ["Onsite"])], Flows).Error);
        Assert.Equal("Platinum is not a certification level.", AssessorScope.Validate([new("Platinum", ["Desktop"])], Flows).Error);
        Assert.Contains("at least one", AssessorScope.Validate([new("Silver", [])], Flows).Error);
    }

    [Fact]
    public void Without_ticks_an_assessor_follows_its_old_type()
    {
        var bronze = AssessorScope.Of(null, "BronzeAssessor", Flows);
        Assert.True(AssessorScope.Has(bronze, "Bronze", AssessorScope.DesktopMode));
        Assert.False(AssessorScope.Has(bronze, "Silver", AssessorScope.OnsiteMode));
        var assessor = AssessorScope.Of(null, "Assessor", Flows);
        Assert.False(AssessorScope.Has(assessor, "Bronze", AssessorScope.DesktopMode));
        Assert.True(AssessorScope.Has(assessor, "Gold", AssessorScope.DesktopMode));
        Assert.True(AssessorScope.Has(assessor, "Gold", AssessorScope.OnsiteMode));
        // Stored ticks win over the type.
        Assert.True(AssessorScope.Has(AssessorScope.Of("Bronze=D;Gold=O", "Assessor", Flows), "Bronze", AssessorScope.DesktopMode));
    }
}
