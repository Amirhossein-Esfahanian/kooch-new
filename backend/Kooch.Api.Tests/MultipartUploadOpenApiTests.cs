using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Filters;
using Kooch.Api.Services.ProfileAvatar;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi.Models;
using Microsoft.OpenApi.Writers;
using Swashbuckle.AspNetCore.Swagger;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class MultipartUploadOpenApiTests
{
    public static TheoryData<Type, string, string, OperationType> Uploads => new()
    {
        { typeof(AccountProfileAvatarController), "Upload", "/api/account/profile/avatar", OperationType.Put },
        { typeof(AdminSiteSettingsController), "Upload", "/api/admin/site-settings/upload", OperationType.Post },
        { typeof(AmenitiesController), "StageSvg", "/api/amenities/svg/stage", OperationType.Post },
        { typeof(AmenityCategoriesController), "StageSvg", "/api/amenity-categories/svg/stage", OperationType.Post },
        { typeof(BedTypesController), "StageSvg", "/api/bed-types/svg/stage", OperationType.Post }
    };

    [Fact]
    public async Task EntireApi_OpenApiDocumentGeneratesAndSerializesWithoutStartingApplication()
    {
        await using var app = CreateMetadataHost();
        var document = app.Services.GetRequiredService<ISwaggerProvider>().GetSwagger("v1");
        using var output = new StringWriter();
        document.SerializeAsV3(new OpenApiJsonWriter(output));
        using var json = JsonDocument.Parse(output.ToString());
        Assert.StartsWith("3.", json.RootElement.GetProperty("openapi").GetString());
        Assert.NotEmpty(document.Paths);
        foreach (var upload in Uploads)
        {
            var path = (string)upload[2];
            Assert.True(json.RootElement.GetProperty("paths").TryGetProperty(path, out _));
        }
    }

    [Theory]
    [MemberData(nameof(Uploads))]
    public async Task UploadOperation_PreservesMultipartFileNameAndBinding(
        Type controller, string action, string path, OperationType verb)
    {
        await using var app = CreateMetadataHost();
        var document = app.Services.GetRequiredService<ISwaggerProvider>().GetSwagger("v1");
        var operation = document.Paths[path].Operations[verb];
        var content = Assert.Single(operation.RequestBody.Content);
        Assert.Equal("multipart/form-data", content.Key);
        var schema = content.Value.Schema;
        if (schema.Reference is not null) schema = document.Components.Schemas[schema.Reference.Id];
        var file = schema.Properties["file"];
        Assert.Equal("string", file.Type);
        Assert.Equal("binary", file.Format);
        Assert.Equal(controller == typeof(AdminSiteSettingsController) ? new[] { "file", "key" } : new[] { "file" },
            schema.Properties.Keys.Order().ToArray());

        var description = Assert.Single(app.Services.GetRequiredService<IApiDescriptionGroupCollectionProvider>()
            .ApiDescriptionGroups.Items.SelectMany(group => group.Items),
            item => item.RelativePath == path.TrimStart('/') && item.HttpMethod == verb.ToString().ToUpperInvariant());
        Assert.Equal(BindingSource.FormFile, Assert.Single(description.ParameterDescriptions, item => item.Name == "file").Source);
        Assert.Equal("multipart/form-data", Assert.Single(description.SupportedRequestFormats).MediaType);

        var method = controller.GetMethod(action)!;
        Assert.Equal(typeof(IFormFile), method.GetParameters()[0].ParameterType);
        Assert.Equal("file", method.GetParameters()[0].Name);
        Assert.Equal(typeof(CancellationToken), method.GetParameters()[^1].ParameterType);
        var authorization = controller.GetCustomAttributes<AuthorizeAttribute>()
            .Concat(method.GetCustomAttributes<AuthorizeAttribute>()).ToArray();
        var attribute = Assert.Single(authorization);
        Assert.Equal(controller == typeof(AccountProfileAvatarController) ? null : AuthorizationPolicies.AdminUsers, attribute.Policy);
        Assert.Empty(controller.GetCustomAttributes<AllowAnonymousAttribute>());
        Assert.Empty(method.GetCustomAttributes<AllowAnonymousAttribute>());

        if (controller == typeof(AdminSiteSettingsController))
        {
            var key = method.GetParameters()[1];
            Assert.Equal("key", key.Name);
            Assert.Equal(typeof(string), key.ParameterType);
            Assert.NotNull(key.GetCustomAttribute<FromFormAttribute>());
            Assert.Equal(BindingSource.Form, Assert.Single(description.ParameterDescriptions, item => item.Name == "key").Source);
        }
        if (controller == typeof(AccountProfileAvatarController))
            Assert.Equal((long)ProfileAvatarService.MaximumUploadBytes + 1024 * 1024,
                (long)Assert.Single(method.CustomAttributes, attribute => attribute.AttributeType == typeof(RequestSizeLimitAttribute))
                    .ConstructorArguments.Single().Value!);
    }

    [Fact]
    public void DirectFileParameters_NeverOverrideInferredFormFileBinding()
    {
        var files = typeof(AccountProfileAvatarController).Assembly.GetTypes()
            .Where(type => typeof(ControllerBase).IsAssignableFrom(type))
            .SelectMany(type => type.GetMethods()).SelectMany(method => method.GetParameters())
            .Where(parameter => parameter.ParameterType == typeof(IFormFile) ||
                                parameter.ParameterType == typeof(IFormFileCollection)).ToArray();
        Assert.NotEmpty(files);
        Assert.All(files, parameter => Assert.Null(parameter.GetCustomAttribute<FromFormAttribute>()));
    }

    private static WebApplication CreateMetadataHost()
    {
        // Discover real controller metadata only: never execute Program, register business
        // services, connect to SQL Server, or start a listener/background service.
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Testing",
            ApplicationName = typeof(AccountProfileAvatarController).Assembly.GetName().Name
        });
        builder.Services.AddControllers(options => options.Filters.Add<ApiExceptionFilter>())
            .AddApplicationPart(typeof(AccountProfileAvatarController).Assembly)
            .AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen(options => options.SwaggerDoc("v1", new OpenApiInfo { Title = "Kooch API", Version = "v1" }));
        return builder.Build();
    }
}
