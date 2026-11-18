using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Filters;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class AdminManualBookingSqlServerTests
{
    [SqlServerWalletFact]
    public async Task PayLater_HttpCreateDetailsPrepareAndPayment_ExposeCapabilityAndConfirm()
    {
        var seed = await SeedReceivedAsync();
        using var template = Open(); // Reject any non-isolated SQL target before starting the HTTP host.
        var connection = template.Database.GetConnectionString();
        var key = new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(64));
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        json.Converters.Add(new JsonStringEnumConverter());

        // Real controllers/JSON/auth policies and services, without Program's live config or background workers.
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Testing", ApplicationName = typeof(AdminReservationsController).Assembly.GetName().Name
        });
        builder.Configuration.Sources.Clear();
        builder.Configuration.AddInMemoryCollection();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddDbContext<KoochDbContext>(options => options.UseSqlServer(connection));
        builder.Services.AddScoped<PropertyAccessService>();
        builder.Services.AddScoped<IPropertyAuthorizationService>(sp => sp.GetRequiredService<PropertyAccessService>());
        builder.Services.AddScoped<IPermissionService, PermissionService>();
        builder.Services.AddScoped<IReservationService>(sp => PreparationService(sp.GetRequiredService<KoochDbContext>()));
        builder.Services.AddScoped<IEffectiveAvailabilityService, EffectiveAvailabilityService>();
        builder.Services.AddScoped<ChildPricingRuleResolver>();
        builder.Services.AddScoped<IChildPricingRuleResolver>(sp => sp.GetRequiredService<ChildPricingRuleResolver>());
        builder.Services.AddScoped<IReservationRulesResolver, ReservationRulesResolver>();
        builder.Services.AddScoped<PricingService>();
        builder.Services.AddScoped<IReservationPricingService, ReservationPricingService>();
        builder.Services.AddScoped<IReservationAvailabilityService, ReservationAvailabilityService>();
        builder.Services.AddScoped<INotificationService>(_ => new RecordingNotificationService());
        builder.Services.AddScoped<ReservationCancellationRequestService>();
        builder.Services.AddScoped<IAdminManualPaymentService>(sp => new AdminManualPaymentService(
            sp.GetRequiredService<KoochDbContext>(), sp.GetRequiredService<IEffectiveAvailabilityService>(),
            new PaymentFinancializationService(sp.GetRequiredService<KoochDbContext>(), new CommissionPolicyResolver(sp.GetRequiredService<KoochDbContext>())),
            new ReservationVoucherService(sp.GetRequiredService<KoochDbContext>(), new VoucherNumberGenerator(sp.GetRequiredService<KoochDbContext>())),
            sp.GetRequiredService<IPermissionService>(), sp.GetRequiredService<IPropertyAuthorizationService>()));
        builder.Services.AddControllers(options => options.Filters.Add<ApiExceptionFilter>())
            .AddApplicationPart(typeof(AdminReservationsController).Assembly)
            .AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true, ValidIssuer = "isolated-pay-later", ValidateAudience = true,
                ValidAudience = "isolated-pay-later", ValidateLifetime = true, ValidateIssuerSigningKey = true,
                IssuerSigningKey = key
            });
        builder.Services.AddAuthorization(options => options.AddPolicy(AuthorizationPolicies.AdminUsers,
            policy => policy.RequireRole(nameof(UserRole.SuperAdmin), nameof(UserRole.AdminAssistant))));
        builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
        builder.Services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();
        await using var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
        var jwt = new JwtSecurityToken("isolated-pay-later", "isolated-pay-later",
            [new(ClaimTypes.NameIdentifier, seed.AdminId.ToString()), new(ClaimTypes.Role, nameof(UserRole.SuperAdmin))],
            expires: DateTime.UtcNow.AddMinutes(10), signingCredentials: new(key, SecurityAlgorithms.HmacSha256));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JwtSecurityTokenHandler().WriteToken(jwt));

        using var create = await client.PostAsJsonAsync("/api/admin/reservations", TypeRequest(seed, 1), json);
        Assert.True(create.IsSuccessStatusCode, await create.Content.ReadAsStringAsync());
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("reservations")[0].GetProperty("id").GetInt32();
        var details = await client.GetFromJsonAsync<JsonElement>($"/api/admin/reservations/{id}");
        Assert.Equal("Pending", details.GetProperty("status").GetString());
        Assert.Equal("AdminCreated", details.GetProperty("source").GetString());
        Assert.True(details.GetProperty("canPrepareManualPayment").GetBoolean());
        Assert.DoesNotContain(details.GetProperty("allowedStatusTransitions").EnumerateArray(), status => status.GetString() == "Confirmed");

        using var prepare = await client.PutAsync($"/api/admin/reservations/{id}/prepare-payment", null);
        Assert.True(prepare.IsSuccessStatusCode, await prepare.Content.ReadAsStringAsync());
        var prepared = await client.GetFromJsonAsync<JsonElement>($"/api/admin/reservations/{id}");
        Assert.Equal("ApprovedAwaitingPayment", prepared.GetProperty("status").GetString());
        Assert.True(prepared.GetProperty("isPaymentEligible").GetBoolean());
        Assert.True(prepared.GetProperty("paymentExpiresAtUtc").GetDateTime() > DateTime.UtcNow);

        using var pay = await client.PostAsJsonAsync("/api/admin/manual-payments", new
        {
            reservationId = id, amount = 200m, currency = "IRR", method = "BankTransfer", paymentDate = "2026-11-18"
        });
        Assert.True(pay.IsSuccessStatusCode, await pay.Content.ReadAsStringAsync());
        var payment = await pay.Content.ReadFromJsonAsync<JsonElement>();
        using var approve = await client.PostAsync($"/api/admin/manual-payments/{payment.GetProperty("paymentId").GetInt32()}/approve", null);
        Assert.True(approve.IsSuccessStatusCode, await approve.Content.ReadAsStringAsync());
        var confirmed = await client.GetFromJsonAsync<JsonElement>($"/api/admin/reservations/{id}");
        Assert.Equal("Confirmed", confirmed.GetProperty("status").GetString());
        Assert.Equal(0, confirmed.GetProperty("remainingAmount").GetDecimal());
        await app.StopAsync();
        await using var fresh = Open();
        Assert.Equal(ReservationStatus.Confirmed, (await fresh.Reservations.SingleAsync(row => row.Id == id)).Status);
        Assert.Single(await fresh.Payments.Where(row => row.ReservationId == id && row.Status == PaymentStatus.Successful).ToListAsync());
    }
}
