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

        foreach (var search in new[]
                 {
                     "  Alpha House  ",
                     "  Historic Alpha  ",
                     "Kashan",
                     "Sara Ahmadi",
                     "  sara@example.test  "
                 })
        {
            var result = await SearchInMemoryAsync(dbContext, search);

            var item = Assert.Single(result);
            Assert.Equal(101, item.Id);
            Assert.Equal("Alpha House", item.Name);
            Assert.Equal("Historic Alpha", item.EnglishName);
            Assert.Equal("Kashan", item.City);
            Assert.Equal("Sara Ahmadi", $"{item.Owner.FirstName} {item.Owner.LastName}");
            Assert.Equal("sara@example.test", item.Owner.Email);
        }
    }

    [Theory]
    [InlineData("خانه یکپارچه", "خانه يكپارچه")]
    [InlineData("خانه يكپارچه", "خانه یکپارچه")]
    public async Task Search_MatchesPersianAndArabicYehKafInPropertyName(
        string storedName,
        string search)
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        dbContext.Properties.Add(CreateProperty(110, 2, storedName, "تهران"));
        await dbContext.SaveChangesAsync();

        var result = await SearchInMemoryAsync(dbContext, $"  {search}  ");

        var item = Assert.Single(result);
        Assert.Equal(110, item.Id);
    }

    [Fact]
    public async Task Search_MatchesNormalizedCityAndCombinedOwnerName()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        dbContext.Users.Add(CreateUser(11, UserRole.Client, "علي", "كريمي", "owner11@example.test"));
        dbContext.Properties.Add(CreateProperty(111, 11, "خانه کویر", "كرمان"));
        await dbContext.SaveChangesAsync();
        var cityResult = await SearchInMemoryAsync(dbContext, "کرمان");
        var ownerResult = await SearchInMemoryAsync(dbContext, "علی کریمی");

        Assert.Equal(111, Assert.Single(cityResult).Id);
        Assert.Equal(111, Assert.Single(ownerResult).Id);
    }

    [Fact]
    public async Task Search_NormalizesPersianArabicAndLatinDigitsBeforePagination()
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        dbContext.Properties.AddRange(
            CreateProperty(120, 2, "اقامتگاه ۱۲۳", "تهران"),
            CreateProperty(121, 2, "اقامتگاه ١٢٣", "تهران"),
            CreateProperty(122, 2, "اقامتگاه 123", "تهران"));
        await dbContext.SaveChangesAsync();
        var properties = await dbContext.Properties
            .Include(property => property.Owner)
            .AsNoTracking()
            .ToListAsync();

        foreach (var search in new[] { "123", "۱۲۳", "١٢٣" })
        {
            var result = PropertyService.ApplyAdminPropertySearch(
                    properties.AsQueryable(),
                    search)
                .ToList();

            Assert.Equal(3, result.Count);
        }

        var normalizedQuery = PropertyService.ApplyAdminPropertySearch(
            properties.AsQueryable(),
            "۱۲۳");
        var totalCount = normalizedQuery.Count();
        var pagedItems = normalizedQuery
            .OrderBy(property => property.Name)
            .ThenBy(property => property.Id)
            .Skip(2)
            .Take(2)
            .ToList();

        Assert.Equal(3, totalCount);
        Assert.Equal(2, (int)Math.Ceiling(totalCount / 2d));
        Assert.Single(pagedItems);
    }

    [Fact]
    public void SearchNormalization_TranslatesToSqlServerReplaceOperations()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer(
                "Server=(localdb)\\mssqllocaldb;Database=KoochAdminPropertySearchTranslation;Trusted_Connection=True;TrustServerCertificate=True")
            .Options;
        using var dbContext = new KoochDbContext(options);

        var query = PropertyService.ApplyAdminPropertySearch(
                dbContext.Properties.AsNoTracking(),
                "كاشان ۱۲٣")
            .OrderBy(property => property.Name)
            .ThenBy(property => property.Id)
            .Skip(10)
            .Take(10);
        var sql = query.ToQueryString();

        Assert.Contains("REPLACE(", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("LIKE", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("OFFSET", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("FETCH NEXT", sql, StringComparison.OrdinalIgnoreCase);
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

        var properties = await SearchInMemoryAsync(dbContext, "Paged");
        var totalCount = properties.Count;
        var items = properties
            .OrderBy(property => property.Name)
            .ThenBy(property => property.Id)
            .Skip(2)
            .Take(2)
            .ToList();

        Assert.Equal(5, totalCount);
        Assert.Equal(3, (int)Math.Ceiling(totalCount / 2d));
        Assert.Equal(["Paged C", "Paged D"], items.Select(item => item.Name));
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
            new AdminPropertySearchQuery());

        Assert.DoesNotContain(result.Items, property => property.Id == 103);
        Assert.Equal(2, result.TotalCount);
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

    private static async Task<IReadOnlyList<Property>> SearchInMemoryAsync(
        KoochDbContext dbContext,
        string search)
    {
        var properties = await dbContext.Properties
            .Include(property => property.Owner)
            .AsNoTracking()
            .ToListAsync();
        return PropertyService.ApplyAdminPropertySearch(
                properties.AsQueryable(),
                search)
            .ToList();
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
