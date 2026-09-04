using System.Reflection;
using System.Text;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BedTypeApiIconTests
{
    private const string SafeSvg =
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0h1v1H0z\"/></svg>";

    [Fact]
    public void MutationAndStagingEndpoints_AreAdminOnly()
    {
        AssertAdminOnly(nameof(BedTypesController.Create));
        AssertAdminOnly(nameof(BedTypesController.Update));
        AssertAdminOnly(nameof(BedTypesController.Delete));
        AssertAdminOnly(nameof(BedTypesController.StageSvg));
    }

    [Fact]
    public async Task CreateWithoutIcon_UsesRequiredUniqueSlugAndLeavesIconNull()
    {
        await using var database = await TestDatabase.CreateAsync();
        var controller = database.CreateController();

        var created = GetCreated(await controller.Create(
            new CreateBedTypeRequest { Name = "  تخت سفری  ", Slug = "travel-bed" },
            CancellationToken.None));

        Assert.Equal("تخت سفری", created.Name);
        Assert.Equal("travel-bed", created.Slug);
        Assert.Null(created.Icon);
        Assert.Null((await database.Context.BedTypes.FindAsync(created.Id))!.Icon);

        await Assert.ThrowsAsync<InvalidOperationException>(() => controller.Create(
            new CreateBedTypeRequest { Name = "Duplicate", Slug = "travel-bed" },
            CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => controller.Create(
            new CreateBedTypeRequest { Name = "Blank slug", Slug = " " },
            CancellationToken.None));
    }

    [Fact]
    public async Task StagedCreate_FinalizesUnderBedTypeNamespace()
    {
        await using var database = await TestDatabase.CreateAsync();
        var controller = database.CreateController();
        var staged = GetStaged(await controller.StageSvg(
            CreateFormFile(SafeSvg), CancellationToken.None));

        Assert.Equal(MediaAssetNamespace.BedTypes, staged.AssetNamespace);
        var created = GetCreated(await controller.Create(
            new CreateBedTypeRequest
            {
                Name = "تخت سفری",
                Slug = "travel-bed",
                IconUploadToken = staged.UploadToken
            },
            CancellationToken.None));

        Assert.Matches(
            $"^/uploads/bed-types/{created.Id}/[0-9a-f]{{32}}\\.svg$",
            created.Icon!);
        Assert.True(File.Exists(database.GetFinalPath(created.Icon!)));
        Assert.False(File.Exists(database.GetStagedPath(staged)));
    }

    [Fact]
    public async Task Update_PreservesReplacesAndRemovesIconWithoutChangingSlug()
    {
        await using var database = await TestDatabase.CreateAsync();
        var controller = database.CreateController();
        var initialStage = GetStaged(await controller.StageSvg(
            CreateFormFile(SafeSvg), CancellationToken.None));
        var created = GetCreated(await controller.Create(
            new CreateBedTypeRequest
            {
                Name = "Original",
                Slug = "immutable-slug",
                IconUploadToken = initialStage.UploadToken
            },
            CancellationToken.None));
        var originalIcon = created.Icon!;

        var preserved = GetUpdated(await controller.Update(
            created.Id,
            new UpdateBedTypeRequest { Name = "Renamed" },
            CancellationToken.None));
        Assert.Equal("immutable-slug", preserved.Slug);
        Assert.Equal(originalIcon, preserved.Icon);
        Assert.True(File.Exists(database.GetFinalPath(originalIcon)));

        var replacementStage = GetStaged(await controller.StageSvg(
            CreateFormFile(SafeSvg), CancellationToken.None));
        var replaced = GetUpdated(await controller.Update(
            created.Id,
            new UpdateBedTypeRequest
            {
                Name = "Renamed",
                IconUploadToken = replacementStage.UploadToken
            },
            CancellationToken.None));
        Assert.NotEqual(originalIcon, replaced.Icon);
        Assert.False(File.Exists(database.GetFinalPath(originalIcon)));
        Assert.True(File.Exists(database.GetFinalPath(replaced.Icon!)));

        var replacementIcon = replaced.Icon!;
        var removed = GetUpdated(await controller.Update(
            created.Id,
            new UpdateBedTypeRequest { Name = "Renamed", RemoveIcon = true },
            CancellationToken.None));
        Assert.Null(removed.Icon);
        Assert.False(File.Exists(database.GetFinalPath(replacementIcon)));
        Assert.Equal("immutable-slug", removed.Slug);
    }

    [Fact]
    public async Task AbandonedStage_DoesNotMutatePersistedIcon()
    {
        await using var database = await TestDatabase.CreateAsync();
        var bedType = new BedType
        {
            Name = "Existing",
            Slug = "existing",
            Icon = "/uploads/bed-types/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg"
        };
        database.Context.BedTypes.Add(bedType);
        await database.Context.SaveChangesAsync();

        _ = GetStaged(await database.CreateController().StageSvg(
            CreateFormFile(SafeSvg), CancellationToken.None));

        database.Context.ChangeTracker.Clear();
        Assert.Equal(
            "/uploads/bed-types/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
            (await database.Context.BedTypes.FindAsync(bedType.Id))!.Icon);
    }

    [Fact]
    public async Task RawIconJson_IsIgnoredAndCannotCreateArbitraryPath()
    {
        await using var database = await TestDatabase.CreateAsync();
        var request = JsonSerializer.Deserialize<CreateBedTypeRequest>(
            """
            {"name":"Unsafe","slug":"unsafe","icon":"https://example.test/icon.svg"}
            """,
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        var created = GetCreated(await database.CreateController().Create(
            request,
            CancellationToken.None));

        Assert.Null(created.Icon);
    }

    [Fact]
    public async Task InvalidSvg_IsRejectedBeforeStaging()
    {
        await using var database = await TestDatabase.CreateAsync();

        await Assert.ThrowsAsync<SvgSanitizationException>(() =>
            database.CreateController().StageSvg(
                CreateFormFile("<svg viewBox=\"0 0 1 1\"><script>alert(1)</script></svg>"),
                CancellationToken.None));

        Assert.False(Directory.Exists(database.Storage.RootPath) &&
                     Directory.GetFiles(database.Storage.RootPath, "*.svg", SearchOption.AllDirectories).Length > 0);
    }

    [Fact]
    public async Task Delete_IsSoftAndRejectsAnyRoomTypeBedReference()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        await using var context = new KoochDbContext(options);
        var referenced = new BedType { Name = "Referenced", Slug = "referenced" };
        var unused = new BedType { Name = "Unused", Slug = "unused" };
        context.BedTypes.AddRange(referenced, unused);
        await context.SaveChangesAsync();
        context.RoomTypeBeds.Add(new RoomTypeBed
        {
            RoomTypeId = 99,
            BedTypeId = referenced.Id,
            Quantity = 1
        });
        await context.SaveChangesAsync();
        var controller = new BedTypesController(
            context,
            null!,
            null!,
            NullLogger<BedTypesController>.Instance);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            controller.Delete(referenced.Id, CancellationToken.None));
        Assert.IsType<NoContentResult>(await controller.Delete(unused.Id, CancellationToken.None));

        var deleted = await context.BedTypes.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == unused.Id);
        Assert.True(deleted.IsDeleted);
        Assert.NotNull(deleted.DeletedAtUtc);
        Assert.False((await context.BedTypes.IgnoreQueryFilters()
            .SingleAsync(item => item.Id == referenced.Id)).IsDeleted);
    }

    private static void AssertAdminOnly(string methodName)
    {
        var method = typeof(BedTypesController).GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .Single(candidate => candidate.Name == methodName);
        var authorize = Assert.Single(method.GetCustomAttributes<AdminAuthorizeAttribute>());
        Assert.Equal(AuthorizationPolicies.AdminUsers, authorize.Policy);
    }

    private static FormFile CreateFormFile(string content)
    {
        var stream = new MemoryStream(Encoding.UTF8.GetBytes(content));
        return new FormFile(stream, 0, stream.Length, "file", "icon.svg");
    }

    private static AmenitySvgStageResponse GetStaged(
        ActionResult<AmenitySvgStageResponse> result) =>
        Assert.IsType<AmenitySvgStageResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static BedTypeResponse GetCreated(ActionResult<BedTypeResponse> result) =>
        Assert.IsType<BedTypeResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

    private static BedTypeResponse GetUpdated(ActionResult<BedTypeResponse> result) =>
        Assert.IsType<BedTypeResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private sealed class TestDatabase : IAsyncDisposable
    {
        private readonly TemporaryDirectory temp;
        private readonly SqliteConnection connection;

        private TestDatabase(
            TemporaryDirectory temp,
            SqliteConnection connection,
            KoochDbContext context,
            FileSystemMediaStorage storage)
        {
            this.temp = temp;
            this.connection = connection;
            Context = context;
            Storage = storage;
        }

        public KoochDbContext Context { get; }
        public FileSystemMediaStorage Storage { get; }

        public static async Task<TestDatabase> CreateAsync()
        {
            var temp = new TemporaryDirectory();
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var context = new KoochDbContext(
                new DbContextOptionsBuilder<KoochDbContext>()
                    .UseSqlite(connection)
                    .Options);
            await context.Database.EnsureCreatedAsync();
            var environment = new TestWebHostEnvironment
            {
                ApplicationName = "Kooch.Api.Tests",
                EnvironmentName = "Testing",
                ContentRootPath = Path.Combine(temp.Path, "backend", "Kooch.Api"),
                WebRootPath = Path.Combine(temp.Path, "backend", "Kooch.Api", "wwwroot")
            };
            Directory.CreateDirectory(environment.WebRootPath);
            var storage = new FileSystemMediaStorage(
                Options.Create(new MediaStorageOptions
                {
                    RootPath = Path.Combine(temp.Path, "media"),
                    PublicBasePath = "/uploads",
                    StagingLifetimeHours = 24
                }),
                environment);
            return new TestDatabase(temp, connection, context, storage);
        }

        public BedTypesController CreateController() => new(
            Context,
            new SvgSanitizer(),
            Storage,
            NullLogger<BedTypesController>.Instance);

        public string GetFinalPath(string publicPath)
        {
            var relative = publicPath[(Storage.PublicBasePath.Length + 1)..]
                .Replace('/', Path.DirectorySeparatorChar);
            return Path.GetFullPath(Path.Combine(Storage.RootPath, relative));
        }

        public string GetStagedPath(AmenitySvgStageResponse staged) =>
            Path.Combine(
                Storage.RootPath,
                ".staging",
                "bed-types",
                $"{staged.UploadToken}.svg");

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
            temp.Dispose();
        }
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
                $"kooch-bed-type-api-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
