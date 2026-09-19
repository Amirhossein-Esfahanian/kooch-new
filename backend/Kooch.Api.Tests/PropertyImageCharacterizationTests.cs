using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Kooch.Api.Tests;

// These tests deliberately record existing behavior, including missing cover promotion/cleanup.
public sealed class PropertyImageCharacterizationTests
{
    [Fact]
    public async Task ControllerMultipartUpload_ReturnsPropertyScopedDtos_AndFirstCover()
    {
        using var f = new Fixture();
        var controller = new PropertyImagesController(f.Service)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([
                        new Claim(ClaimTypes.NameIdentifier, "1"),
                        new Claim(ClaimTypes.Role, nameof(UserRole.SuperAdmin))], "test"))
                }
            }
        };
        var result = await controller.Upload(10, await Request(null, 2), default);
        var response = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(201, response.StatusCode);
        var images = Assert.IsAssignableFrom<IReadOnlyList<PropertyImageResponse>>(response.Value);
        Assert.Equal(2, images.Count);
        Assert.Equal(new[] { 0, 1 }, images.Select(i => i.SortOrder));
        Assert.True(images[0].IsCover);
        Assert.False(images[1].IsCover);
        foreach (var image in images)
        {
            Assert.Equal(10, image.PropertyId);
            Assert.Null(image.RoomTypeId);
            Assert.Null(image.RoomId);
            Assert.True(image.IsGallery);
            Assert.StartsWith("/uploads/properties/10/", image.Url);
            Assert.EndsWith(".webp", image.Url);
            Assert.True(File.Exists(f.PathFor(image.Url)));
            var row = await f.Db.PropertyImages.AsNoTracking().SingleAsync(i => i.Id == image.Id);
            Assert.Equal(row.Url, image.Url);
            Assert.Equal(row.AltText, image.AltText);
            Assert.Equal("room", image.Tag);
            Assert.Equal("caption", image.Caption);
        }
    }

    [Fact]
    public async Task RoomUploads_SharePropertyOrdering_AndDoNotCreateRoomCover()
    {
        using var f = new Fixture();
        var property = Assert.Single(await f.Upload(null));
        var room = Assert.Single(await f.Upload(20));
        var otherRoom = Assert.Single(await f.Upload(21));
        var nextProperty = Assert.Single(await f.Upload(null));
        Assert.Equal(new[] { 0, 1, 2, 3 }, new[] { property.SortOrder, room.SortOrder, otherRoom.SortOrder, nextProperty.SortOrder });
        Assert.Equal(10, room.PropertyId);
        Assert.Equal(20, room.RoomTypeId);
        Assert.Null(room.RoomId);
        Assert.False(room.IsCover);
        Assert.False(otherRoom.IsCover);
        Assert.False(nextProperty.IsCover);
    }

    [Theory]
    [InlineData(99)]
    [InlineData(999)]
    public async Task ForeignOrMissingRoomType_IsRejected(int roomId)
    {
        using var f = new Fixture();
        await Assert.ThrowsAsync<ArgumentException>(() => f.Upload(roomId));
        Assert.Empty(await f.Db.PropertyImages.ToListAsync());
    }

    [Fact]
    public async Task CollectionCap_CountsPropertyAndAllRoomTypeImagesTogether()
    {
        using var f = new Fixture();
        f.Setting("image.maxImagesPerProperty", "2");
        await f.Upload(null);
        await f.Upload(20);
        await Assert.ThrowsAsync<ArgumentException>(() => f.Upload(21));
        Assert.Equal(2, await f.Db.PropertyImages.CountAsync());
    }

    [Theory]
    [InlineData(799, 600)]
    [InlineData(800, 599)]
    public async Task DefaultMinimumDimensions_RejectEitherUndersizedDimension(int width, int height)
    {
        using var f = new Fixture();
        var request = new PropertyImageUploadRequest { Files = [await Png(width, height)] };
        await Assert.ThrowsAsync<ArgumentException>(() => f.Service.UploadAsync(1, UserRole.SuperAdmin, 10, request));
        Assert.Empty(await f.Db.PropertyImages.ToListAsync());
    }

    [Fact]
    public async Task ConfiguredMinimumDimensions_AreConsumed()
    {
        using var f = new Fixture();
        f.Setting("image.minWidth", "900");
        await Assert.ThrowsAsync<ArgumentException>(() => f.Upload(null));
        var result = await f.Service.UploadAsync(1, UserRole.SuperAdmin, 10,
            new PropertyImageUploadRequest { Files = [await Png(900, 600)] });
        Assert.Single(result);
    }

    [Theory]
    [InlineData("Properties", "Edit")]
    [InlineData("Rooms", "Create")]
    [InlineData("Rooms", "Edit")]
    [InlineData("Rooms", "Delete")]
    public async Task CurrentPermissionAlternatives_AllowUploadUpdateAndDelete(string group, string action)
    {
        using var f = new Fixture();
        f.Grant(group, action);
        var row = Assert.Single(await f.Upload(null, actor: 2));
        await f.Service.UpdateAsync(2, UserRole.Client, row.Id, new PropertyImageRequest { Url = row.Url, IsCover = true });
        await f.Service.DeleteAsync(2, UserRole.Client, row.Id);
        Assert.Empty(await f.Db.PropertyImages.ToListAsync());
    }

    [Fact]
    public async Task UnauthorizedActor_CannotUploadUpdateOrDelete_WhileSuperAdminNeedsNoMembership()
    {
        using var f = new Fixture();
        var image = Assert.Single(await f.Upload(null));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => f.Upload(null, actor: 2));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => f.Service.UpdateAsync(2, UserRole.Client, image.Id,
            new PropertyImageRequest { Url = image.Url }));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => f.Service.DeleteAsync(2, UserRole.Client, image.Id));
        Assert.False((await f.Db.PropertyImages.SingleAsync()).IsDeleted);
        Assert.Empty(await f.Db.UserPropertyAccesses.ToListAsync());
    }

    [Fact]
    public async Task SettingPropertyCover_UnsetsPreviousCover_ButNotOtherScope()
    {
        using var f = new Fixture();
        var first = Assert.Single(await f.Upload(null));
        var second = Assert.Single(await f.Upload(null));
        var room = Assert.Single(await f.Upload(20));
        await f.Service.UpdateAsync(1, UserRole.SuperAdmin, room.Id,
            new PropertyImageRequest { Url = room.Url, RoomTypeId = 20, IsCover = true, SortOrder = room.SortOrder });
        await f.Service.UpdateAsync(1, UserRole.SuperAdmin, second.Id,
            new PropertyImageRequest { Url = second.Url, IsCover = true, SortOrder = second.SortOrder });
        Assert.False((await f.Db.PropertyImages.SingleAsync(i => i.Id == first.Id)).IsCover);
        Assert.True((await f.Db.PropertyImages.SingleAsync(i => i.Id == second.Id)).IsCover);
        Assert.True((await f.Db.PropertyImages.SingleAsync(i => i.Id == room.Id)).IsCover);
    }

    [Fact]
    public async Task DeletingCover_SoftDeletesOnly_LeavesFileAndDoesNotPromoteRemainingImage()
    {
        using var f = new Fixture();
        var cover = Assert.Single(await f.Upload(null));
        var remaining = Assert.Single(await f.Upload(null));
        await f.Service.DeleteAsync(1, UserRole.SuperAdmin, cover.Id);
        var deleted = await f.Db.PropertyImages.IgnoreQueryFilters().AsNoTracking().SingleAsync(i => i.Id == cover.Id);
        Assert.True(deleted.IsDeleted);
        Assert.NotNull(deleted.DeletedAtUtc);
        Assert.Equal(1, deleted.DeletedByUserId);
        Assert.True(File.Exists(f.PathFor(cover.Url)));
        Assert.False(Assert.Single(await f.Service.GetAsync(1, UserRole.SuperAdmin, 10)).IsCover);
        await f.Service.DeleteAsync(1, UserRole.SuperAdmin, remaining.Id);
        Assert.Empty(await f.Service.GetAsync(1, UserRole.SuperAdmin, 10));
        Assert.True(File.Exists(f.PathFor(remaining.Url)));
    }

    [Fact]
    public async Task DeletingRoomImage_LeavesPropertyAndOtherRoomImagesUntouched()
    {
        using var f = new Fixture();
        var property = Assert.Single(await f.Upload(null));
        var room = Assert.Single(await f.Upload(20));
        var other = Assert.Single(await f.Upload(21));
        await f.Service.DeleteAsync(1, UserRole.SuperAdmin, room.Id);
        Assert.Equal(new[] { property.Id, other.Id }, (await f.Service.GetAsync(1, UserRole.SuperAdmin, 10)).Select(i => i.Id));
        Assert.True(File.Exists(f.PathFor(room.Url)));
    }

    [Fact]
    public async Task ManagementGet_OrdersCoverThenSortOrderThenId()
    {
        using var f = new Fixture();
        f.Db.PropertyImages.AddRange(
            new PropertyImage { Id = 31, PropertyId = 10, SortOrder = 2, Url = "/31.png" },
            new PropertyImage { Id = 30, PropertyId = 10, SortOrder = 2, Url = "/30.png" },
            new PropertyImage { Id = 32, PropertyId = 10, SortOrder = 99, IsCover = true, Url = "/32.png" },
            new PropertyImage { Id = 33, PropertyId = 10, SortOrder = 1, Url = "/33.png" });
        await f.Db.SaveChangesAsync();
        Assert.Equal(new[] { 32, 33, 30, 31 }, (await f.Service.GetAsync(1, UserRole.SuperAdmin, 10)).Select(i => i.Id));
    }

    private static async Task<PropertyImageUploadRequest> Request(int? roomTypeId, int count = 1)
    {
        var request = new PropertyImageUploadRequest { RoomTypeId = roomTypeId, Tag = "room", Caption = "caption" };
        for (var i = 0; i < count; i++) request.Files.Add(await Png(800, 600));
        return request;
    }

    private static async Task<FormFile> Png(int width, int height)
    {
        using var image = new Image<Rgba32>(width, height);
        var stream = new MemoryStream();
        await image.SaveAsPngAsync(stream);
        stream.Position = 0;
        return new FormFile(stream, 0, stream.Length, "files", "test.png") { Headers = new HeaderDictionary(), ContentType = "image/png" };
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string root = Path.Combine(Path.GetTempPath(), "kooch-image-characterization-" + Guid.NewGuid().ToString("N"));
        public KoochDbContext Db { get; } = new(new DbContextOptionsBuilder<KoochDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        public PropertyImageService Service { get; }
        public Fixture()
        {
            Directory.CreateDirectory(root);
            Db.Users.AddRange(new User { Id = 1, Role = UserRole.SuperAdmin }, new User { Id = 2, Role = UserRole.Client });
            Db.Properties.AddRange(new Property { Id = 10, OwnerId = 1, Name = "Property" }, new Property { Id = 11, OwnerId = 1, Name = "Other" });
            Db.RoomTypes.AddRange(new RoomType { Id = 20, PropertyId = 10, Name = "Room A" }, new RoomType { Id = 21, PropertyId = 10, Name = "Room B" }, new RoomType { Id = 99, PropertyId = 11, Name = "Foreign" });
            Db.SaveChanges();
            Service = new PropertyImageService(Db, new PropertyAccessService(Db), new TestEnvironment { WebRootPath = root, ContentRootPath = root });
        }
        public async Task<IReadOnlyList<PropertyImageResponse>> Upload(int? room, int actor = 1) =>
            await Service.UploadAsync(actor, actor == 1 ? UserRole.SuperAdmin : UserRole.Client, 10, await Request(room));
        public string PathFor(string url) => Path.Combine(root, url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
        public void Setting(string key, string value)
        {
            Db.SiteSettings.Add(new SiteSetting { Key = key, Value = value, Group = "Images", IsActive = true });
            Db.SaveChanges();
        }
        public void Grant(string group, string action)
        {
            var matrix = new PermissionMatrixDto
            {
                [group] = new PermissionActionsDto { View = true, Edit = action == "Edit", Create = action == "Create", Delete = action == "Delete" }
            };
            Db.UserPropertyAccesses.Add(new UserPropertyAccess { UserId = 2, PropertyId = 10, PropertyRole = PropertyUserRole.Custom,
                Status = PropertyUserStatus.Active, IsActive = true, PermissionMatrixJson = JsonSerializer.Serialize(matrix) });
            Db.SaveChanges();
        }
        public void Dispose() { Db.Dispose(); Directory.Delete(root, true); }
    }

    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "Tests";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Development";
    }
}
