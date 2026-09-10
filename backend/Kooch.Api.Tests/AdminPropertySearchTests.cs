using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public class AdminPropertySearchTests
{
    [Fact]
    public async Task SuperAdmin_SearchesEveryAutocompleteField()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreateService(dbContext);

        foreach (var search in new[]
                 {
                     "Alpha House",
                     "Historic Alpha",
                     "Kashan",
                     "Sara Ahmadi",
                     "sara@example.test"
                 })
        {
            var result = await service.SearchForAdminAsync(
                1,
                UserRole.SuperAdmin,
                new AdminPropertySearchQuery { Search = search });

            var item = Assert.Single(result.Items);
            Assert.Equal(101, item.Id);
            Assert.Equal("Alpha House", item.Name);
            Assert.Equal("Historic Alpha", item.EnglishName);
            Assert.Equal("Kashan", item.City);
            Assert.Equal("Sara Ahmadi", item.OwnerName);
            Assert.Equal("sara@example.test", item.OwnerEmail);
        }
    }

    [Fact]
    public async Task Search_PaginatesAfterFiltering_WithDeterministicTotals()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        for (var index = 0; index < 5; index++)
        {
            dbContext.Properties.Add(CreateProperty(
                200 + index,
                2,
                $"Paged {(char)('A' + index)}",
                "Kashan"));
        }
        await dbContext.SaveChangesAsync();

        var result = await CreateService(dbContext).SearchForAdminAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertySearchQuery
            {
                Search = "Paged",
                Page = 2,
                PageSize = 2
            });

        Assert.Equal(5, result.TotalCount);
        Assert.Equal(2, result.Page);
        Assert.Equal(2, result.PageSize);
        Assert.Equal(3, result.TotalPages);
        Assert.Equal(["Paged C", "Paged D"], result.Items.Select(item => item.Name));
    }

    [Fact]
    public async Task AdminAssistant_WithManageProperties_OnlySeesAccessibleProperties()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext, grantAssistantPermission: true);

        var result = await CreateService(dbContext).SearchForAdminAsync(
            10,
            UserRole.AdminAssistant,
            new AdminPropertySearchQuery());

        var item = Assert.Single(result.Items);
        Assert.Equal(101, item.Id);
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task AdminAssistant_WithoutManageProperties_IsDenied()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext, grantAssistantPermission: false);

        var exception = await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            CreateService(dbContext).SearchForAdminAsync(
                10,
                UserRole.AdminAssistant,
                new AdminPropertySearchQuery()));

        Assert.Equal("ManageProperties permission is required.", exception.Message);
    }

    [Fact]
    public async Task Search_ExcludesSoftDeletedProperties()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);

        var result = await CreateService(dbContext).SearchForAdminAsync(
            1,
            UserRole.SuperAdmin,
            new AdminPropertySearchQuery { Search = "Deleted" });

        Assert.Empty(result.Items);
        Assert.Equal(0, result.TotalCount);
        Assert.Equal(0, result.TotalPages);
    }

    [Fact]
    public async Task ExistingAdminPropertyGet_RemainsAnUnpagedPropertyResponseArray()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreateService(dbContext);
        var controller = new AdminPropertiesController(service, null!, null!);
        SetCurrentUser(controller, 1, UserRole.SuperAdmin);

        var response = await controller.Get(CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var properties = Assert.IsAssignableFrom<IReadOnlyList<PropertyResponse>>(ok.Value);

        Assert.Equal(2, properties.Count);
        Assert.Equal(["Alpha House", "Beta Lodge"], properties.Select(property => property.Name));
        Assert.Equal("sara@example.test", properties[0].OwnerEmail);
        Assert.Equal(PropertyStatus.Approved, properties[0].Status);
    }

    [Fact]
    public async Task SearchController_ReturnsTheSharedPagedResultContract()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var controller = new AdminPropertiesController(CreateService(dbContext), null!, null!);
        SetCurrentUser(controller, 1, UserRole.SuperAdmin);

        var response = await controller.Search(
            new AdminPropertySearchQuery { Page = 1, PageSize = 1 },
            CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var result = Assert.IsType<PagedResult<AdminPropertySearchItemResponse>>(ok.Value);

        Assert.Single(result.Items);
        Assert.Equal(2, result.TotalCount);
        Assert.Equal(2, result.TotalPages);
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(1, 0)]
    [InlineData(1, 26)]
    public void SearchQuery_RejectsOutOfRangePagination(int page, int pageSize)
    {
        var query = new AdminPropertySearchQuery { Page = page, PageSize = pageSize };
        var validationResults = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(
            query,
            new ValidationContext(query),
            validationResults,
            validateAllProperties: true);

        Assert.False(valid);
        Assert.NotEmpty(validationResults);
    }

    private static PropertyService CreateService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new PropertyService(
            dbContext,
            authorization,
            authorization,
            new PermissionService(dbContext, authorization),
            null!,
            null!);
    }

    private static async Task SeedBaseAsync(
        KoochDbContext dbContext,
        bool grantAssistantPermission = true)
    {
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "Platform", "Admin", "admin@example.test"),
            CreateUser(2, UserRole.Client, "Sara", "Ahmadi", "sara@example.test"),
            CreateUser(3, UserRole.Client, "Reza", "Karimi", "reza@example.test"),
            CreateUser(10, UserRole.AdminAssistant, "Assistant", "User", "assistant@example.test"));
        dbContext.Destinations.Add(new Destination
        {
            Id = 1,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.AddRange(
            CreateProperty(101, 2, "Alpha House", "Kashan", "Historic Alpha"),
            CreateProperty(102, 3, "Beta Lodge", "Yazd", "Desert Beta"),
            CreateProperty(103, 3, "Deleted Inn", "Tehran", isDeleted: true));
        dbContext.UserPropertyAccesses.Add(new UserPropertyAccess
        {
            Id = 201,
            UserId = 10,
            PropertyId = 101,
            PropertyRole = PropertyUserRole.Manager,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = PropertyMatrix(
                ("Properties", new PermissionActionsDto { View = true, Edit = true }))
        });

        if (grantAssistantPermission)
        {
            dbContext.Permissions.Add(new Permission
            {
                Id = 301,
                Key = PermissionKey.ManageProperties,
                Name = nameof(PermissionKey.ManageProperties)
            });
            dbContext.UserPermissions.Add(new UserPermission
            {
                Id = 302,
                UserId = 10,
                PermissionKey = PermissionKey.ManageProperties,
                IsAllowed = true
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private static User CreateUser(
        int id,
        UserRole role,
        string firstName,
        string lastName,
        string email) => new()
    {
        Id = id,
        FirstName = firstName,
        LastName = lastName,
        Email = email,
        PhoneNumber = $"0912000{id:D4}",
        PasswordHash = "not-used",
        Role = role,
        IsActive = true
    };

    private static Property CreateProperty(
        int id,
        int ownerId,
        string name,
        string city,
        string? englishName = null,
        bool isDeleted = false) => new()
    {
        Id = id,
        OwnerId = ownerId,
        DestinationId = 1,
        Name = name,
        EnglishName = englishName,
        Slug = name.Replace(' ', '-').ToLowerInvariant(),
        Description = name,
        Address = "Test address",
        City = city,
        Country = "Iran",
        Status = PropertyStatus.Approved,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.NamedRooms,
        IsDeleted = isDeleted,
        DeletedAtUtc = isDeleted ? DateTime.UtcNow : null
    };

    private static string PropertyMatrix(
        params (string Group, PermissionActionsDto Actions)[] permissions)
    {
        var matrix = new PermissionMatrixDto();
        foreach (var (group, actions) in permissions)
        {
            matrix[group] = actions;
        }

        return JsonSerializer.Serialize(matrix);
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private static void SetCurrentUser(ControllerBase controller, int userId, UserRole role)
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim(ClaimTypes.Role, role.ToString())
                    ],
                    "AdminPropertySearchTests"))
            }
        };
    }
}
