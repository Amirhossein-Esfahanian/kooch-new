using System.Data.Common;
using System.Reflection;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class RegistrationOtpDeadlockTests : IAsyncLifetime
{
    private const string Mobile = "09121234567";
    private const string NationalCode = "1234567891";
    private readonly WelcomeGiftSqlServerDatabase database = new();

    public Task InitializeAsync() => database.InitializeAsync();
    public Task DisposeAsync() => database.DisposeAsync();

    [SqlServerWalletFact]
    public Task DeadlockAfterCredit_RetriesWholeTransaction() => AssertAutomaticRetryAsync("credit");

    [SqlServerWalletFact]
    public Task DeadlockAfterGrantAndQuota_RetriesWholeTransaction() => AssertAutomaticRetryAsync("grant");

    [SqlServerWalletFact]
    public Task DeadlockAfterIntentConsumption_RetriesWholeTransaction() => AssertAutomaticRetryAsync("intent");

    private async Task AssertAutomaticRetryAsync(string phase)
    {
        var verification = await PrepareRegistrationAsync();
        var failure = new FailAfterGiftSave(phase, failures: 1);
        var probe = new RetryProbe();
        await using (var request = database.NewContext(failure, probe))
        {
            Assert.NotNull(await WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(request)
                .VerifyOtpAsync(verification));
            Assert.Equal(2, probe.OtpReads);
            Assert.Equal(2, failure.Attempts);
            Assert.Equal(2, failure.TransactionIds.Count);
        }
        await AssertSingleGiftAsync();
        await using var replay = database.NewContext();
        Assert.Null(await WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(replay)
            .VerifyOtpAsync(verification));
        await AssertSingleGiftAsync();
    }

    [SqlServerWalletFact]
    public async Task PersistentDeadlock_ReturnsSafe503AfterThreeAttemptsAndLeavesOtpUsable()
    {
        var verification = await PrepareRegistrationAsync();
        var failure = new FailAfterGiftSave("intent", failures: int.MaxValue);
        var probe = new RetryProbe();
        await using (var request = database.NewContext(failure, probe))
        {
            var controller = new AuthController(WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(request))
            {
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
            };
            var response = await controller.VerifyOtp(verification, CancellationToken.None);
            var result = Assert.IsType<ObjectResult>(response.Result);
            Assert.Equal(StatusCodes.Status503ServiceUnavailable, result.StatusCode);
            Assert.Equal("1", controller.Response.Headers.RetryAfter.ToString());
            Assert.Equal("{\"message\":\"OTP verification is temporarily unavailable. Please try again.\"}",
                JsonSerializer.Serialize(result.Value));
            Assert.Equal(3, failure.Attempts);
            Assert.Equal(3, failure.TransactionIds.Count);
            Assert.Equal(3, probe.OtpReads);
            Assert.Empty(request.ChangeTracker.Entries());
            Assert.Null(request.Database.CurrentTransaction);
        }
        await AssertNoRegistrationWritesAsync();
        await using var retry = database.NewContext();
        Assert.NotNull(await WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(retry)
            .VerifyOtpAsync(verification));
        await AssertSingleGiftAsync();
    }

    [SqlServerWalletFact]
    public async Task OtherDatabaseAndApplicationErrors_AreNotRetried()
    {
        var verification = await PrepareRegistrationAsync();
        foreach (var number in new[] { 2627, 547, -2, 0 })
        {
            var failure = new FailAfterGiftSave("grant", failures: int.MaxValue, sqlNumber: number);
            var probe = new RetryProbe();
            await using (var request = database.NewContext(failure, probe))
            {
                if (number == 0)
                    await Assert.ThrowsAsync<InvalidOperationException>(() =>
                        WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(request).VerifyOtpAsync(verification));
                else
                    await Assert.ThrowsAsync<DbUpdateException>(() =>
                        WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(request).VerifyOtpAsync(verification));
                Assert.Equal(1, failure.Attempts);
                Assert.Equal(1, probe.OtpReads);
            }
            await AssertNoRegistrationWritesAsync();
        }
    }

    [SqlServerWalletFact]
    public Task Retry_RechecksOtpExpiry() => AssertRecheckAsync("otp");

    [SqlServerWalletFact]
    public Task Retry_RechecksCampaignEligibility() => AssertRecheckAsync("campaign");

    [SqlServerWalletFact]
    public Task Retry_RechecksNewUserEligibility() => AssertRecheckAsync("user");

    private async Task AssertRecheckAsync(string changed)
    {
        var verification = await PrepareRegistrationAsync();
        var failure = new FailAfterGiftSave("intent", failures: 1);
        var probe = new RetryProbe(async () =>
        {
            await AssertNoRegistrationWritesAsync();
            await using var otherRequest = database.NewContext();
            if (changed == "otp")
                await otherRequest.MobileOtpCodes.ExecuteUpdateAsync(setters =>
                    setters.SetProperty(otp => otp.ExpiresAtUtc, DateTime.UtcNow.AddMinutes(-1)));
            else if (changed == "campaign")
                await otherRequest.WelcomeGiftCampaigns.ExecuteUpdateAsync(setters =>
                    setters.SetProperty(campaign => campaign.IsActive, false));
            else
                await otherRequest.Users.Where(user => user.PhoneNumber == Mobile).ExecuteUpdateAsync(setters =>
                    setters.SetProperty(user => user.IsActive, true));
        });
        await using var request = database.NewContext(failure, probe);
        var result = await WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(request).VerifyOtpAsync(verification);
        Assert.Equal(2, probe.OtpReads);
        Assert.Equal(1, failure.Attempts);
        if (changed == "otp")
        {
            Assert.Null(result);
            await AssertNoRegistrationWritesAsync();
        }
        else
        {
            Assert.NotNull(result);
            await using var persisted = database.NewContext();
            var user = await persisted.Users.SingleAsync(row => row.PhoneNumber == Mobile);
            Assert.True(user.IsActive);
            Assert.Null(user.PendingRegistrationNationalCode);
            Assert.Equal(user.Id, (await persisted.Guests.SingleAsync()).UserId);
            Assert.NotNull((await persisted.MobileOtpCodes.SingleAsync()).UsedAtUtc);
            Assert.Empty(await persisted.WelcomeGiftGrants.ToListAsync());
            Assert.Empty(await persisted.WalletAccounts.ToListAsync());
            Assert.Empty(await persisted.WalletEntries.ToListAsync());
            Assert.Equal(0, (await persisted.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
        }
    }

    private async Task<VerifyOtpRequest> PrepareRegistrationAsync()
    {
        await using var setup = database.NewContext();
        setup.Guests.Add(new Guest { FirstName = "Existing", LastName = "Guest", NormalizedMobile = Mobile });
        await setup.SaveChangesAsync();
        var otp = await WelcomeGiftSqlServerConcurrencyTests.CreateAuthService(setup).RegisterAsync(new RegisterRequest
        {
            FirstName = "New", LastName = "User", Mobile = Mobile, NationalCode = NationalCode,
            Password = "password1", ConfirmPassword = "password1"
        });
        return new VerifyOtpRequest { Mobile = Mobile, Code = otp.DevOtpCode! };
    }

    private async Task AssertNoRegistrationWritesAsync()
    {
        await using var persisted = database.NewContext();
        var user = await persisted.Users.SingleAsync(row => row.PhoneNumber == Mobile);
        Assert.False(user.IsActive);
        Assert.Equal(NationalCode, user.PendingRegistrationNationalCode);
        Assert.Null((await persisted.MobileOtpCodes.SingleAsync()).UsedAtUtc);
        Assert.Null((await persisted.Guests.SingleAsync()).UserId);
        Assert.Empty(await persisted.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await persisted.WalletAccounts.ToListAsync());
        Assert.Empty(await persisted.WalletLots.ToListAsync());
        Assert.Empty(await persisted.WalletEntries.ToListAsync());
        Assert.Equal(0, (await persisted.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    private async Task AssertSingleGiftAsync()
    {
        await using var persisted = database.NewContext();
        var user = await persisted.Users.SingleAsync(row => row.PhoneNumber == Mobile);
        Assert.True(user.IsActive);
        Assert.Null(user.PendingRegistrationNationalCode);
        Assert.NotNull((await persisted.MobileOtpCodes.SingleAsync()).UsedAtUtc);
        Assert.Equal(user.Id, (await persisted.Guests.SingleAsync()).UserId);
        var grant = Assert.Single(await persisted.WelcomeGiftGrants.ToListAsync());
        var account = Assert.Single(await persisted.WalletAccounts.ToListAsync());
        var lot = Assert.Single(await persisted.WalletLots.ToListAsync());
        var credit = Assert.Single(await persisted.WalletEntries.ToListAsync());
        Assert.Equal(user.Id, grant.UserId);
        Assert.Equal(NationalCode, grant.NationalCodeSnapshot);
        Assert.Equal(user.Id, account.UserId);
        Assert.Equal(account.Id, lot.WalletAccountId);
        Assert.Equal(account.Id, credit.WalletAccountId);
        Assert.Equal(lot.Id, grant.WalletLotId);
        Assert.Equal(lot.Id, credit.WalletLotId);
        Assert.Equal(credit.Id, grant.WalletEntryId);
        Assert.Equal(WalletEntryDirection.Credit, credit.Direction);
        Assert.Equal(100m, credit.Amount);
        Assert.Equal(credit.Amount, grant.AmountSnapshot);
        Assert.False(lot.IsWithdrawable);
        Assert.Equal(grant.ExpiresAtUtc, lot.ExpiresAtUtc);
        Assert.Equal(1, (await persisted.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    private sealed class RetryProbe(Func<Task>? beforeRetry = null) : DbCommandInterceptor
    {
        public int OtpReads { get; private set; }

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("[MobileOtpCodes]", StringComparison.Ordinal) &&
                command.CommandText.Contains("[CodeHash]", StringComparison.Ordinal))
            {
                OtpReads++;
                if (OtpReads > 1)
                {
                    Assert.Empty(eventData.Context!.ChangeTracker.Entries());
                    Assert.Null(eventData.Context.Database.CurrentTransaction);
                    if (beforeRetry is not null) await beforeRetry();
                }
            }
            return result;
        }
    }

    private sealed class FailAfterGiftSave(string phase, int failures, int sqlNumber = 1205) : SaveChangesInterceptor
    {
        public int Attempts { get; private set; }
        public HashSet<Guid> TransactionIds { get; } = [];

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            var context = eventData.Context!;
            var creditSaved = context.ChangeTracker.Entries<WalletEntry>().Any(entry => entry.Entity.Id > 0);
            var grantSaved = context.ChangeTracker.Entries<WelcomeGiftGrant>().Any(entry => entry.Entity.Id > 0);
            var intentConsumed = context.ChangeTracker.Entries<User>()
                .Any(entry => entry.Entity.PendingRegistrationNationalCode is null);
            if (creditSaved && (phase switch
                {
                    "credit" => !grantSaved,
                    "grant" => grantSaved && !intentConsumed,
                    "intent" => grantSaved && intentConsumed,
                    _ => false
                }))
            {
                Attempts++;
                TransactionIds.Add(context.Database.CurrentTransaction!.TransactionId);
                if (Attempts <= failures)
                {
                    if (sqlNumber == 0) throw new InvalidOperationException("Unrelated application failure.");
                    throw new DbUpdateException("Simulated SQL Server write failure.", CreateSqlException(sqlNumber));
                }
            }
            return ValueTask.FromResult(result);
        }
    }

    // Match the existing voucher/booking-number fixtures while retaining real transactional writes.
    private static SqlException CreateSqlException(int number)
    {
        var constructor = typeof(SqlError).GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic)
            .Single(item => item.GetParameters().Length == 9);
        var error = (SqlError)constructor.Invoke(
            new object?[] { number, (byte)1, (byte)14, "server", "Simulated SQL Server failure.", "", 1, (uint)0, null });
        var errors = (SqlErrorCollection)Activator.CreateInstance(typeof(SqlErrorCollection), nonPublic: true)!;
        typeof(SqlErrorCollection).GetMethod("Add", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(errors, [error]);
        return (SqlException)typeof(SqlException).GetMethod("CreateException",
            BindingFlags.Static | BindingFlags.NonPublic, null,
            [typeof(SqlErrorCollection), typeof(string)], null)!.Invoke(null, [errors, "16.0"])!;
    }
}
