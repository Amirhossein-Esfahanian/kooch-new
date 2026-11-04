using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Xml.Linq;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Filters;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyDirectContextHttpIntegrationTests
{
    [Fact]
    public async Task AnonymousRequest_IsChallengedByJwtMiddleware()
    {
        await using var fixture = await Fixture.CreateAsync();
        using var response = await fixture.PostAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains(response.Headers.WwwAuthenticate, value => value.Scheme == "Bearer");
    }

    [Fact]
    public async Task AuthServiceLogin_AuthenticatedHttpIssue_RecoversFromEncryptedRingInNewProvider()
    {
        await using var fixture = await Fixture.CreateAsync();
        var jwt = await fixture.LoginAsync();
        var key = "http-context-" + Guid.NewGuid().ToString("N");
        var before = DateTimeOffset.UtcNow;
        using var response = await fixture.PostAsync(jwt, key: key);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore == true);
        var issued = await response.Content.ReadFromJsonAsync<PropertyDirectBookingContextResponse>();
        Assert.NotNull(issued);
        Assert.Equal(Fixture.PropertyId, issued.PropertyId);
        Assert.False(string.IsNullOrWhiteSpace(issued.Token));
        Assert.InRange(issued.ExpiresAtUtc, before.AddMinutes(20), DateTimeOffset.UtcNow.AddMinutes(20));
        fixture.AssertEncryptedKeys();

        using var rebuilt = fixture.RebuildProvider(fixture.RingPath);
        var provider = rebuilt.GetRequiredService<IDataProtectionProvider>();
        Assert.NotSame(fixture.App.Services.GetRequiredService<IDataProtectionProvider>(), provider);
        await using var scope = fixture.App.Services.CreateAsyncScope();
        var service = fixture.Validator(rebuilt, scope.ServiceProvider.GetRequiredService<KoochDbContext>());
        var trusted = service.Validate(issued.Token, Fixture.UserId, Fixture.PropertyId, key);
        Assert.Equal(CommissionType.PropertyReferralCode, trusted.CommissionType);
        Assert.Equal(Fixture.UserId, trusted.ClientId);
        Assert.Equal(Fixture.PropertyId, trusted.PropertyId);

        var otherRing = Path.Combine(fixture.RootPath, "different-ring");
        Directory.CreateDirectory(otherRing);
        using var unrelated = fixture.RebuildProvider(otherRing);
        var wrongRingService = fixture.Validator(unrelated, scope.ServiceProvider.GetRequiredService<KoochDbContext>());
        Assert.Throws<ArgumentException>(() => wrongRingService.Validate(issued.Token, Fixture.UserId, Fixture.PropertyId, key));
        Assert.Throws<CryptographicException>(() => provider.CreateProtector("Kooch.Unrelated.HttpTests.v1").Unprotect(issued.Token));
        var wrongPurpose = provider.CreateProtector("Kooch.Unrelated.HttpTests.v1").Protect("{}");
        Assert.Throws<ArgumentException>(() => service.Validate(wrongPurpose, Fixture.UserId, Fixture.PropertyId, key));
        await fixture.AssertNoBookingsAsync();
    }

    [Theory]
    [InlineData("malformed")]
    [InlineData("signature")]
    [InlineData("expired")]
    [InlineData("issuer")]
    [InlineData("audience")]
    [InlineData("revoked")]
    [InlineData("inactive")]
    [InlineData("deleted")]
    public async Task InvalidCredentials_AreRejectedBeforeIssuance(string scenario)
    {
        await using var fixture = await Fixture.CreateAsync();
        var jwt = await fixture.LoginAsync(options =>
        {
            if (scenario == "signature") options.Key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
            if (scenario == "expired") options.AccessTokenExpirationDays = -1;
            if (scenario == "issuer") options.Issuer = "unrelated-test-issuer";
            if (scenario == "audience") options.Audience = "unrelated-test-audience";
        });
        if (scenario == "malformed") jwt = "not-a-fixture-jwt";
        if (scenario is "revoked" or "inactive" or "deleted")
            await fixture.ChangeUserAsync(user =>
            {
                if (scenario == "revoked") user.SecurityStampVersion++;
                if (scenario == "inactive") user.IsActive = false;
                if (scenario == "deleted") user.IsDeleted = true;
            });
        using var response = await fixture.PostAsync(jwt);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(PropertyStatus.Draft)]
    [InlineData(PropertyStatus.PendingReview)]
    [InlineData(PropertyStatus.Rejected)]
    [InlineData(PropertyStatus.Suspended)]
    public async Task NonPublicProperty_IsNotFound(PropertyStatus status)
    {
        await using var fixture = await Fixture.CreateAsync();
        var jwt = await fixture.LoginAsync();
        await fixture.ChangePropertyAsync(property => property.Status = status);
        using var response = await fixture.PostAsync(jwt);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MissingOrDeletedProperty_IsNotFound(bool deleted)
    {
        await using var fixture = await Fixture.CreateAsync();
        var jwt = await fixture.LoginAsync();
        if (deleted) await fixture.ChangePropertyAsync(property => property.IsDeleted = true);
        using var response = await fixture.PostAsync(jwt, slug: deleted ? Fixture.Slug : "missing-fixture-property");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("empty")]
    [InlineData("whitespace")]
    [InlineData("overlength")]
    public async Task InvalidIdempotencyKey_IsBadRequest(string scenario)
    {
        await using var fixture = await Fixture.CreateAsync();
        var jwt = await fixture.LoginAsync();
        var key = scenario switch { "null" => null, "empty" => "", "whitespace" => "   ", _ => new string('x', 201) };
        using var response = await fixture.PostAsync(jwt, key: key);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ActualRateLimit_AllowsTenThenRejects_AndSeparatesUsers()
    {
        await using var fixture = await Fixture.CreateAsync();
        var first = await fixture.LoginAsync();
        for (var i = 0; i < 10; i++)
        {
            using var response = await fixture.PostAsync(first, key: "rate-test-" + i);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        using var denied = await fixture.PostAsync(first);
        Assert.Equal(HttpStatusCode.TooManyRequests, denied.StatusCode);
        var second = await fixture.LoginAsync(userId: Fixture.OtherUserId);
        using var independent = await fixture.PostAsync(second);
        Assert.Equal(HttpStatusCode.OK, independent.StatusCode);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        internal const int UserId = 1, OtherUserId = 2, PropertyId = 10;
        internal const string Slug = "isolated-http-property";
        private const string Endpoint = "/api/account/property-direct-booking-contexts";
        private readonly string password = Guid.NewGuid().ToString("N");
        private readonly string applicationName = "Kooch.IsolatedContextHttp." + Guid.NewGuid().ToString("N");
        private readonly SaveCounter saves = new();
        private readonly ServiceProvider databaseServices = new ServiceCollection()
            .AddEntityFrameworkInMemoryDatabase().BuildServiceProvider();
        private readonly RSA rsa = RSA.Create(2048);
        private readonly X509Certificate2 certificate;
        private readonly JwtOptions jwt = new()
        {
            Key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64)),
            Issuer = "Kooch.IsolatedContextHttp", Audience = "Kooch.IsolatedContextHttp", AccessTokenExpirationDays = 1
        };
        internal string RootPath { get; } = Path.Combine(Path.GetTempPath(), "kooch-context-http-" + Guid.NewGuid().ToString("N"));
        internal string RingPath => Path.Combine(RootPath, "ring");
        internal WebApplication App { get; private set; } = null!;
        private HttpClient client = null!;

        private Fixture()
        {
            // Fixture-only certificate stays in memory: no Windows certificate/trust store is used.
            var request = new CertificateRequest("CN=Kooch Isolated Context HTTP Tests", rsa,
                HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddHours(1));
            Directory.CreateDirectory(RingPath);
        }

        internal static async Task<Fixture> CreateAsync()
        {
            var fixture = new Fixture();
            try { await fixture.StartAsync(); return fixture; }
            catch { await fixture.DisposeAsync(); throw; }
        }

        private async Task StartAsync()
        {
            // Do not execute Program.cs or load live appsettings, startup writers, credentials or rings.
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing", ContentRootPath = RootPath,
                ApplicationName = typeof(AccountPropertyDirectBookingContextsController).Assembly.GetName().Name
            });
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [WebHostDefaults.EnvironmentKey] = builder.Environment.EnvironmentName,
                [WebHostDefaults.ApplicationKey] = builder.Environment.ApplicationName,
                [WebHostDefaults.ContentRootKey] = RootPath
            });
            builder.Logging.ClearProviders();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            var database = Guid.NewGuid().ToString("N");
            builder.Services.AddDbContext<KoochDbContext>(options => options.UseInMemoryDatabase(database)
                .UseInternalServiceProvider(databaseServices).AddInterceptors(saves));
            builder.Services.AddSingleton(TimeProvider.System);
            ConfigureProtection(builder.Services, RingPath);
            builder.Services.AddControllers(options => options.Filters.Add<ApiExceptionFilter>())
                .AddApplicationPart(typeof(AccountPropertyDirectBookingContextsController).Assembly)
                .ConfigureApplicationPartManager(manager => manager.FeatureProviders.Add(new ContextControllerOnly()));
            ConfigureAuthentication(builder.Services);
            builder.Services.AddAuthorization();
            builder.Services.AddRateLimiter(options =>
            {
                options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                options.AddPolicy<string>(PropertyDirectBookingContextRateLimitPolicy.Name, PropertyDirectBookingContextRateLimitPolicy.CreatePartition);
            });
            App = builder.Build();
            await using (var scope = App.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
                var hash = BCrypt.Net.BCrypt.HashPassword(password);
                db.Users.AddRange(new[] { UserId, OtherUserId }.Select(id => new User
                {
                    Id = id, Email = $"http-fixture-{id}@example.test", FirstName = "Fixture", LastName = "Traveler",
                    PasswordHash = hash, IsActive = true, Role = UserRole.Client, SecurityStampVersion = 7
                }));
                db.Properties.Add(new Property { Id = PropertyId, Slug = Slug, Status = PropertyStatus.Approved });
                await db.SaveChangesAsync();
            }
            App.UseRouting();
            App.UseAuthentication();
            App.UseRateLimiter();
            App.UseAuthorization();
            App.MapControllers();
            await App.StartAsync();
            var address = new Uri(App.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single());
            Assert.True(address.IsLoopback && address.Port != 5081);
            client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
            { BaseAddress = address, Timeout = TimeSpan.FromSeconds(15) };
        }

        private void ConfigureProtection(IServiceCollection services, string path)
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                [$"{PropertyDirectBookingContextOptions.SectionName}:KeyRingPath"] = path,
                [$"{PropertyDirectBookingContextOptions.SectionName}:ApplicationName"] = applicationName
            }).Build();
            services.AddPropertyDirectBookingContexts(config);
            services.AddDataProtection().ProtectKeysWithCertificate(certificate).UnprotectKeysWithAnyCertificate(certificate);
        }

        private void ConfigureAuthentication(IServiceCollection services)
        {
            // Same JWT checks and production session-version validator as Program.cs, not a fake auth handler.
            services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ValidateIssuerSigningKey = true,
                    ValidIssuer = jwt.Issuer, ValidAudience = jwt.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)), ClockSkew = TimeSpan.FromSeconds(30)
                };
                options.Events = new JwtBearerEvents
                {
                    OnTokenValidated = async context =>
                    {
                        if (!int.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ||
                            !int.TryParse(context.Principal?.FindFirstValue(KoochJwtClaimTypes.SessionVersion), out var version) ||
                            !await UserSessionVersionValidator.IsValidAsync(context.HttpContext.RequestServices.GetRequiredService<KoochDbContext>(),
                                userId, version, context.HttpContext.RequestAborted))
                            context.Fail(UserSessionVersionValidator.RevokedFailureMessage);
                    }
                };
            });
        }

        internal async Task<string> LoginAsync(Action<JwtOptions>? change = null, int userId = UserId)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
            var options = new JwtOptions { Key = jwt.Key, Issuer = jwt.Issuer, Audience = jwt.Audience, AccessTokenExpirationDays = jwt.AccessTokenExpirationDays };
            change?.Invoke(options);
            var auth = new AuthService(db, Options.Create(options), new PropertyAccessService(db), App.Environment, new NotificationService(db));
            var response = await auth.LoginAsync(new LoginRequest { Identifier = $"http-fixture-{userId}@example.test", Password = password });
            Assert.NotNull(response);
            return response.Token;
        }

        internal async Task<HttpResponseMessage> PostAsync(string? jwtToken = null, string slug = Slug, string? key = "http-test-key")
        {
            var before = Volatile.Read(ref saves.Count);
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint)
            { Content = JsonContent.Create(new { propertySlug = slug, idempotencyKey = key }) };
            if (jwtToken is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwtToken);
            var response = await client.SendAsync(request);
            Assert.Equal(before, Volatile.Read(ref saves.Count));
            await AssertNoBookingsAsync();
            return response;
        }

        internal async Task AssertNoBookingsAsync()
        {
            await using var scope = App.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
            Assert.False(await db.BookingSessions.AnyAsync());
            Assert.False(await db.Reservations.AnyAsync());
        }

        internal async Task ChangeUserAsync(Action<User> change)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
            change(await db.Users.SingleAsync(user => user.Id == UserId));
            await db.SaveChangesAsync();
        }

        internal async Task ChangePropertyAsync(Action<Property> change)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
            change(await db.Properties.SingleAsync(property => property.Id == PropertyId));
            await db.SaveChangesAsync();
        }

        internal ServiceProvider RebuildProvider(string path)
        {
            var services = new ServiceCollection().AddLogging();
            ConfigureProtection(services, path);
            return services.BuildServiceProvider();
        }

        internal PropertyDirectBookingContextService Validator(ServiceProvider services, KoochDbContext db) => new(db,
            services.GetRequiredService<IDataProtectionProvider>(), services.GetRequiredService<IOptions<PropertyDirectBookingContextOptions>>(), TimeProvider.System);

        internal void AssertEncryptedKeys()
        {
            var keys = Directory.GetFiles(RingPath, "key-*.xml");
            Assert.NotEmpty(keys);
            foreach (var path in keys)
            {
                var xml = XDocument.Load(path);
                Assert.Contains(xml.Descendants(), element => element.Name.LocalName == "encryptedSecret");
                Assert.DoesNotContain(xml.Descendants(), element => element.Name.LocalName == "masterKey");
            }
        }

        public async ValueTask DisposeAsync()
        {
            client?.Dispose();
            if (App is not null) await App.DisposeAsync();
            await databaseServices.DisposeAsync();
            certificate.Dispose();
            rsa.Dispose();
            var root = Path.GetFullPath(RootPath);
            if (Path.GetDirectoryName(root) != Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) ||
                !Path.GetFileName(root).StartsWith("kooch-context-http-", StringComparison.Ordinal))
                throw new InvalidOperationException("Refusing to delete an unexpected fixture directory.");
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private sealed class ContextControllerOnly : IApplicationFeatureProvider<ControllerFeature>
    {
        public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
        {
            foreach (var controller in feature.Controllers.Where(type => type.AsType() != typeof(AccountPropertyDirectBookingContextsController)).ToArray())
                feature.Controllers.Remove(controller);
        }
    }

    private sealed class SaveCounter : SaveChangesInterceptor
    {
        internal int Count;
        public override InterceptionResult<int> SavingChanges(DbContextEventData data, InterceptionResult<int> result)
        { Interlocked.Increment(ref Count); return result; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { Interlocked.Increment(ref Count); return ValueTask.FromResult(result); }
    }
}
