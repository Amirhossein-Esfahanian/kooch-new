using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace Kooch.Api.Services.MediaStorage;

public static class MediaStorageApplicationBuilderExtensions
{
    private const string ImmutableCacheControl = "public,max-age=31536000,immutable";

    public static IApplicationBuilder UseMediaStorageStaticFiles(
        this IApplicationBuilder app,
        IMediaStorage mediaStorage)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(mediaStorage);

        var contentTypes = new FileExtensionContentTypeProvider(
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                [".svg"] = "image/svg+xml"
            });

        foreach (var assetNamespace in Enum.GetValues<MediaAssetNamespace>())
        {
            var namespaceSegment = FileSystemMediaStorage.GetNamespaceSegment(assetNamespace);
            var namespaceRoot = Path.Combine(mediaStorage.RootPath, namespaceSegment);
            var fileProvider = new PhysicalFileProvider(namespaceRoot);
            app.ApplicationServices.GetRequiredService<IHostApplicationLifetime>()
                .ApplicationStopped.Register(fileProvider.Dispose);

            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = fileProvider,
                RequestPath = $"{mediaStorage.PublicBasePath}/{namespaceSegment}",
                ContentTypeProvider = contentTypes,
                ServeUnknownFileTypes = false,
                OnPrepareResponse = context =>
                {
                    var fileName = Path.GetFileName(context.File.PhysicalPath ?? context.File.Name);
                    if (Path.GetExtension(fileName).Equals(".svg", StringComparison.OrdinalIgnoreCase) &&
                        Guid.TryParseExact(Path.GetFileNameWithoutExtension(fileName), "N", out _))
                    {
                        context.Context.Response.GetTypedHeaders().CacheControl =
                            CacheControlHeaderValue.Parse(ImmutableCacheControl);
                    }
                }
            });
        }

        // Keep /uploads authoritative to the configured provider; never fall through to wwwroot.
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments(mediaStorage.PublicBasePath))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            await next(context);
        });

        return app;
    }
}
