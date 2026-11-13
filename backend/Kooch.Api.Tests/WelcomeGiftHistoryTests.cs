using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.WelcomeGifts;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WelcomeGiftHistoryTests
{
    private static readonly DateTime Granted = new(2020, 1, 1, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task FiltersOwnershipBeforeCountingAndPaging_AndReturnsEmptyHistory()
    {
        await using var db = CreateDb();
        db.WelcomeGiftGrants.AddRange(Grant(1, 9), Grant(2, 22));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var service = new WelcomeGiftHistoryService(db);

        var mine = await service.ListAsync(9, 1, 1);
        Assert.Equal(1, mine.TotalCount);
        Assert.Equal(1, mine.TotalPages);
        Assert.Equal(101m, Assert.Single(mine.Items).GrantedAmount);
        var other = await service.ListAsync(22);
        Assert.Equal(102m, Assert.Single(other.Items).GrantedAmount);
        var empty = await service.ListAsync(33);
        Assert.Empty(empty.Items);
        Assert.Equal(0, empty.TotalCount);
        Assert.Equal(0, empty.TotalPages);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task SyntheticMultiGrantHistory_UsesGrantTimeThenIdDescendingWithBoundedPages()
    {
        // SQL currently enforces one lifetime grant per user. InMemory deliberately
        // exercises the pagination/order contract independently of that constraint.
        await using var db = CreateDb();
        var grants = new[] { Grant(1, 9, Granted.AddDays(2)), Grant(2, 9, Granted), Grant(3, 9, Granted.AddDays(2)) };
        foreach (var grant in grants.Skip(1))
        {
            grant.User = grants[0].User;
            grant.WalletLot.WalletAccount = grants[0].WalletLot.WalletAccount;
            grant.WalletEntry.WalletAccount = grants[0].WalletLot.WalletAccount;
        }
        db.WelcomeGiftGrants.AddRange(grants);
        db.WelcomeGiftGrants.Add(Grant(4, 22, Granted.AddDays(5)));
        await db.SaveChangesAsync();
        var service = new WelcomeGiftHistoryService(db);

        var first = await service.ListAsync(9, 1, 2);
        var second = await service.ListAsync(9, 2, 2);
        Assert.Equal(new[] { 103m, 101m }, first.Items.Select(item => item.GrantedAmount));
        Assert.Equal(102m, Assert.Single(second.Items).GrantedAmount);
        Assert.Equal(3, first.TotalCount);
        Assert.Equal(3, second.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Equal(2, first.PageSize);
        Assert.Empty((await service.ListAsync(9, 3, 2)).Items);
    }

    [Fact]
    public async Task ExpiredGrant_ProjectsOriginalAmountAndActualCurrencyWithoutCampaignOrWalletDetails()
    {
        await using var db = CreateDb();
        var grant = Grant(1, 9);
        grant.Campaign.Amount = 9999m;
        grant.Campaign.Title = "Internal campaign title";
        grant.Campaign.IsActive = false;
        grant.Campaign.IsDeleted = true;
        grant.WalletLot.WalletAccount.Currency = "EUR";
        db.WelcomeGiftGrants.Add(grant);
        await db.SaveChangesAsync();
        var item = Assert.Single((await new WelcomeGiftHistoryService(db).ListAsync(9)).Items);

        Assert.Equal("هدیهٔ خوشامدگویی", item.Title);
        Assert.Equal(101m, item.GrantedAmount);
        Assert.Equal("EUR", item.Currency);
        Assert.Equal(Granted, item.GrantedAtUtc);
        Assert.Equal(Granted.AddDays(30), item.ExpiresAtUtc);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(item, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.Equal(new[] { "title", "grantedAmount", "currency", "grantedAtUtc", "expiresAtUtc" },
            json.RootElement.EnumerateObject().Select(property => property.Name));
        Assert.EndsWith("Z", json.RootElement.GetProperty("grantedAtUtc").GetString());
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(100001, 20)]
    [InlineData(1, 0)]
    [InlineData(1, 101)]
    [InlineData(int.MaxValue, int.MaxValue)]
    public async Task RejectsUnboundedOrInvalidPagination(int page, int pageSize)
    {
        await using var db = CreateDb();
        await Assert.ThrowsAsync<ArgumentException>(() => new WelcomeGiftHistoryService(db).ListAsync(9, page, pageSize));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task RejectsInvalidIdentity(int userId)
    {
        await using var db = CreateDb();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => new WelcomeGiftHistoryService(db).ListAsync(userId));
    }

    [Fact]
    public async Task HttpRequiresAuthentication_IgnoresClientUserId_AndKeepsPrivateResponsesUncached()
    {
        var databaseName = $"welcome-history-http-{Guid.NewGuid():N}";
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes("isolated-welcome-history-fixture-signing-key-only-2026"));
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(AccountWelcomeGiftsController).Assembly);
        builder.Services.AddDbContext<KoochDbContext>(options => options.UseInMemoryDatabase(databaseName));
        builder.Services.AddScoped<WelcomeGiftHistoryService>();
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = "welcome-history-fixture", ValidAudience = "welcome-history-fixture",
                IssuerSigningKey = key, ValidateIssuerSigningKey = true, ClockSkew = TimeSpan.Zero
            });
        builder.Services.AddAuthorization();
        await using var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
            db.WelcomeGiftGrants.AddRange(Grant(1, 9), Grant(2, 22));
            await db.SaveChangesAsync();
        }
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        using var anonymous = await client.GetAsync("/api/account/welcome-gifts");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "invalid-fixture-token");
        using var invalid = await client.GetAsync("/api/account/welcome-gifts");
        Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
        var jwt = new JwtSecurityToken("welcome-history-fixture", "welcome-history-fixture",
            [new Claim(ClaimTypes.NameIdentifier, "9"), new Claim(ClaimTypes.Role, "Client")],
            expires: DateTime.UtcNow.AddMinutes(5), signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JwtSecurityTokenHandler().WriteToken(jwt));
        using var response = await client.GetAsync("/api/account/welcome-gifts?userId=22");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var history = await response.Content.ReadFromJsonAsync<PagedResult<GuestWelcomeGiftResponse>>();
        Assert.NotNull(history);
        Assert.Equal(1, history.TotalCount);
        Assert.Equal(101m, Assert.Single(history.Items).GrantedAmount);
        Assert.Equal(20, history.PageSize);
        using var badPage = await client.GetAsync("/api/account/welcome-gifts?pageSize=101");
        Assert.Equal(HttpStatusCode.BadRequest, badPage.StatusCode);
        await app.StopAsync();
    }

    private static KoochDbContext CreateDb() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase($"welcome-history-{Guid.NewGuid():N}").Options);

    private static WelcomeGiftGrant Grant(int id, int userId, DateTime? grantedAt = null)
    {
        var user = new User { Id = userId, FirstName = "Fixture", LastName = "Guest", PasswordHash = "fixture", Role = UserRole.Client };
        var account = new WalletAccount { UserId = userId, User = user, Currency = "IRR" };
        var lot = new WalletLot { WalletAccount = account, SourceType = WalletSourceType.PromotionalCredit };
        var entry = new WalletEntry { WalletAccount = account, WalletLot = lot, Amount = 100 + id };
        return new WelcomeGiftGrant
        {
            Id = id, UserId = userId, User = user, NationalCodeSnapshot = $"fixture-{id}",
            Campaign = new WelcomeGiftCampaign { Title = "Private", Amount = 100 + id },
            AmountSnapshot = 100 + id, ValidityDaysSnapshot = 30,
            GrantedAtUtc = grantedAt ?? Granted, ExpiresAtUtc = (grantedAt ?? Granted).AddDays(30),
            WalletLot = lot, WalletEntry = entry
        };
    }
}
