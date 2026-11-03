using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyDirectBookingContextTests
{
    [Fact]
    public async Task ApprovedProperty_IssuesBoundPolicyTwo_WithoutBookingOrOtherWrites()
    {
        using var fixture = new Fixture();
        var result = await fixture.Service.IssueAsync(1, new()
        {
            PropertySlug = " GARDEN-HOUSE ", IdempotencyKey = "  request-key  "
        });
        var trusted = fixture.Service.Validate(result.Token, 1, 10, "request-key");
        Assert.Equal(10, result.PropertyId);
        Assert.Equal(CommissionType.PropertyReferralCode, trusted.CommissionType);
        Assert.Equal(1, trusted.ClientId);
        Assert.Equal(fixture.Clock.Now, trusted.IssuedAtUtc);
        Assert.Equal(fixture.Clock.Now.AddMinutes(20), result.ExpiresAtUtc);
        Assert.Empty(await fixture.Db.BookingSessions.ToListAsync());
        Assert.Empty(await fixture.Db.Reservations.ToListAsync());
        Assert.All(fixture.Db.ChangeTracker.Entries(), entry => Assert.Equal(EntityState.Unchanged, entry.State));
        Assert.DoesNotContain("request-key", fixture.Protector.Unprotect(result.Token));
        Assert.Null(new BookingSession().CommissionType);
        Assert.Equal(CommissionType.Direct, new Reservation().CommissionType);
    }

    [Theory]
    [InlineData(PropertyStatus.Draft)]
    [InlineData(PropertyStatus.PendingReview)]
    [InlineData(PropertyStatus.Rejected)]
    [InlineData(PropertyStatus.Suspended)]
    public async Task NonApprovedProperty_IsIndistinguishableFromMissing(PropertyStatus status)
    {
        using var fixture = new Fixture();
        fixture.Db.Properties.Single().Status = status;
        await fixture.Db.SaveChangesAsync();
        var hidden = await Assert.ThrowsAsync<KeyNotFoundException>(() => fixture.Issue());
        var missing = await Assert.ThrowsAsync<KeyNotFoundException>(() => fixture.Service.IssueAsync(1,
            new() { PropertySlug = "missing", IdempotencyKey = "request-key" }));
        Assert.Equal(missing.Message, hidden.Message);
    }

    [Fact]
    public async Task DeletedProperty_IsNotPublic()
    {
        using var fixture = new Fixture();
        fixture.Db.Properties.Single().IsDeleted = true;
        await fixture.Db.SaveChangesAsync();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => fixture.Issue());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task InvalidInactiveOrDeletedUser_CannotIssue(int userId)
    {
        using var fixture = new Fixture();
        fixture.Db.Users.Add(new User { Id = 2, IsActive = false });
        fixture.Db.Users.Add(new User { Id = 3, IsDeleted = true });
        await fixture.Db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => fixture.Service.IssueAsync(userId,
            Fixture.Request()));
    }

    [Theory]
    [InlineData(2, 10, "request-key")]
    [InlineData(1, 11, "request-key")]
    [InlineData(1, 10, "different-key")]
    [InlineData(0, 10, "request-key")]
    [InlineData(1, 0, "request-key")]
    [InlineData(1, 10, " ")]
    public async Task Validation_RejectsWrongBinding(int userId, int propertyId, string key)
    {
        using var fixture = new Fixture();
        var response = await fixture.Issue();
        var exception = Assert.Throws<ArgumentException>(() =>
            fixture.Service.Validate(response.Token, userId, propertyId, key));
        Assert.DoesNotContain(response.Token, exception.ToString());
        Assert.DoesNotContain("different-key", exception.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("not-a-protected-token")]
    [InlineData("a.b.c")]
    public void MalformedTokens_AreRejectedWithoutEcho(string token)
    {
        using var fixture = new Fixture();
        Assert.Throws<ArgumentException>(() => fixture.Service.Validate(token, 1, 10, "request-key"));
    }

    [Fact]
    public async Task TamperAndWrongPurposeAndApplication_AreRejected()
    {
        using var fixture = new Fixture();
        var response = await fixture.Issue();
        var json = fixture.Protector.Unprotect(response.Token);
        var wrongPurpose = fixture.Provider.CreateProtector("Kooch.Other.v1").Protect(json);
        Assert.Throws<ArgumentException>(() => fixture.Service.Validate(wrongPurpose, 1, 10, "request-key"));
        var tampered = response.Token.ToCharArray();
        tampered[tampered.Length / 2] = tampered[tampered.Length / 2] == 'A' ? 'B' : 'A';
        Assert.Throws<ArgumentException>(() => fixture.Service.Validate(new string(tampered), 1, 10, "request-key"));
        var otherApplication = DataProtectionProvider.Create(new DirectoryInfo(fixture.Path),
            builder => builder.SetApplicationName("other-application"));
        var otherToken = otherApplication.CreateProtector(PropertyDirectBookingContextService.Purpose).Protect(json);
        Assert.Throws<ArgumentException>(() => fixture.Service.Validate(otherToken, 1, 10, "request-key"));
    }

    [Theory]
    [InlineData("Version", "2")]
    [InlineData("Policy", "0")]
    [InlineData("Policy", "1")]
    [InlineData("Policy", "3")]
    [InlineData("ClientId", "0")]
    [InlineData("PropertyId", "0")]
    [InlineData("IdempotencyKeyHash", "null")]
    [InlineData("IdempotencyKeyHash", "\"AA==\"")]
    [InlineData("IssuedAtUtc", "\"0001-01-01T00:00:00+00:00\"")]
    [InlineData("IssuedAtUtc", "\"2026-11-03T11:00:00+00:00\"")]
    [InlineData("ExpiresAtUtc", "\"2026-11-03T10:00:00+00:00\"")]
    [InlineData("ExpiresAtUtc", "\"2026-11-04T10:00:00+00:00\"")]
    [InlineData("Version", "null")]
    [InlineData("Unexpected", "1")]
    public async Task AuthenticatedPayload_WithInvalidFields_IsRejected(string field, string jsonValue)
    {
        using var fixture = new Fixture();
        var response = await fixture.Issue();
        var payload = JsonNode.Parse(fixture.Protector.Unprotect(response.Token))!;
        payload[field] = JsonNode.Parse(jsonValue);
        var token = fixture.Protector.Protect(payload.ToJsonString());
        Assert.Throws<ArgumentException>(() => fixture.Service.Validate(token, 1, 10, "request-key"));
    }

    [Theory]
    [InlineData("Version")]
    [InlineData("ClientId")]
    [InlineData("PropertyId")]
    [InlineData("Policy")]
    [InlineData("IdempotencyKeyHash")]
    [InlineData("IssuedAtUtc")]
    [InlineData("ExpiresAtUtc")]
    public async Task MissingPayloadFields_AreRejected(string field)
    {
        using var fixture = new Fixture();
        var response = await fixture.Issue();
        var payload = JsonNode.Parse(fixture.Protector.Unprotect(response.Token))!.AsObject();
        payload.Remove(field);
        Assert.Throws<ArgumentException>(() => fixture.Service.Validate(
            fixture.Protector.Protect(payload.ToJsonString()), 1, 10, "request-key"));
    }

    [Fact]
    public async Task Expiration_UsesInjectedClock_AndRejectsExactBoundaryAndReplay()
    {
        using var fixture = new Fixture();
        var response = await fixture.Issue();
        fixture.Clock.Now = response.ExpiresAtUtc.AddTicks(-1);
        fixture.Service.Validate(response.Token, 1, 10, "request-key");
        fixture.Clock.Now = response.ExpiresAtUtc;
        Assert.Throws<ArgumentException>(() => fixture.Service.Validate(response.Token, 1, 10, "request-key"));
    }

    [Fact]
    public async Task KeyNormalization_MatchesBookingContract_AndLengthIsBoundedAfterTrim()
    {
        using var fixture = new Fixture();
        foreach (var invalidKey in new[] { "", "   ", new string('x', 201) })
        {
            await Assert.ThrowsAsync<ArgumentException>(() => fixture.Service.IssueAsync(1,
                new() { PropertySlug = "garden-house", IdempotencyKey = invalidKey }));
        }
        var key = new string('x', 200);
        var response = await fixture.Service.IssueAsync(1,
            new() { PropertySlug = "garden-house", IdempotencyKey = $" {key} " });
        fixture.Service.Validate(response.Token, 1, 10, key);
    }

    [Fact]
    public async Task SamePersistentRing_RecoversAcrossProviders_MissingKeysFailClosed()
    {
        using var fixture = new Fixture();
        var response = await fixture.Issue();
        var restartedProvider = DataProtectionProvider.Create(new DirectoryInfo(fixture.Path),
            builder => builder.SetApplicationName("context-tests"));
        var restarted = fixture.CreateService(restartedProvider);
        Assert.Equal(10, restarted.Validate(response.Token, 1, 10, "request-key").PropertyId);
        var emptyPath = System.IO.Path.Combine(fixture.Path, "empty-ring");
        Directory.CreateDirectory(emptyPath);
        var missingKeysProvider = DataProtectionProvider.Create(new DirectoryInfo(emptyPath),
            builder => builder.SetApplicationName("context-tests"));
        Assert.Throws<ArgumentException>(() => fixture.CreateService(missingKeysProvider)
            .Validate(response.Token, 1, 10, "request-key"));
    }

    [Fact]
    public async Task MissingConfiguration_DisablesOnlyContextEndpoint_WithGeneric503()
    {
        using var fixture = new Fixture();
        var service = new PropertyDirectBookingContextService(fixture.Db, fixture.Provider,
            Options.Create(new PropertyDirectBookingContextOptions()), fixture.Clock);
        var controller = new AccountPropertyDirectBookingContextsController(service)
        {
            ControllerContext = new() { HttpContext = AuthenticatedContext(1) }
        };
        var result = await controller.Create(Fixture.Request(), default);
        var unavailable = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(503, unavailable.StatusCode);
        Assert.DoesNotContain(fixture.Path, JsonSerializer.Serialize(unavailable.Value));
        Assert.Throws<PropertyDirectBookingContextUnavailableException>(() =>
            service.Validate("token", 1, 10, "request-key"));
    }

    [Fact]
    public async Task Controller_UsesClaimsRatherThanBody_AndReturnsOnlyContractFields()
    {
        using var fixture = new Fixture();
        var controller = new AccountPropertyDirectBookingContextsController(fixture.Service)
        {
            ControllerContext = new() { HttpContext = AuthenticatedContext(1) }
        };
        var result = await controller.Create(Fixture.Request(), default);
        var response = Assert.IsType<PropertyDirectBookingContextResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        fixture.Service.Validate(response.Token, 1, 10, "request-key");
        Assert.Equal(new[] { "PropertyId", "Token", "ExpiresAtUtc" },
            typeof(PropertyDirectBookingContextResponse).GetProperties().Select(property => property.Name));
        Assert.Equal(new[] { "PropertySlug", "IdempotencyKey" },
            typeof(PropertyDirectBookingContextRequest).GetProperties().Select(property => property.Name));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<PropertyDirectBookingContextRequest>(
            "{\"propertySlug\":\"garden-house\",\"idempotencyKey\":\"key\",\"commissionType\":2}",
            new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    [Fact]
    public async Task Endpoint_RequiresAuthentication_NotPlatformRole_AnonymousPolicyDenies()
    {
        var type = typeof(AccountPropertyDirectBookingContextsController);
        var authorization = Assert.Single(type.GetCustomAttributes<AuthorizeAttribute>());
        Assert.Null(authorization.Policy);
        Assert.Null(authorization.Roles);
        Assert.Empty(type.GetCustomAttributes<AllowAnonymousAttribute>());
        Assert.Single(type.GetMethods(), method => method.GetCustomAttribute<HttpPostAttribute>() is not null);
        Assert.DoesNotContain(type.GetMethods(), method => method.GetCustomAttribute<HttpGetAttribute>() is not null);
        Assert.Equal(PropertyDirectBookingContextRateLimitPolicy.Name,
            type.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
        var requirement = new DenyAnonymousAuthorizationRequirement();
        var context = new AuthorizationHandlerContext([requirement], new ClaimsPrincipal(new ClaimsIdentity()), null);
        await requirement.HandleAsync(context);
        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public void RateLimit_IsBoundedAndPartitionedByTrustedUser()
    {
        var partition = PropertyDirectBookingContextRateLimitPolicy.CreatePartition(AuthenticatedContext(1));
        using var limiter = partition.Factory(partition.PartitionKey);
        for (var i = 0; i < 10; i++)
        {
            using var lease = limiter.AttemptAcquire();
            Assert.True(lease.IsAcquired);
        }
        using var rejected = limiter.AttemptAcquire();
        Assert.False(rejected.IsAcquired);
        Assert.NotEqual(partition.PartitionKey,
            PropertyDirectBookingContextRateLimitPolicy.CreatePartition(AuthenticatedContext(2)).PartitionKey);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(61)]
    public void Registration_ValidatesLifetime(int minutes)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"{PropertyDirectBookingContextOptions.SectionName}:LifetimeMinutes"] = minutes.ToString()
        }).Build();
        using var services = new ServiceCollection().AddPropertyDirectBookingContexts(configuration).BuildServiceProvider();
        Assert.Throws<OptionsValidationException>(() =>
            services.GetRequiredService<IOptions<PropertyDirectBookingContextOptions>>().Value);
    }

    [Fact]
    public async Task RegisteredSharedProvider_UsesConfiguredPersistentRingAndLifetimeAcrossRestarts()
    {
        using var fixture = new Fixture();
        var path = System.IO.Path.Combine(fixture.Path, "registered-ring");
        Directory.CreateDirectory(path);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"{PropertyDirectBookingContextOptions.SectionName}:KeyRingPath"] = path,
            [$"{PropertyDirectBookingContextOptions.SectionName}:ApplicationName"] = "registered-context-tests",
            [$"{PropertyDirectBookingContextOptions.SectionName}:LifetimeMinutes"] = "5"
        }).Build();
        PropertyDirectBookingContextResponse response;
        using (var services = new ServiceCollection().AddPropertyDirectBookingContexts(configuration).BuildServiceProvider())
        {
            var service = new PropertyDirectBookingContextService(fixture.Db,
                services.GetRequiredService<IDataProtectionProvider>(),
                services.GetRequiredService<IOptions<PropertyDirectBookingContextOptions>>(), fixture.Clock);
            response = await service.IssueAsync(1, Fixture.Request());
            Assert.Equal(fixture.Clock.Now.AddMinutes(5), response.ExpiresAtUtc);
            Assert.NotEmpty(Directory.GetFiles(path, "key-*.xml"));
        }

        using var restartedServices = new ServiceCollection().AddPropertyDirectBookingContexts(configuration).BuildServiceProvider();
        var restartedService = new PropertyDirectBookingContextService(fixture.Db,
            restartedServices.GetRequiredService<IDataProtectionProvider>(),
            restartedServices.GetRequiredService<IOptions<PropertyDirectBookingContextOptions>>(), fixture.Clock);
        Assert.Equal(CommissionType.PropertyReferralCode,
            restartedService.Validate(response.Token, 1, 10, "request-key").CommissionType);
    }

    [Theory]
    [InlineData("relative-path", "test")]
    [InlineData("", "test")]
    [InlineData("C:\\unprovisioned-kooch-test-ring", "test")]
    [InlineData("", "")]
    public async Task InvalidPersistentRingConfiguration_NeverFallsBackToDefaultKeys(string path, string applicationName)
    {
        using var fixture = new Fixture();
        var service = new PropertyDirectBookingContextService(fixture.Db, fixture.Provider,
            Options.Create(new PropertyDirectBookingContextOptions { KeyRingPath = path, ApplicationName = applicationName }), fixture.Clock);
        await Assert.ThrowsAsync<PropertyDirectBookingContextUnavailableException>(() => service.IssueAsync(1, Fixture.Request()));
    }

    private static DefaultHttpContext AuthenticatedContext(int userId) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, UserRole.Client.ToString())],
            "test"))
    };

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 3, 10, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class Fixture : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "kooch-context-tests-" + Guid.NewGuid().ToString("N"));
        public Clock Clock { get; } = new();
        public KoochDbContext Db { get; } = new(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
        public IDataProtectionProvider Provider { get; }
        public IDataProtector Protector => Provider.CreateProtector(PropertyDirectBookingContextService.Purpose);
        public PropertyDirectBookingContextService Service { get; }

        public Fixture()
        {
            Directory.CreateDirectory(Path);
            Provider = DataProtectionProvider.Create(new DirectoryInfo(Path), builder => builder.SetApplicationName("context-tests"));
            Db.Users.Add(new User { Id = 1, IsActive = true });
            Db.Properties.Add(new Property { Id = 10, Slug = "garden-house", Status = PropertyStatus.Approved });
            Db.SaveChanges();
            Service = CreateService(Provider);
        }

        public PropertyDirectBookingContextService CreateService(IDataProtectionProvider provider) => new(Db,
            provider, Options.Create(new PropertyDirectBookingContextOptions
            { KeyRingPath = Path, ApplicationName = "context-tests" }), Clock);

        public static PropertyDirectBookingContextRequest Request() => new()
        { PropertySlug = "garden-house", IdempotencyKey = "request-key" };
        public Task<PropertyDirectBookingContextResponse> Issue() => Service.IssueAsync(1, Request());

        public void Dispose()
        {
            Db.Dispose();
            // This fixture owns only this freshly generated temporary directory and its test keys.
            Directory.Delete(Path, recursive: true);
        }
    }
}
