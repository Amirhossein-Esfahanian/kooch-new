using System.Security.Claims;
using Kooch.Api.Controllers;
using Kooch.Api.Entities;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.ProfileAvatar;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ProfileAvatarTests
{
    [Fact]
    public async Task UploadWritesActualSquareWebpAtAuthenticatedUsersDeterministicPrivatePath()
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(17);
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(AccountProfileAvatarController), typeof(AuthorizeAttribute)));
        Assert.IsType<NoContentResult>(await controller.Upload(await ImageFileAsync(), default));
        var path = fixture.PathFor(17);
        Assert.True(File.Exists(path));
        Assert.False(File.Exists(fixture.PathFor(18)));
        Assert.False(path.StartsWith(fixture.Media.RootPath + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
        Assert.Single(Directory.GetFiles(Path.GetDirectoryName(path)!, "*.webp"));
        var bytes = await File.ReadAllBytesAsync(path);
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        Assert.Equal("WEBP", System.Text.Encoding.ASCII.GetString(bytes, 8, 4));
        using var image = Image.Load(bytes);
        Assert.Equal(512, image.Width);
        Assert.Equal(512, image.Height);
        Assert.Equal("WEBP", image.Metadata.DecodedImageFormat?.Name.ToUpperInvariant());
    }

    [Fact]
    public async Task ReplacementKeepsOnePathAndInvalidReplacementPreservesPreviousImage()
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(17);
        await controller.Upload(await ImageFileAsync(new Rgba32(255, 0, 0)), default);
        var first = await File.ReadAllBytesAsync(fixture.PathFor(17));
        await controller.Upload(await ImageFileAsync(new Rgba32(0, 0, 255)), default);
        var second = await File.ReadAllBytesAsync(fixture.PathFor(17));
        Assert.NotEqual(first, second);
        Assert.Single(Directory.GetFiles(Path.GetDirectoryName(fixture.PathFor(17))!));
        await Assert.ThrowsAsync<ArgumentException>(() => controller.Upload(
            FormFileFor([1, 2, 3], "photo.png"), default));
        Assert.Equal(second, await File.ReadAllBytesAsync(fixture.PathFor(17)));
    }

    [Fact]
    public async Task ReadAndDeleteAreAuthenticatedUserScopedAndDeleteIsIdempotent()
    {
        using var fixture = new Fixture();
        var first = fixture.Controller(17);
        var second = fixture.Controller(18);
        Assert.IsType<NotFoundResult>(await first.Get(default));
        await first.Upload(await ImageFileAsync(), default);
        Assert.IsType<NotFoundResult>(await second.Get(default));
        var result = Assert.IsType<FileContentResult>(await first.Get(default));
        Assert.Equal("image/webp", result.ContentType);
        Assert.Equal("private, no-cache", first.Response.Headers.CacheControl);
        Assert.False(string.IsNullOrWhiteSpace(first.Response.Headers.ETag));
        first.Request.Headers.IfNoneMatch = first.Response.Headers.ETag;
        Assert.Equal(304, Assert.IsType<StatusCodeResult>(await first.Get(default)).StatusCode);
        Assert.IsType<NoContentResult>(await second.Delete(default));
        Assert.True(File.Exists(fixture.PathFor(17)));
        Assert.IsType<NoContentResult>(await first.Delete(default));
        Assert.IsType<NoContentResult>(await first.Delete(default));
        Assert.IsType<NotFoundResult>(await first.Get(default));
    }

    [Fact]
    public async Task InvalidOversizedAndUnsupportedImagesAreRejectedWithoutWriting()
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(17);
        await Assert.ThrowsAsync<ArgumentException>(() => controller.Upload(FormFileFor([1, 2, 3], "photo.jpg"), default));
        var oversized = new FormFile(new MemoryStream([1]), 0, ProfileAvatarService.MaximumUploadBytes + 1,
            "file", "photo.png");
        await Assert.ThrowsAsync<ArgumentException>(() => controller.Upload(oversized, default));
        Assert.False(File.Exists(fixture.PathFor(17)));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => fixture.Storage.ReadAsync(0));
    }

    private static async Task<IFormFile> ImageFileAsync(Rgba32? color = null)
    {
        using var image = new Image<Rgba32>(900, 450, color ?? new Rgba32(255, 0, 0));
        var output = new MemoryStream();
        await image.SaveAsPngAsync(output);
        output.Position = 0;
        return new FormFile(output, 0, output.Length, "file", "photo.png");
    }

    private static IFormFile FormFileFor(byte[] bytes, string name) =>
        new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", name);

    private sealed class Fixture : IDisposable
    {
        private readonly string root = Path.Combine(Path.GetTempPath(), $"kooch-avatar-{Guid.NewGuid():N}");
        public FileSystemMediaStorage Media { get; }
        public FileSystemProfileAvatarStorage Storage { get; }
        public ProfileAvatarService Service { get; }

        public Fixture()
        {
            var content = Path.Combine(root, "application");
            var web = Path.Combine(content, "wwwroot");
            Directory.CreateDirectory(web);
            Media = new FileSystemMediaStorage(Options.Create(new MediaStorageOptions
            {
                RootPath = Path.Combine(root, "media"), PublicBasePath = "/uploads"
            }), new Environment(content, web));
            Storage = new FileSystemProfileAvatarStorage(Media);
            Service = new ProfileAvatarService(Storage);
        }

        public string PathFor(int id) => Path.Combine($"{Media.RootPath}-private", "avatars", $"{id}.webp");

        public AccountProfileAvatarController Controller(int userId)
        {
            var context = new DefaultHttpContext();
            context.User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Role, UserRole.Client.ToString())
            ], "test"));
            return new AccountProfileAvatarController(Service)
            {
                ControllerContext = new ControllerContext { HttpContext = context }
            };
        }

        public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    private sealed class Environment(string content, string web) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "Kooch.Api.Tests";
        public string EnvironmentName { get; set; } = "Testing";
        public string ContentRootPath { get; set; } = content;
        public IFileProvider ContentRootFileProvider { get; set; } = new PhysicalFileProvider(content);
        public string WebRootPath { get; set; } = web;
        public IFileProvider WebRootFileProvider { get; set; } = new PhysicalFileProvider(web);
    }
}
