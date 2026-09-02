using System.Security.Claims;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Entities;
using Kooch.Api.Filters;
using Kooch.Api.Services;
using Kooch.Api.Services.Amenities;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AmenitySvgPipelineTests
{
    private const string SafeSvg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0h1v1H0z\"/></svg>";

    [Theory]
    [InlineData(typeof(AmenityCategoriesController))]
    [InlineData(typeof(AmenitiesController))]
    public void LegacyImmediateUploadRoute_IsAbsentAndStageRouteRemainsAdminOnly(
        Type controllerType)
    {
        var postActions = controllerType.GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .Select(method => new
            {
                Method = method,
                Route = method.GetCustomAttribute<HttpPostAttribute>()?.Template
            })
            .Where(action => action.Route is not null)
            .ToArray();

        Assert.DoesNotContain(postActions, action => action.Route == "svg");
        var stageAction = Assert.Single(postActions, action => action.Route == "svg/stage");
        Assert.NotNull(stageAction.Method.GetCustomAttribute<AdminAuthorizeAttribute>());
    }

    [Fact]
    public async Task SafeUploadEndpoints_SanitizeAndStageInClosedNamespaces()
    {
        await using var database = await TestDatabase.CreateAsync();
        var categoryController = database.CreateCategoryController();
        var amenityController = database.CreateAmenityController();
        const string formattedSvg = """
            <?xml version="1.0"?>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
              <path d="M0 0h1v1H0z" />
            </svg>
            """;

        var category = GetStageResponse(await categoryController.StageSvg(
            CreateFormFile(formattedSvg), CancellationToken.None));
        var amenity = GetStageResponse(await amenityController.StageSvg(
            CreateFormFile(formattedSvg), CancellationToken.None));

        Assert.Equal(MediaAssetNamespace.AmenityCategories, category.AssetNamespace);
        Assert.Equal(MediaAssetNamespace.Amenities, amenity.AssetNamespace);
        Assert.True(Guid.TryParseExact(category.UploadToken, "N", out _));
        Assert.True(Guid.TryParseExact(amenity.UploadToken, "N", out _));
        Assert.NotEqual(category.UploadToken, amenity.UploadToken);
        Assert.DoesNotContain("<?xml", await File.ReadAllTextAsync(database.GetStagedPath(category)));
        Assert.DoesNotContain("<?xml", await File.ReadAllTextAsync(database.GetStagedPath(amenity)));
    }

    [Fact]
    public async Task SafeUploadEndpoint_RejectsUnsafeSvgThroughSharedSanitizer()
    {
        await using var database = await TestDatabase.CreateAsync();
        var controller = database.CreateAmenityController();
        var unsafeSvg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><script>alert(1)</script></svg>";

        var exception = await Assert.ThrowsAsync<SvgSanitizationException>(() =>
            controller.StageSvg(CreateFormFile(unsafeSvg), CancellationToken.None));

        Assert.Equal(SvgSanitizationFailure.UnsafeContent, exception.Failure);
        var stagingDirectory = Path.Combine(database.Storage.RootPath, ".staging", "amenities");
        Assert.True(
            !Directory.Exists(stagingDirectory) ||
            Directory.GetFiles(stagingDirectory, "*.svg").Length == 0);
    }

    [Fact]
    public async Task SafeUploadEndpoint_RejectsEmptyAndOversizedFilesBeforeStaging()
    {
        await using var database = await TestDatabase.CreateAsync();
        var controller = database.CreateAmenityController();
        var emptyFile = CreateFormFile(string.Empty);
        var oversizedContent = new string(' ', SvgSanitizer.MaximumInputBytes + 1);

        var empty = await Assert.ThrowsAsync<SvgSanitizationException>(() =>
            controller.StageSvg(emptyFile, CancellationToken.None));
        var oversized = await Assert.ThrowsAsync<SvgSanitizationException>(() =>
            controller.StageSvg(CreateFormFile(oversizedContent), CancellationToken.None));

        Assert.Equal(SvgSanitizationFailure.EmptyInput, empty.Failure);
        Assert.Equal(SvgSanitizationFailure.TooLarge, oversized.Failure);
    }

    [Theory]
    [InlineData(SvgSanitizationFailure.EmptyInput, "فایل SVG خالی است.")]
    [InlineData(SvgSanitizationFailure.TooLarge, "حجم فایل SVG بیش از حد مجاز است.")]
    [InlineData(SvgSanitizationFailure.InvalidXml, "فایل SVG معتبر نیست.")]
    [InlineData(SvgSanitizationFailure.UnsupportedStructure, "ساختار این فایل SVG پشتیبانی نمی‌شود.")]
    [InlineData(SvgSanitizationFailure.UnsafeContent, "فایل SVG شامل محتوای غیرمجاز است.")]
    public void SanitizerFailures_HaveStableSafePersianMessages(
        SvgSanitizationFailure failure,
        string expectedMessage)
    {
        Assert.Equal(expectedMessage, SvgSanitizationMessages.For(failure));
    }

    [Fact]
    public void ApiExceptionFilter_MapsSanitizerAndTokenFailuresToSafePersian400Responses()
    {
        var sanitizerContext = CreateExceptionContext(new SvgSanitizationException(
            SvgSanitizationFailure.InvalidXml,
            "raw parser details that must not escape"));
        var tokenContext = CreateExceptionContext(new MediaStagingException(
            MediaStagingFailure.TokenExpired,
            "internal token details"));
        var filter = new ApiExceptionFilter();

        filter.OnException(sanitizerContext);
        filter.OnException(tokenContext);

        var sanitizerResult = Assert.IsType<BadRequestObjectResult>(sanitizerContext.Result);
        var tokenResult = Assert.IsType<BadRequestObjectResult>(tokenContext.Result);
        var sanitizerMessage = ReadMessage(sanitizerResult.Value);
        var tokenMessage = ReadMessage(tokenResult.Value);
        Assert.Equal("فایل SVG معتبر نیست.", sanitizerMessage);
        Assert.DoesNotContain("parser", sanitizerMessage, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("توکن بارگذاری SVG معتبر نیست یا منقضی شده است.", tokenMessage);
        Assert.DoesNotContain("internal", tokenMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateWithoutToken_CreatesCategoryAndAmenityWithoutIcons()
    {
        await using var database = await TestDatabase.CreateAsync();
        var categoryResult = await database.CreateCategoryController().Create(
            new AmenityCategoryRequest
            {
                Name = "Legacy category",
                Slug = "legacy-category"
            },
            CancellationToken.None);
        var category = GetCreatedCategory(categoryResult);

        var amenityResult = await database.CreateAmenityController().Create(
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = "Legacy amenity",
                Slug = "legacy-amenity",
                Scope = AmenityScope.Property
            },
            CancellationToken.None);
        var amenity = GetCreatedAmenity(amenityResult);

        Assert.Null(category.Icon);
        Assert.Null(amenity.Icon);
    }

    [Fact]
    public async Task CreateWithTokens_FinalizesCategoryAndAmenityUnderTheirEntityIds()
    {
        await using var database = await TestDatabase.CreateAsync();
        var categoryStage = await database.Storage.StageSanitizedSvgAsync(
            MediaAssetNamespace.AmenityCategories, SafeSvg);
        var category = GetCreatedCategory(await database.CreateCategoryController().Create(
            new AmenityCategoryRequest
            {
                Name = "Safe category",
                Slug = "safe-category",
                IconUploadToken = categoryStage.UploadToken
            },
            CancellationToken.None));

        var amenityStage = await database.Storage.StageSanitizedSvgAsync(
            MediaAssetNamespace.Amenities, SafeSvg);
        var amenity = GetCreatedAmenity(await database.CreateAmenityController().Create(
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = "Safe amenity",
                Slug = "safe-amenity",
                IconUploadToken = amenityStage.UploadToken,
                Scope = AmenityScope.Property
            },
            CancellationToken.None));

        Assert.Matches($"^/uploads/amenity-categories/{category.Id}/[0-9a-f]{{32}}\\.svg$", category.Icon!);
        Assert.Matches($"^/uploads/amenities/{amenity.Id}/[0-9a-f]{{32}}\\.svg$", amenity.Icon!);
        Assert.True(File.Exists(database.GetFinalPath(category.Icon!)));
        Assert.True(File.Exists(database.GetFinalPath(amenity.Icon!)));
        Assert.False(File.Exists(database.GetStagedPath(categoryStage)));
        Assert.False(File.Exists(database.GetStagedPath(amenityStage)));
    }

    [Fact]
    public async Task CreateFinalizationFailure_RollsBackEntityAndLeavesNoFinalAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var amenityToken = await database.Storage.StageSanitizedSvgAsync(
            MediaAssetNamespace.Amenities, SafeSvg);

        var exception = await Assert.ThrowsAsync<MediaStagingException>(() =>
            database.CreateCategoryController().Create(
                new AmenityCategoryRequest
                {
                    Name = "Wrong token category",
                    Slug = "wrong-token-category",
                    IconUploadToken = amenityToken.UploadToken
                },
                CancellationToken.None));

        Assert.Equal(MediaStagingFailure.NamespaceMismatch, exception.Failure);
        Assert.Equal(0, await database.Context.AmenityCategories.CountAsync());
        Assert.Empty(Directory.GetFiles(
            Path.Combine(database.Storage.RootPath, "amenity-categories"),
            "*.svg",
            SearchOption.AllDirectories));
        Assert.True(File.Exists(database.GetStagedPath(amenityToken)));
    }

    [Fact]
    public async Task UpdateScope_ToPropertyRejectsExistingRoomTypeAssignmentWithoutMutation()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id, AmenityScope.Both);
        var (_, roomType) = await database.SeedAssignmentTargetsAsync();
        database.Context.RoomTypeAmenities.Add(new RoomTypeAmenity
        {
            RoomTypeId = roomType.Id,
            AmenityId = amenity.Id
        });
        await database.Context.SaveChangesAsync();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateAmenityController().Update(
                amenity.Id,
                CreateAmenityUpdate(amenity, AmenityScope.Property),
                CancellationToken.None));

        Assert.Equal(
            "این امکان هنوز به نوع اتاق متصل است و نمی‌توان دامنه آن را فقط به اقامتگاه تغییر داد.",
            exception.Message);
        AssertApiBadRequest(exception);
        Assert.Equal(
            AmenityScope.Both,
            (await database.Context.Amenities.FindAsync(amenity.Id))!.Scope);
        Assert.True(await database.Context.RoomTypeAmenities.AnyAsync(
            join => join.RoomTypeId == roomType.Id && join.AmenityId == amenity.Id));
    }

    [Fact]
    public async Task UpdateScope_ToRoomTypeRejectsExistingPropertyAssignmentWithoutMutation()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id, AmenityScope.Both);
        var (property, _) = await database.SeedAssignmentTargetsAsync();
        database.Context.PropertyAmenities.Add(new PropertyAmenity
        {
            PropertyId = property.Id,
            AmenityId = amenity.Id
        });
        await database.Context.SaveChangesAsync();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateAmenityController().Update(
                amenity.Id,
                CreateAmenityUpdate(amenity, AmenityScope.RoomType),
                CancellationToken.None));

        Assert.Equal(
            "این امکان هنوز به اقامتگاه متصل است و نمی‌توان دامنه آن را فقط به نوع اتاق تغییر داد.",
            exception.Message);
        AssertApiBadRequest(exception);
        Assert.Equal(
            AmenityScope.Both,
            (await database.Context.Amenities.FindAsync(amenity.Id))!.Scope);
        Assert.True(await database.Context.PropertyAmenities.AnyAsync(
            join => join.PropertyId == property.Id && join.AmenityId == amenity.Id));
    }

    [Theory]
    [InlineData(AmenityScope.Property)]
    [InlineData(AmenityScope.RoomType)]
    public async Task UpdateScope_BothWithoutConflictingAssignmentsCanNarrow(AmenityScope targetScope)
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id, AmenityScope.Both);

        var updated = GetUpdatedAmenity(await database.CreateAmenityController().Update(
            amenity.Id,
            CreateAmenityUpdate(amenity, targetScope),
            CancellationToken.None));

        Assert.Equal(targetScope, updated.Scope);
        Assert.Equal(targetScope, (await database.Context.Amenities.FindAsync(amenity.Id))!.Scope);
    }

    [Theory]
    [InlineData(AmenityScope.Property)]
    [InlineData(AmenityScope.RoomType)]
    public async Task UpdateScope_AssignedSingleScopeCanBroadenToBoth(AmenityScope currentScope)
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id, currentScope);
        var (property, roomType) = await database.SeedAssignmentTargetsAsync();
        if (currentScope == AmenityScope.Property)
        {
            database.Context.PropertyAmenities.Add(new PropertyAmenity
            {
                PropertyId = property.Id,
                AmenityId = amenity.Id
            });
        }
        else
        {
            database.Context.RoomTypeAmenities.Add(new RoomTypeAmenity
            {
                RoomTypeId = roomType.Id,
                AmenityId = amenity.Id
            });
        }
        await database.Context.SaveChangesAsync();

        var updated = GetUpdatedAmenity(await database.CreateAmenityController().Update(
            amenity.Id,
            CreateAmenityUpdate(amenity, AmenityScope.Both),
            CancellationToken.None));

        Assert.Equal(AmenityScope.Both, updated.Scope);
    }

    [Fact]
    public async Task UpdateScope_UndefinedValueIsRejectedAsBadRequestWithoutMutation()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id, AmenityScope.Both);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateAmenityController().Update(
                amenity.Id,
                CreateAmenityUpdate(amenity, (AmenityScope)999),
                CancellationToken.None));

        Assert.Equal("دامنه استفاده امکان معتبر نیست.", exception.Message);
        AssertApiBadRequest(exception);
        Assert.Equal(
            AmenityScope.Both,
            (await database.Context.Amenities.FindAsync(amenity.Id))!.Scope);
    }

    [Fact]
    public async Task CreateScope_UndefinedValueIsRejectedAsBadRequest()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateAmenityController().Create(
                new AmenityRequest
                {
                    AmenityCategoryId = category.Id,
                    Name = "Invalid scope",
                    Slug = "invalid-scope",
                    Scope = (AmenityScope)999
                },
                CancellationToken.None));

        AssertApiBadRequest(exception);
        Assert.Empty(await database.Context.Amenities.ToListAsync());
    }

    [Fact]
    public async Task CreateDatabaseFailureAfterFinalization_RollsBackAndDeletesNewFinalAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var staged = await database.Storage.StageSanitizedSvgAsync(
            MediaAssetNamespace.AmenityCategories, SafeSvg);
        database.Context.FailAfterSuccessfulSaves(1);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            database.CreateCategoryController().Create(
                new AmenityCategoryRequest
                {
                    Name = "Failing category",
                    Slug = "failing-category",
                    IconUploadToken = staged.UploadToken
                },
                CancellationToken.None));

        Assert.Equal(0, await database.Context.AmenityCategories.CountAsync());
        Assert.False(File.Exists(database.GetStagedPath(staged)));
        Assert.Empty(Directory.GetFiles(
            Path.Combine(database.Storage.RootPath, "amenity-categories"),
            "*.svg",
            SearchOption.AllDirectories));
    }

    [Fact]
    public async Task UpdateReplacement_CommitsNewUrlThenDeletesOldOwnedAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id);
        var oldAsset = await database.StoreFinalAsync(MediaAssetNamespace.Amenities, amenity.Id);
        amenity.Icon = oldAsset.PublicPath;
        await database.Context.SaveChangesAsync();
        var staged = await database.Storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SafeSvg);

        var result = await database.CreateAmenityController().Update(
            amenity.Id,
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = amenity.Name,
                Slug = amenity.Slug,
                IconUploadToken = staged.UploadToken,
                Scope = amenity.Scope
            },
            CancellationToken.None);
        var updated = GetUpdatedAmenity(result);

        Assert.NotEqual(oldAsset.PublicPath, updated.Icon);
        Assert.True(File.Exists(database.GetFinalPath(updated.Icon!)));
        Assert.False(File.Exists(database.GetFinalPath(oldAsset.PublicPath)));
    }

    [Fact]
    public async Task FailedUpdate_PreservesDatabaseAndOldAssetAndCompensatesNewAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id);
        var oldAsset = await database.StoreFinalAsync(MediaAssetNamespace.Amenities, amenity.Id);
        amenity.Icon = oldAsset.PublicPath;
        await database.Context.SaveChangesAsync();
        var staged = await database.Storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SafeSvg);
        database.Context.FailAfterSuccessfulSaves(0);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            database.CreateAmenityController().Update(
                amenity.Id,
                new AmenityRequest
                {
                    AmenityCategoryId = category.Id,
                    Name = "Changed name",
                    Slug = amenity.Slug,
                    IconUploadToken = staged.UploadToken,
                    Scope = amenity.Scope
                },
                CancellationToken.None));

        await using var verificationContext = database.CreateVerificationContext();
        var persisted = await verificationContext.Amenities.AsNoTracking().SingleAsync(item => item.Id == amenity.Id);
        Assert.Equal(oldAsset.PublicPath, persisted.Icon);
        Assert.Equal("Amenity", persisted.Name);
        Assert.True(File.Exists(database.GetFinalPath(oldAsset.PublicPath)));
        Assert.False(File.Exists(database.GetStagedPath(staged)));
        Assert.Single(Directory.GetFiles(
            Path.Combine(database.Storage.RootPath, "amenities", amenity.Id.ToString()),
            "*.svg"));
    }

    [Fact]
    public async Task OldAssetCleanupFailure_DoesNotRollBackCommittedReplacement()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id);
        var oldAsset = await database.StoreFinalAsync(MediaAssetNamespace.Amenities, amenity.Id);
        amenity.Icon = oldAsset.PublicPath;
        await database.Context.SaveChangesAsync();
        var staged = await database.Storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SafeSvg);
        var controller = database.CreateAmenityController(new DeleteFailingMediaStorage(database.Storage));

        var updated = GetUpdatedAmenity(await controller.Update(
            amenity.Id,
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = amenity.Name,
                Slug = amenity.Slug,
                IconUploadToken = staged.UploadToken,
                Scope = amenity.Scope
            },
            CancellationToken.None));

        Assert.NotEqual(oldAsset.PublicPath, updated.Icon);
        Assert.True(File.Exists(database.GetFinalPath(updated.Icon!)));
        Assert.True(File.Exists(database.GetFinalPath(oldAsset.PublicPath)));
        await using var verificationContext = database.CreateVerificationContext();
        Assert.Equal(
            updated.Icon,
            (await verificationContext.Amenities.AsNoTracking().SingleAsync(item => item.Id == amenity.Id)).Icon);
    }

    [Fact]
    public async Task LegacyReplacementAndRemoval_NeverDeleteLegacyPhysicalFile()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        const string legacyPath = "/svgs/amenity-categories/legacy.svg";
        var legacyPhysicalPath = Path.Combine(
            database.Environment.WebRootPath,
            "svgs",
            "amenity-categories",
            "legacy.svg");
        Directory.CreateDirectory(Path.GetDirectoryName(legacyPhysicalPath)!);
        await File.WriteAllTextAsync(legacyPhysicalPath, SafeSvg);
        category.Icon = legacyPath;
        await database.Context.SaveChangesAsync();
        var staged = await database.Storage.StageSanitizedSvgAsync(
            MediaAssetNamespace.AmenityCategories, SafeSvg);

        var replaced = GetUpdatedCategory(await database.CreateCategoryController().Update(
            category.Id,
            CreateCategoryUpdate(category, staged.UploadToken),
            CancellationToken.None));

        Assert.StartsWith($"/uploads/amenity-categories/{category.Id}/", replaced.Icon, StringComparison.Ordinal);
        Assert.True(File.Exists(legacyPhysicalPath));

        var removed = GetUpdatedCategory(await database.CreateCategoryController().Update(
            category.Id,
            CreateCategoryUpdate(category, removeIcon: true),
            CancellationToken.None));

        Assert.Null(removed.Icon);
        Assert.True(File.Exists(legacyPhysicalPath));
        Assert.False(File.Exists(database.GetFinalPath(replaced.Icon!)));

        var legacyOnlyCategory = await database.SeedCategoryAsync();
        legacyOnlyCategory.Icon = legacyPath;
        await database.Context.SaveChangesAsync();
        var legacyRemoved = GetUpdatedCategory(await database.CreateCategoryController().Update(
            legacyOnlyCategory.Id,
            CreateCategoryUpdate(legacyOnlyCategory, removeIcon: true),
            CancellationToken.None));

        Assert.Null(legacyRemoved.Icon);
        Assert.True(File.Exists(legacyPhysicalPath));
    }

    [Theory]
    [InlineData(null, false, IconWriteAction.Preserve)]
    [InlineData("token", false, IconWriteAction.Replace)]
    public void CreateIconState_AcceptsEmptyOrStagedInput(
        string? uploadToken,
        bool removeIcon,
        IconWriteAction expected)
    {
        Assert.Equal(
            expected,
            IconWriteRequestValidator.ValidateCreate(uploadToken, removeIcon));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("token")]
    public void CreateIconState_RejectsRemoval(string? uploadToken)
    {
        Assert.Throws<ArgumentException>(() =>
            IconWriteRequestValidator.ValidateCreate(uploadToken, removeIcon: true));
    }

    [Theory]
    [InlineData(null, false, IconWriteAction.Preserve)]
    [InlineData("token", false, IconWriteAction.Replace)]
    [InlineData(null, true, IconWriteAction.Remove)]
    public void UpdateIconState_AcceptsPreserveReplaceAndRemove(
        string? uploadToken,
        bool removeIcon,
        IconWriteAction expected)
    {
        Assert.Equal(
            expected,
            IconWriteRequestValidator.ValidateUpdate(uploadToken, removeIcon));
    }

    [Fact]
    public void UpdateIconState_RejectsTokenWithRemoval()
    {
        Assert.Throws<ArgumentException>(() =>
            IconWriteRequestValidator.ValidateUpdate("token", removeIcon: true));
    }

    [Theory]
    [InlineData("category", false)]
    [InlineData("category", true)]
    [InlineData("amenity", false)]
    [InlineData("amenity", true)]
    public async Task CreateControllers_RejectRemovalWithOrWithoutToken(
        string target,
        bool includeToken)
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = target == "amenity" ? await database.SeedCategoryAsync() : null;

        if (target == "category")
        {
            await Assert.ThrowsAsync<ArgumentException>(() =>
                database.CreateCategoryController().Create(
                    new AmenityCategoryRequest
                    {
                        Name = "Rejected category",
                        Slug = "rejected-category",
                        IconUploadToken = includeToken ? "token" : null,
                        RemoveIcon = true
                    },
                    CancellationToken.None));
        }
        else
        {
            await Assert.ThrowsAsync<ArgumentException>(() =>
                database.CreateAmenityController().Create(
                    new AmenityRequest
                    {
                        AmenityCategoryId = category!.Id,
                        Name = "Rejected amenity",
                        Slug = "rejected-amenity",
                        IconUploadToken = includeToken ? "token" : null,
                        RemoveIcon = true,
                        Scope = AmenityScope.Property
                    },
                    CancellationToken.None));
        }

        Assert.Empty(await database.Context.Amenities.ToListAsync());
        Assert.Equal(target == "amenity" ? 1 : 0, await database.Context.AmenityCategories.CountAsync());
    }

    [Theory]
    [InlineData("category")]
    [InlineData("amenity")]
    public async Task UpdateControllers_RejectTokenWithRemovalAndPreserveCurrentIcon(string target)
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = target == "amenity" ? await database.SeedAmenityAsync(category.Id) : null;
        const string currentIcon = "/svgs/current.svg";
        if (target == "category")
        {
            category.Icon = currentIcon;
        }
        else
        {
            amenity!.Icon = currentIcon;
        }
        await database.Context.SaveChangesAsync();

        if (target == "category")
        {
            await Assert.ThrowsAsync<ArgumentException>(() =>
                database.CreateCategoryController().Update(
                    category.Id,
                    new AmenityCategoryRequest
                    {
                        Name = category.Name,
                        Slug = category.Slug,
                        IconUploadToken = "token",
                        RemoveIcon = true,
                        IsActive = true
                    },
                    CancellationToken.None));
            Assert.Equal(currentIcon, category.Icon);
        }
        else
        {
            await Assert.ThrowsAsync<ArgumentException>(() =>
                database.CreateAmenityController().Update(
                    amenity!.Id,
                    new AmenityRequest
                    {
                        AmenityCategoryId = category.Id,
                        Name = amenity.Name,
                        Slug = amenity.Slug,
                        IconUploadToken = "token",
                        RemoveIcon = true,
                        Scope = amenity.Scope
                    },
                    CancellationToken.None));
            Assert.Equal(currentIcon, amenity!.Icon);
        }
    }

    [Fact]
    public async Task CategoryAndAmenityNoActionUpdates_PreserveLegacyCanonicalSymbolicAndNullIcons()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        category.Icon = "/svgs/amenity-categories/base-services.svg";
        var amenity = await database.SeedAmenityAsync(category.Id);
        amenity.Icon = $"/uploads/amenities/{amenity.Id}/{new string('a', 32)}.svg";
        var symbolicAmenity = await database.SeedAmenityAsync(category.Id);
        symbolicAmenity.Icon = "wifi";
        var nullIconCategory = await database.SeedCategoryAsync();
        await database.Context.SaveChangesAsync();

        var exactCategory = GetUpdatedCategory(await database.CreateCategoryController().Update(
            category.Id,
            new AmenityCategoryRequest
            {
                Name = category.Name,
                Slug = category.Slug,
                IsActive = true
            },
            CancellationToken.None));
        var exactAmenity = GetUpdatedAmenity(await database.CreateAmenityController().Update(
            amenity.Id,
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = amenity.Name,
                Slug = amenity.Slug,
                Scope = amenity.Scope
            },
            CancellationToken.None));
        var nullAmenity = GetUpdatedAmenity(await database.CreateAmenityController().Update(
            symbolicAmenity.Id,
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = symbolicAmenity.Name,
                Slug = symbolicAmenity.Slug,
                Scope = symbolicAmenity.Scope
            },
            CancellationToken.None));
        var nullCategory = GetUpdatedCategory(await database.CreateCategoryController().Update(
            nullIconCategory.Id,
            new AmenityCategoryRequest
            {
                Name = nullIconCategory.Name,
                Slug = nullIconCategory.Slug,
                IsActive = true
            },
            CancellationToken.None));

        Assert.Equal("/svgs/amenity-categories/base-services.svg", exactCategory.Icon);
        Assert.Equal(amenity.Icon, exactAmenity.Icon);
        Assert.Equal("wifi", nullAmenity.Icon);
        Assert.Null(nullCategory.Icon);
    }

    [Theory]
    [InlineData("category", "/uploads/amenity-categories/41/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg")]
    [InlineData("amenity", "/svgs/amenities/wifi.svg")]
    [InlineData("amenity", null)]
    public async Task NoActionUpdate_PreservesAdditionalCanonicalLegacyAndNullFixtures(
        string target,
        string? currentIcon)
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        if (target == "category")
        {
            category.Icon = currentIcon;
            await database.Context.SaveChangesAsync();
            var updated = GetUpdatedCategory(await database.CreateCategoryController().Update(
                category.Id,
                new AmenityCategoryRequest
                {
                    Name = category.Name,
                    Slug = category.Slug,
                    IsActive = true
                },
                CancellationToken.None));
            Assert.Equal(currentIcon, updated.Icon);
            return;
        }

        var amenity = await database.SeedAmenityAsync(category.Id);
        amenity.Icon = currentIcon;
        await database.Context.SaveChangesAsync();
        var updatedAmenity = GetUpdatedAmenity(await database.CreateAmenityController().Update(
            amenity.Id,
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = amenity.Name,
                Slug = amenity.Slug,
                Scope = amenity.Scope
            },
            CancellationToken.None));
        Assert.Equal(currentIcon, updatedAmenity.Icon);
    }

    [Fact]
    public async Task AmenityExplicitRemoval_ClearsReferenceAndDeletesOwnedAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        var amenity = await database.SeedAmenityAsync(category.Id);
        var ownedAsset = await database.StoreFinalAsync(MediaAssetNamespace.Amenities, amenity.Id);
        amenity.Icon = ownedAsset.PublicPath;
        await database.Context.SaveChangesAsync();

        var updated = GetUpdatedAmenity(await database.CreateAmenityController().Update(
            amenity.Id,
            new AmenityRequest
            {
                AmenityCategoryId = category.Id,
                Name = amenity.Name,
                Slug = amenity.Slug,
                RemoveIcon = true,
                Scope = amenity.Scope
            },
            CancellationToken.None));

        Assert.Null(updated.Icon);
        Assert.False(File.Exists(database.GetFinalPath(ownedAsset.PublicPath)));
    }

    [Fact]
    public async Task RawJsonObsoleteIconMembers_AreIgnoredAndCannotMutateOrCreateAssets()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        category.Icon = "/svgs/amenity-categories/original.svg";
        var amenity = await database.SeedAmenityAsync(category.Id);
        amenity.Icon = "/uploads/amenities/42/original.svg";
        await database.Context.SaveChangesAsync();

        var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var finalAssetCount = Directory.Exists(database.Storage.RootPath)
            ? Directory.GetFiles(database.Storage.RootPath, "*.svg", SearchOption.AllDirectories).Length
            : 0;
        var obsoleteValues = new[]
        {
            "/svgs/amenities/water.svg",
            $"/uploads/amenities/999/{Guid.NewGuid():N}.svg",
            "https://example.test/x.svg",
            "utilities"
        };

        foreach (var obsoleteIcon in obsoleteValues)
        {
            var categoryJson = JsonSerializer.Serialize(new
            {
                name = category.Name,
                slug = category.Slug,
                icon = obsoleteIcon,
                isActive = true
            });
            var categoryRequest = JsonSerializer.Deserialize<AmenityCategoryRequest>(
                categoryJson,
                jsonOptions)!;
            _ = GetUpdatedCategory(await database.CreateCategoryController().Update(
                category.Id,
                categoryRequest,
                CancellationToken.None));

            var amenityJson = JsonSerializer.Serialize(new
            {
                amenityCategoryId = category.Id,
                name = amenity.Name,
                slug = amenity.Slug,
                icon = obsoleteIcon,
                scope = AmenityScope.Property
            });
            var amenityRequest = JsonSerializer.Deserialize<AmenityRequest>(amenityJson, jsonOptions)!;
            _ = GetUpdatedAmenity(await database.CreateAmenityController().Update(
                amenity.Id,
                amenityRequest,
                CancellationToken.None));
        }

        Assert.Equal(
            "/svgs/amenity-categories/original.svg",
            (await database.Context.AmenityCategories.FindAsync(category.Id))!.Icon);
        Assert.Equal(
            "/uploads/amenities/42/original.svg",
            (await database.Context.Amenities.FindAsync(amenity.Id))!.Icon);
        Assert.Equal(
            finalAssetCount,
            Directory.Exists(database.Storage.RootPath)
                ? Directory.GetFiles(database.Storage.RootPath, "*.svg", SearchOption.AllDirectories).Length
                : 0);
    }

    [Fact]
    public async Task AbandonedStage_DoesNotMutateEntityAndExpiresWithoutTouchingCurrentIcon()
    {
        await using var database = await TestDatabase.CreateAsync();
        var category = await database.SeedCategoryAsync();
        const string currentIcon = "/svgs/amenity-categories/current.svg";
        category.Icon = currentIcon;
        await database.Context.SaveChangesAsync();
        var currentPhysicalPath = Path.Combine(
            database.Environment.WebRootPath,
            "svgs",
            "amenity-categories",
            "current.svg");
        Directory.CreateDirectory(Path.GetDirectoryName(currentPhysicalPath)!);
        await File.WriteAllTextAsync(currentPhysicalPath, SafeSvg);

        var staged = GetStageResponse(await database.CreateCategoryController().StageSvg(
            CreateFormFile(SafeSvg), CancellationToken.None));

        Assert.Equal(currentIcon, (await database.Context.AmenityCategories.FindAsync(category.Id))!.Icon);
        Assert.True(File.Exists(currentPhysicalPath));
        database.TimeProvider.Advance(TimeSpan.FromHours(25));
        Assert.Equal(1, await database.Storage.CleanupExpiredStagedAssetsAsync());
        Assert.False(File.Exists(database.GetStagedPath(staged)));
        Assert.Equal(currentIcon, (await database.Context.AmenityCategories.FindAsync(category.Id))!.Icon);
        Assert.True(File.Exists(currentPhysicalPath));
    }

    private static AmenityCategoryRequest CreateCategoryUpdate(
        AmenityCategory category,
        string? uploadToken = null,
        bool removeIcon = false) => new()
    {
        Name = category.Name,
        Slug = category.Slug,
        SortOrder = category.SortOrder,
        IsActive = category.IsActive,
        IconUploadToken = uploadToken,
        RemoveIcon = removeIcon
    };

    private static AmenityRequest CreateAmenityUpdate(
        Amenity amenity,
        AmenityScope scope) => new()
    {
        AmenityCategoryId = amenity.AmenityCategoryId,
        Name = amenity.Name,
        Slug = amenity.Slug,
        Description = amenity.Description,
        Scope = scope,
        SortOrder = amenity.SortOrder
    };

    private static void AssertApiBadRequest(ArgumentException exception)
    {
        var context = CreateExceptionContext(exception);
        new ApiExceptionFilter().OnException(context);

        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(StatusCodes.Status400BadRequest, result.StatusCode);
        Assert.Equal(exception.Message, ReadMessage(result.Value));
    }

    private static FormFile CreateFormFile(string content)
    {
        var stream = new MemoryStream(Encoding.UTF8.GetBytes(content));
        return new FormFile(stream, 0, stream.Length, "file", "icon.svg");
    }

    private static AmenitySvgStageResponse GetStageResponse(
        ActionResult<AmenitySvgStageResponse> result) =>
        Assert.IsType<AmenitySvgStageResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static AmenityCategoryResponse GetCreatedCategory(
        ActionResult<AmenityCategoryResponse> result) =>
        Assert.IsType<AmenityCategoryResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

    private static AmenityResponse GetCreatedAmenity(ActionResult<AmenityResponse> result) =>
        Assert.IsType<AmenityResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

    private static AmenityCategoryResponse GetUpdatedCategory(
        ActionResult<AmenityCategoryResponse> result) =>
        Assert.IsType<AmenityCategoryResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static AmenityResponse GetUpdatedAmenity(ActionResult<AmenityResponse> result) =>
        Assert.IsType<AmenityResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static ExceptionContext CreateExceptionContext(Exception exception)
    {
        var actionContext = new ActionContext(
            new DefaultHttpContext(),
            new RouteData(),
            new ActionDescriptor());
        return new ExceptionContext(actionContext, []) { Exception = exception };
    }

    private static string ReadMessage(object? value)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value));
        return document.RootElement.GetProperty("message").GetString()!;
    }

    private sealed class TestDatabase : IAsyncDisposable
    {
        private readonly TemporaryDirectory temp;
        private readonly SqliteConnection connection;
        private readonly DbContextOptions<KoochDbContext> options;

        private TestDatabase(
            TemporaryDirectory temp,
            SqliteConnection connection,
            DbContextOptions<KoochDbContext> options,
            FailingKoochDbContext context,
            TestWebHostEnvironment environment,
            FileSystemMediaStorage storage,
            AdvanceableTimeProvider timeProvider)
        {
            this.temp = temp;
            this.connection = connection;
            this.options = options;
            Context = context;
            Environment = environment;
            Storage = storage;
            TimeProvider = timeProvider;
        }

        public FailingKoochDbContext Context { get; }
        public TestWebHostEnvironment Environment { get; }
        public FileSystemMediaStorage Storage { get; }
        public AdvanceableTimeProvider TimeProvider { get; }

        public static async Task<TestDatabase> CreateAsync()
        {
            var temp = new TemporaryDirectory();
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            var context = new FailingKoochDbContext(options);
            await context.Database.EnsureCreatedAsync();
            var environment = CreateEnvironment(temp.Path);
            var timeProvider = new AdvanceableTimeProvider(
                new DateTimeOffset(2026, 8, 30, 8, 0, 0, TimeSpan.Zero));
            var storage = new FileSystemMediaStorage(
                Options.Create(new MediaStorageOptions
                {
                    RootPath = "../../media-root",
                    PublicBasePath = "/uploads",
                    StagingLifetimeHours = 24
                }),
                environment,
                timeProvider);
            return new TestDatabase(temp, connection, options, context, environment, storage, timeProvider);
        }

        public AmenityCategoriesController CreateCategoryController() => ConfigureController(
            new AmenityCategoriesController(
                Context,
                new AllowPermissionService(),
                new SvgSanitizer(),
                Storage,
                NullLogger<AmenityCategoriesController>.Instance));

        public AmenitiesController CreateAmenityController(IMediaStorage? mediaStorage = null) => ConfigureController(
            new AmenitiesController(
                Context,
                new AllowPermissionService(),
                new SvgSanitizer(),
                mediaStorage ?? Storage,
                NullLogger<AmenitiesController>.Instance));

        public async Task<AmenityCategory> SeedCategoryAsync()
        {
            var category = new AmenityCategory
            {
                Name = "Category",
                Slug = $"category-{Guid.NewGuid():N}",
                IsActive = true
            };
            Context.AmenityCategories.Add(category);
            await Context.SaveChangesAsync();
            return category;
        }

        public async Task<Amenity> SeedAmenityAsync(
            int categoryId,
            AmenityScope scope = AmenityScope.Property)
        {
            var amenity = new Amenity
            {
                AmenityCategoryId = categoryId,
                Name = "Amenity",
                Slug = $"amenity-{Guid.NewGuid():N}",
                Scope = scope
            };
            Context.Amenities.Add(amenity);
            await Context.SaveChangesAsync();
            return amenity;
        }

        public async Task<(Property Property, RoomType RoomType)> SeedAssignmentTargetsAsync()
        {
            var owner = new User
            {
                FirstName = "Test",
                LastName = "Owner",
                PasswordHash = "hash",
                Role = UserRole.SuperAdmin,
                IsActive = true
            };
            var destination = new Destination
            {
                Name = "Test destination",
                Slug = $"destination-{Guid.NewGuid():N}",
                Country = "IR"
            };
            var property = new Property
            {
                Owner = owner,
                Destination = destination,
                Name = "Test property",
                Slug = $"property-{Guid.NewGuid():N}",
                Description = "Test property",
                Address = "Test address",
                City = "Test city",
                Country = "IR"
            };
            var roomType = new RoomType
            {
                Property = property,
                Name = "Test room type",
                Slug = $"room-type-{Guid.NewGuid():N}",
                Description = "Test room type",
                MaxAdults = 2,
                TotalInventory = 1,
                InventoryMode = InventoryMode.TypeBasedInventory
            };
            Context.RoomTypes.Add(roomType);
            await Context.SaveChangesAsync();
            return (property, roomType);
        }

        public async Task<StoredMediaAsset> StoreFinalAsync(
            MediaAssetNamespace assetNamespace,
            int entityId)
        {
            await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(SafeSvg));
            return await Storage.StoreSanitizedSvgAsync(assetNamespace, entityId, stream);
        }

        public string GetStagedPath(StagedMediaAsset staged) =>
            GetStagedPath(staged.AssetNamespace, staged.UploadToken);

        public string GetStagedPath(AmenitySvgStageResponse staged) =>
            GetStagedPath(staged.AssetNamespace, staged.UploadToken);

        public string GetFinalPath(string publicPath)
        {
            var relative = publicPath[(Storage.PublicBasePath.Length + 1)..]
                .Replace('/', Path.DirectorySeparatorChar);
            return Path.GetFullPath(Path.Combine(Storage.RootPath, relative));
        }

        public KoochDbContext CreateVerificationContext() => new(options);

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
            temp.Dispose();
        }

        private string GetStagedPath(MediaAssetNamespace assetNamespace, string token) =>
            Path.Combine(
                Storage.RootPath,
                ".staging",
                assetNamespace == MediaAssetNamespace.Amenities ? "amenities" : "amenity-categories",
                $"{token}.svg");

        private static TController ConfigureController<TController>(TController controller)
            where TController : ControllerBase
        {
            controller.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [
                            new Claim(ClaimTypes.NameIdentifier, "1"),
                            new Claim(ClaimTypes.Role, UserRole.AdminAssistant.ToString())
                        ],
                        "Test"))
                }
            };
            return controller;
        }

        private static TestWebHostEnvironment CreateEnvironment(string tempRoot)
        {
            var contentRoot = Path.Combine(tempRoot, "repo", "backend", "Kooch.Api");
            var webRoot = Path.Combine(contentRoot, "wwwroot");
            Directory.CreateDirectory(webRoot);
            return new TestWebHostEnvironment
            {
                ApplicationName = "Kooch.Api.Tests",
                EnvironmentName = "Testing",
                ContentRootPath = contentRoot,
                WebRootPath = webRoot
            };
        }
    }

    private sealed class FailingKoochDbContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        private int successfulSavesBeforeFailure = -1;

        public void FailAfterSuccessfulSaves(int count) => successfulSavesBeforeFailure = count;

        public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            if (successfulSavesBeforeFailure == 0)
            {
                successfulSavesBeforeFailure = -1;
                throw new DbUpdateException("Simulated database write failure.");
            }

            if (successfulSavesBeforeFailure > 0)
            {
                successfulSavesBeforeFailure--;
            }

            return await base.SaveChangesAsync(cancellationToken);
        }
    }

    private sealed class AllowPermissionService : IPermissionService
    {
        public Task<bool> CanAsync(
            int userId,
            int propertyId,
            string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<bool> HasPermissionAsync(
            int userId,
            PermissionKey permissionKey,
            int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private sealed class DeleteFailingMediaStorage(IMediaStorage inner) : IMediaStorage
    {
        public string RootPath => inner.RootPath;
        public string PublicBasePath => inner.PublicBasePath;

        public void Initialize() => inner.Initialize();

        public Task<StoredMediaAsset> StoreSanitizedSvgAsync(
            MediaAssetNamespace assetNamespace,
            int entityId,
            Stream sanitizedSvgContent,
            CancellationToken cancellationToken = default) =>
            inner.StoreSanitizedSvgAsync(assetNamespace, entityId, sanitizedSvgContent, cancellationToken);

        public Task<StagedMediaAsset> StageSanitizedSvgAsync(
            MediaAssetNamespace assetNamespace,
            string sanitizedSvg,
            CancellationToken cancellationToken = default) =>
            inner.StageSanitizedSvgAsync(assetNamespace, sanitizedSvg, cancellationToken);

        public Task<StoredMediaAsset> FinalizeStagedSvgAsync(
            MediaAssetNamespace assetNamespace,
            string uploadToken,
            int entityId,
            CancellationToken cancellationToken = default) =>
            inner.FinalizeStagedSvgAsync(assetNamespace, uploadToken, entityId, cancellationToken);

        public Task<bool> DeleteOwnedAssetAsync(
            MediaAssetNamespace assetNamespace,
            int entityId,
            string? publicPath,
            CancellationToken cancellationToken = default) =>
            throw new IOException("Simulated old asset cleanup failure.");

        public Task<int> CleanupExpiredStagedAssetsAsync(CancellationToken cancellationToken = default) =>
            inner.CleanupExpiredStagedAssetsAsync(cancellationToken);
    }

    private sealed class AdvanceableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;

        public void Advance(TimeSpan duration) => utcNow = utcNow.Add(duration);
    }

    private sealed class TestWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = string.Empty;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = string.Empty;
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                $"kooch-amenity-svg-pipeline-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
