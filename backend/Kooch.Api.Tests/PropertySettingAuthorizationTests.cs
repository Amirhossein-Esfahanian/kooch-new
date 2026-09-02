using System.Reflection;
using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertySettingAuthorizationTests
{
    [Fact]
    public async Task PublicCatalog_DefaultReadReturnsOnlyActiveRows()
    {
        await using var context = CreateContext();
        context.PropertySettings.AddRange(
            new() { Name = "فعال", Slug = "active", SortOrder = 10, IsActive = true },
            new() { Name = "غیرفعال", Slug = "inactive", SortOrder = 20, IsActive = false });
        await context.SaveChangesAsync();
        var authorization = new StubAuthorizationService(succeeds: false);
        var controller = CreateController(context, authorization, authenticated: false);

        var result = await controller.Get(includeInactive: false, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var settings = Assert.IsAssignableFrom<IReadOnlyList<Kooch.Api.Dtos.PropertySettings.PropertySettingResponse>>(ok.Value);
        Assert.Collection(settings, setting => Assert.Equal("active", setting.Slug));
        Assert.Null(authorization.RequestedPolicy);
    }

    [Fact]
    public async Task IncludeInactive_UnauthenticatedUserIsChallenged()
    {
        await using var context = CreateContext();
        var authorization = new StubAuthorizationService(succeeds: false);
        var controller = CreateController(context, authorization, authenticated: false);

        var result = await controller.Get(includeInactive: true, CancellationToken.None);

        Assert.IsType<ChallengeResult>(result.Result);
        Assert.Equal(AuthorizationPolicies.AdminUsers, authorization.RequestedPolicy);
    }

    [Fact]
    public async Task IncludeInactive_AuthenticatedNonAdminIsForbidden()
    {
        await using var context = CreateContext();
        var authorization = new StubAuthorizationService(succeeds: false);
        var controller = CreateController(context, authorization, authenticated: true);

        var result = await controller.Get(includeInactive: true, CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
        Assert.Equal(AuthorizationPolicies.AdminUsers, authorization.RequestedPolicy);
    }

    [Fact]
    public async Task IncludeInactive_AdminAuthorizationReturnsInactiveRows()
    {
        await using var context = CreateContext();
        context.PropertySettings.Add(new()
        {
            Name = "غیرفعال",
            Slug = "inactive",
            SortOrder = 10,
            IsActive = false
        });
        await context.SaveChangesAsync();
        var authorization = new StubAuthorizationService(succeeds: true);
        var controller = CreateController(context, authorization, authenticated: true);

        var result = await controller.Get(includeInactive: true, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var settings = Assert.IsAssignableFrom<IReadOnlyList<Kooch.Api.Dtos.PropertySettings.PropertySettingResponse>>(ok.Value);
        Assert.Collection(settings, setting => Assert.False(setting.IsActive));
    }

    [Fact]
    public void CatalogWritesRequireAdminPolicy()
    {
        var writeMethods = new[]
        {
            nameof(PropertySettingsController.Create),
            nameof(PropertySettingsController.Update),
            nameof(PropertySettingsController.Delete)
        };

        foreach (var methodName in writeMethods)
        {
            var method = typeof(PropertySettingsController).GetMethod(methodName);
            var attribute = Assert.Single(method!.GetCustomAttributes<AdminAuthorizeAttribute>());
            Assert.Equal(AuthorizationPolicies.AdminUsers, attribute.Policy);
        }
    }

    [Fact]
    public void PropertyAssignmentEndpointsUseExistingOwnerPolicy()
    {
        var attribute = Assert.Single(
            typeof(OwnerPropertySettingsController).GetCustomAttributes<OwnerAuthorizeAttribute>());

        Assert.Equal(AuthorizationPolicies.OwnerUsers, attribute.Policy);
    }

    private static PropertySettingsController CreateController(
        KoochDbContext context,
        StubAuthorizationService authorization,
        bool authenticated)
    {
        var controller = new PropertySettingsController(
            new PropertySettingService(context, new StubPropertyAccessService()),
            authorization);
        var identity = authenticated
            ? new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "1")], "test")
            : new ClaimsIdentity();
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(identity)
            }
        };
        return controller;
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"property-setting-auth-{Guid.NewGuid():N}")
            .Options;
        return new KoochDbContext(options);
    }

    private sealed class StubAuthorizationService(bool succeeds) : IAuthorizationService
    {
        public string? RequestedPolicy { get; private set; }

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) =>
            Task.FromResult(succeeds ? AuthorizationResult.Success() : AuthorizationResult.Failed());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName)
        {
            RequestedPolicy = policyName;
            return Task.FromResult(succeeds ? AuthorizationResult.Success() : AuthorizationResult.Failed());
        }
    }
}
