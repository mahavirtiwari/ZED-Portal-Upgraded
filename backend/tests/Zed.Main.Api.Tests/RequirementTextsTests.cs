using Zed.Core.Assessment;

namespace Zed.Main.Api.Tests;

/// <summary>2026-11-21 (review): the questionnaire texts follow migration 0108's rule and load from a real database.</summary>
public sealed class RequirementTextsTests
{
    [Fact]
    public void Dapper_can_fill_the_rows_although_the_queries_return_more_columns_than_the_constructors()
    {
        // The real SqlClient + Dapper refused the positional constructors (the queries also return SectionType and Id).
        Assert.NotNull(typeof(RequirementTexts.Row).GetConstructor(Type.EmptyTypes));
        Assert.NotNull(typeof(RequirementTexts.CheckpointRow).GetConstructor(Type.EmptyTypes));
    }

    [Fact]
    public void Only_a_copy_of_another_levels_text_or_an_empty_text_is_replaced()
    {
        var map = RequirementTexts.From(
            [new RequirementTexts.Row("T9", "T9.9", "BRONZE X") { SectionType = "Bronze" }, new RequirementTexts.Row("T9", "T9.9", "SILVER X") { SectionType = "Silver" }],
            [new RequirementTexts.CheckpointRow("O", "T9", "T9.9", "T9.9.1", null, "BRONZE OPT") { SectionType = "Bronze" },
             new RequirementTexts.CheckpointRow("O", "T9", "T9.9", "T9.9.1", null, "SILVER OPT") { SectionType = "Silver" }],
            "Silver");
        var rows = new List<IDictionary<string, object?>>
        {
            new Dictionary<string, object?> { ["SectionCode"] = "T9", ["RequirementCode"] = "T9.9", ["RequirementName"] = "BRONZE X" },
            new Dictionary<string, object?> { ["SectionCode"] = "T9", ["RequirementCode"] = "T9.9", ["RequirementName"] = "OLDER SILVER WORDING" },
            new Dictionary<string, object?> { ["SectionCode"] = "T9", ["RequirementCode"] = "T9.9", ["RequirementName"] = "" },
        };
        map.AttachTo(rows);
        Assert.Equal(["SILVER X", "OLDER SILVER WORDING", "SILVER X"], rows.Select(r => r["RequirementName"]?.ToString()));
        var opts = new List<IDictionary<string, object?>>
        {
            new Dictionary<string, object?> { ["SectionCode"] = "T9", ["RequirementCode"] = "T9.9", ["OptionCode"] = "T9.9.1", ["OptionName"] = "BRONZE OPT" },
            new Dictionary<string, object?> { ["SectionCode"] = "T9", ["RequirementCode"] = "T9.9", ["OptionCode"] = "T9.9.1", ["OptionName"] = "EDITED LATER" },
        };
        map.AttachToCheckpoints(opts);
        Assert.Equal(["SILVER OPT", "EDITED LATER"], opts.Select(o => o["OptionName"]?.ToString()));
    }
}
