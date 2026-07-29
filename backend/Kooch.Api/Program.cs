using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Filters;
using Kooch.Api.Integrations.PnlDev;
using Kooch.Api.Services;
using Kooch.Api.Services.Holidays;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<KoochDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.Configure<PnlDevOptions>(
    builder.Configuration.GetSection(PnlDevOptions.SectionName));
builder.Services.Configure<HolidayCalendarSynchronizationOptions>(
    builder.Configuration.GetSection(HolidayCalendarSynchronizationOptions.SectionName));
builder.Services.AddHttpClient<IHolidayProvider, PnlDevHolidayProvider>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<IHolidayCalendarSynchronizationService, HolidayCalendarSynchronizationService>();
builder.Services.AddScoped<IHolidayCalendarQueryService, HolidayCalendarQueryService>();
builder.Services.AddSingleton<HolidayCalendarSolarYearResolver>();
builder.Services.AddHostedService<HolidayCalendarSyncHostedService>();

var jwtSection = builder.Configuration.GetSection(JwtOptions.SectionName);
var jwtOptions = jwtSection.Get<JwtOptions>()
    ?? throw new InvalidOperationException("JWT configuration is missing.");

if (jwtOptions.Key.Length < 32 ||
    string.IsNullOrWhiteSpace(jwtOptions.Issuer) ||
    string.IsNullOrWhiteSpace(jwtOptions.Audience) ||
    jwtOptions.ExpiresMinutes <= 0)
{
    throw new InvalidOperationException("JWT configuration is invalid.");
}

builder.Services.Configure<JwtOptions>(jwtSection);
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<PropertyAccessService>();
builder.Services.AddScoped<IPropertyAuthorizationService>(serviceProvider =>
    serviceProvider.GetRequiredService<PropertyAccessService>());
