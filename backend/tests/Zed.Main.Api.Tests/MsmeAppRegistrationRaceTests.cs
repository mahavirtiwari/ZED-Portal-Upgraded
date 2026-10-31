using Microsoft.Extensions.DependencyInjection;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

public sealed partial class MsmeAppRegistrationTests
{
    [Fact]
    public async Task Parallel_wrong_otps_are_each_counted()
    {
        var app = _host.CreateClient();
        var otp = await CaptchaPlantAndOtpAsync(app);
        var wrong = otp == "AAAA" ? "BBBB" : "AAAA";
        // Two wrong attempts already made (the per-address rate limit leaves 7 calls this minute).
        var store = _host.Services.GetRequiredService<AppRegistrationStore>();
        var state = (await store.GetAsync(Pledge, default))!;
        state.Failures = 2;
        await store.SaveAsync(Pledge, state, default);

        var answers = await Task.WhenAll(Enumerable.Range(0, 6).Select(async _ =>
            await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp = wrong }))));

        // Exactly the three left of the five are judged; the others find the OTP locked.
        Assert.Equal(3, answers.Count(a => a == ("0", "Invalid OTP.")));
        Assert.Equal(3, answers.Count(a => a == ("0", "Too many wrong attempts. Please request a new OTP.")));
        Assert.Equal(5, (await store.GetAsync(Pledge, default))!.Failures);
        Assert.Equal(("0", "Too many wrong attempts. Please request a new OTP."),
            await Answer(await Post(app, "VerifyPledgeEmailOtp", new { email = Pledge, otp })));
    }

    [Fact]
    public async Task The_address_lock_is_held_until_released()
    {
        var store = _host.Services.GetRequiredService<AppRegistrationStore>();
        var held = await store.LockAsync(Pledge, default);
        var second = store.LockAsync(Pledge.ToUpperInvariant(), default);
        await Task.Delay(100);
        Assert.False(second.IsCompleted);

        held.Dispose();
        held.Dispose(); // a second release is ignored
        (await second.WaitAsync(TimeSpan.FromSeconds(5))).Dispose();
        (await store.LockAsync(Pledge, default).WaitAsync(TimeSpan.FromSeconds(5))).Dispose();
    }
}
