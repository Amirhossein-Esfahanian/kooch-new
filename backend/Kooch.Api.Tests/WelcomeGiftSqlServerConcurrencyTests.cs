using Kooch.Api.Data;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WelcomeGiftSqlServerConcurrencyTests(WelcomeGiftSqlServerDatabase database)
    : IClassFixture<WelcomeGiftSqlServerDatabase>
{
    [SqlServerWalletFact]
    public async Task ConcurrentEligibleIdentities_DoNotExceedCampaignQuota()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task Attempt(string mobile, string code)
        {
            await gate.Task;
            await using var db = database.NewContext();
            await new GuestService(db, new WelcomeGiftGrantService(db, TimeProvider.System))
                .CreateAsync(new GuestCreateRequest
                {
                    FirstName = "Guest", Mobile = mobile, Nationality = "ایران", NationalCode = code
                });
        }

        var first = Attempt("09120000001", "1234567891");
        var second = Attempt("09120000002", "1234567881");
        gate.SetResult();
        await Task.WhenAll(first, second);

        await using var verify = database.NewContext();
        Assert.Equal(1, (await verify.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
        Assert.Single(await verify.WelcomeGiftGrants.ToListAsync());
        Assert.Single(await verify.WalletLots.ToListAsync());
        Assert.Single(await verify.WalletEntries.ToListAsync());
        Assert.Equal(2, await verify.Guests.CountAsync());
    }
}

public sealed class WelcomeGiftSqlServerDatabase : IAsyncLifetime
{
    private string? connectionString;

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable(SqlServerWalletFactAttribute.ConnectionVariable);
        if (string.IsNullOrWhiteSpace(configured)) return;
        connectionString = new SqlConnectionStringBuilder(configured)
        {
            InitialCatalog = $"KoochWelcomeGift_{Guid.NewGuid():N}",
            Pooling = false, TrustServerCertificate = true
        }.ConnectionString;
        await using var db = NewContext();
        await db.Database.EnsureCreatedAsync();
        db.Users.AddRange(
            new User { FirstName = "First", LastName = "User", PhoneNumber = "09120000001", Role = UserRole.Client },
            new User { FirstName = "Second", LastName = "User", PhoneNumber = "09120000002", Role = UserRole.Client });
        db.WelcomeGiftCampaigns.Add(new WelcomeGiftCampaign
        {
            Title = "Welcome", Amount = 100m,
            StartDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
            EndDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)),
            MaxRecipients = 1, ValidityDays = 30, IsActive = true
        });
        await db.SaveChangesAsync();
    }

    public KoochDbContext NewContext() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseSqlServer(connectionString ?? throw new InvalidOperationException("SQL Server test database is unavailable."),
            options => options.CommandTimeout(30)).Options);

    public async Task DisposeAsync()
    {
        if (connectionString is null) return;
        await using var db = NewContext();
        await db.Database.EnsureDeletedAsync();
    }
}