builder.Services.AddScoped<IPropertyAccessService>(serviceProvider =>
    serviceProvider.GetRequiredService<PropertyAccessService>());
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddScoped<IPropertyService, PropertyService>();
builder.Services.AddScoped<IAdminPropertyOwnerAccountService, AdminPropertyOwnerAccountService>();
builder.Services.AddScoped<IAdminUserService, AdminUserService>();
builder.Services.AddScoped<IPropertyCompletionService, PropertyCompletionService>();
builder.Services.AddScoped<IPropertyDescriptionService, PropertyDescriptionService>();
builder.Services.AddScoped<IPropertyImageService, PropertyImageService>();
builder.Services.AddScoped<IPropertyAmenityService, PropertyAmenityService>();
builder.Services.AddScoped<IPropertyCommonAreaService, PropertyCommonAreaService>();
builder.Services.AddScoped<IPropertyViewService, PropertyViewService>();
builder.Services.AddScoped<INearbyPlaceService, NearbyPlaceService>();
builder.Services.AddScoped<IRoomTypeService, RoomTypeService>();
builder.Services.AddScoped<IRoomService, RoomService>();
builder.Services.AddScoped<IAvailabilityService, AvailabilityService>();
builder.Services.AddScoped<IRoomDailyPriceService, RoomDailyPriceService>();
builder.Services.AddScoped<IPropertyUserService, PropertyUserService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
builder.Services.AddScoped<IPromotionService, PromotionService>();
builder.Services.AddScoped<IGuestService, GuestService>();
builder.Services.AddScoped<INotificationService, NotificationService>();
builder.Services.AddScoped<ISmsSender, NoOpSmsSender>();
builder.Services.AddScoped<IEmailSender, NoOpEmailSender>();
builder.Services.AddScoped<IReservationNumberGenerator, ReservationNumberGenerator>();
builder.Services.AddScoped<IReservationStatusWorkflow, ReservationStatusWorkflow>();
builder.Services.AddScoped<IEffectiveAvailabilityService, EffectiveAvailabilityService>();
builder.Services.AddScoped<IReservationAvailabilityService, ReservationAvailabilityService>();
builder.Services.AddScoped<IReservationPricingService, ReservationPricingService>();
builder.Services.AddScoped<IReservationService, ReservationService>();
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddScoped<IChildPricingRuleResolver, ChildPricingRuleResolver>();
builder.Services.AddScoped<IReservationRulesResolver, ReservationRulesResolver>();
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddScoped<IAuthorizationDataAuditService, AuthorizationDataAuditService>();
}
builder.Services.AddSingleton<PricingService>();
builder.Services.AddScoped<CouponValidationService>();
builder.Services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();
builder.Services.AddScoped<IAuthorizationHandler, OwnerPanelAccessAuthorizationHandler>();
builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidAudience = jwtOptions.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Key)),
            ClockSkew = TimeSpan.FromSeconds(30)
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var userIdClaim = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                var sessionVersionClaim = context.Principal?.FindFirstValue(KoochJwtClaimTypes.SessionVersion);
                if (!int.TryParse(userIdClaim, out var userId) ||
                    !int.TryParse(sessionVersionClaim, out var sessionVersion))
                {
                    context.Fail(UserSessionVersionValidator.RevokedFailureMessage);
                    return;
                }

                var dbContext = context.HttpContext.RequestServices.GetRequiredService<KoochDbContext>();
                var isValid = await UserSessionVersionValidator.IsValidAsync(
                    dbContext,
                    userId,
                    sessionVersion,
                    context.HttpContext.RequestAborted);
                if (!isValid)
                {
                    context.Fail(UserSessionVersionValidator.RevokedFailureMessage);
                }
            },
            OnChallenge = async context =>
            {
                if (context.AuthenticateFailure?.Message != UserSessionVersionValidator.RevokedFailureMessage ||
                    context.Response.HasStarted)
                {
                    return;
                }

                context.HandleResponse();
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/json";
                context.Response.Headers["X-Kooch-Auth-Error"] = UserSessionVersionValidator.RevokedFailureMessage;
                await context.Response.WriteAsync(
                    "{\"message\":\"Your session is no longer valid. Please sign in again.\",\"code\":\"session_revoked\"}");
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AuthorizationPolicies.SuperAdmin, policy =>
        policy.RequireRole(UserRole.SuperAdmin.ToString()));
    options.AddPolicy(AuthorizationPolicies.AdminUsers, policy =>
        policy.RequireRole(UserRole.SuperAdmin.ToString(), UserRole.AdminAssistant.ToString()));
    options.AddPolicy(AuthorizationPolicies.OwnerUsers, policy =>
        policy.Requirements.Add(new OwnerPanelAccessRequirement()));
    options.AddPolicy(AuthorizationPolicies.ClientUsers, policy =>
        policy.RequireRole(UserRole.Client.ToString()));
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy<string>(
        PropertyUserResolveRateLimitPolicy.Name,
        PropertyUserResolveRateLimitPolicy.CreatePartition);
});

builder.Services.AddControllers(options => options.Filters.Add<ApiExceptionFilter>())
    .AddJsonOptions(options =>
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "Kooch API", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter the JWT bearer token."
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

var app = builder.Build();

if (args.Contains("--audit-authorization-data", StringComparer.OrdinalIgnoreCase))
{
    if (!app.Environment.IsDevelopment())
    {
        throw new InvalidOperationException("Authorization data audit is available only in Development.");
    }

    await using var auditScope = app.Services.CreateAsyncScope();
    var auditService = auditScope.ServiceProvider.GetRequiredService<IAuthorizationDataAuditService>();
    var report = await auditService.CreateReportAsync();
    Console.WriteLine(report.ToReadableText());
    return;
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapControllers();

await using (var scope = app.Services.CreateAsyncScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<KoochDbContext>();
    await dbContext.Database.MigrateAsync();
    await SeedData.InitializeAsync(dbContext);
}

app.Run();
