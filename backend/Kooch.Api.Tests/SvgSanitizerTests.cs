using System.Text;
using System.Xml.Linq;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SvgSanitizerTests
{
    private const string SvgNamespace = "http://www.w3.org/2000/svg";
    private readonly SvgSanitizer _sanitizer = new();

    [Fact]
    public async Task Sanitize_AcceptsAuditedGeometryAndPresentationAttributes()
    {
        const string input = """
            <?xml version="1.0" encoding="UTF-8"?>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24px" height="24"
                 fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.9">
              <!-- retained license -->
              <g fill="#212121" fill-opacity=".75" fill-rule="evenodd" clip-rule="nonzero">
                <path d="M1 2L3 4h5v6H1z" stroke="rgb(0, 128, 255)" stroke-opacity="1" />
              </g>
            </svg>
            """;

        var output = await SanitizeAsync(input);
        var document = XDocument.Parse(output);

        Assert.DoesNotContain("<?xml", output, StringComparison.Ordinal);
        Assert.Contains("<!-- retained license -->", output, StringComparison.Ordinal);
        Assert.Equal(XNamespace.Get(SvgNamespace) + "svg", document.Root!.Name);
        Assert.Equal("0 0 24 24", document.Root.Attribute("viewBox")?.Value);
        Assert.Single(document.Descendants(XNamespace.Get(SvgNamespace) + "path"));
    }

    [Fact]
    public async Task Sanitize_AcceptsInputAtExactByteLimit()
    {
        const string prefix = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0\"/>";
        const string suffix = "</svg>";
        var paddingLength = SvgSanitizer.MaximumInputBytes - Encoding.UTF8.GetByteCount(prefix + suffix);
        var input = prefix + new string(' ', paddingLength) + suffix;

        var output = await SanitizeAsync(input);

        Assert.Equal(SvgSanitizer.MaximumInputBytes, Encoding.UTF8.GetByteCount(input));
        Assert.Equal($"<svg xmlns=\"{SvgNamespace}\" viewBox=\"0 0 1 1\"><path d=\"M0 0\" /></svg>", output);
    }

    [Fact]
    public async Task Sanitize_RejectsEmptyInput()
    {
        await AssertFailureAsync(Array.Empty<byte>(), SvgSanitizationFailure.EmptyInput);
    }

    [Fact]
    public async Task Sanitize_RejectsInputOverByteLimit()
    {
        await AssertFailureAsync(
            new byte[SvgSanitizer.MaximumInputBytes + 1],
            SvgSanitizationFailure.TooLarge);
    }

    [Theory]
    [InlineData("<svg")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0\"></svg>")]
    [InlineData("not xml")]
    public async Task Sanitize_RejectsMalformedXml(string input)
    {
        await AssertFailureAsync(input, SvgSanitizationFailure.InvalidXml);
    }

    [Theory]
    [InlineData("<svg viewBox=\"0 0 1 1\" />")]
    [InlineData("<html xmlns=\"http://www.w3.org/1999/xhtml\"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\" /></html>")]
    [InlineData("<s:svg xmlns:s=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\" />")]
    public async Task Sanitize_RequiresSvgRootWithDefaultSvgNamespace(string input)
    {
        await AssertFailureAsync(input, SvgSanitizationFailure.UnsupportedStructure);
    }

    [Theory]
    [InlineData("script")]
    [InlineData("style")]
    [InlineData("foreignObject")]
    [InlineData("iframe")]
    [InlineData("object")]
    [InlineData("embed")]
    [InlineData("image")]
    [InlineData("audio")]
    [InlineData("video")]
    [InlineData("animate")]
    [InlineData("animateMotion")]
    [InlineData("animateTransform")]
    [InlineData("set")]
    public async Task Sanitize_RejectsActiveOrResourceElements(string elementName)
    {
        await AssertFailureAsync(
            Wrap($"<{elementName} />"),
            SvgSanitizationFailure.UnsafeContent);
    }

    [Theory]
    [InlineData("onload")]
    [InlineData("onLoad")]
    [InlineData("onclick")]
    [InlineData("onbegin")]
    [InlineData("onactivate")]
    [InlineData("onmouseover")]
    public async Task Sanitize_RejectsEventAttributesRegardlessOfCase(string attributeName)
    {
        await AssertFailureAsync(
            Wrap($"<path d=\"M0 0\" {attributeName} = \"alert(1)\" />"),
            SvgSanitizationFailure.UnsafeContent);
    }

    [Theory]
    [InlineData("href", "#local")]
    [InlineData("href", "javascript:alert(1)")]
    [InlineData("href", "data:image/svg+xml,abc")]
    [InlineData("href", "https://example.com/a.svg")]
    [InlineData("href", "http://example.com/a.svg")]
    [InlineData("href", "file:///tmp/a.svg")]
    [InlineData("href", "//example.com/a.svg")]
    [InlineData("fill", "url(#gradient)")]
    [InlineData("fill", "URL(https://example.com/a.svg)")]
    [InlineData("fill", "expression(alert(1))")]
    [InlineData("fill", "@import 'a.css'")]
    [InlineData("style", "fill: red")]
    public async Task Sanitize_RejectsReferencesAndCssPayloads(string attributeName, string value)
    {
        await AssertFailureAsync(
            Wrap($"<path d=\"M0 0\" {attributeName}=\"{value}\" />"),
            SvgSanitizationFailure.UnsafeContent);
    }

    [Fact]
    public async Task Sanitize_RejectsXlinkNamespaceAndReference()
    {
        var input = """
            <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1">
              <path d="M0 0" xlink:href="#local" />
            </svg>
            """;

        await AssertFailureAsync(input, SvgSanitizationFailure.UnsafeContent);
    }

    [Theory]
    [InlineData("class", "icon")]
    [InlineData("transform", "scale(2)")]
    [InlineData("id", "shape")]
    [InlineData("version", "1.1")]
    public async Task Sanitize_RejectsAttributesOutsideAuditedAllowlist(string attributeName, string value)
    {
        await AssertFailureAsync(
            $"<svg xmlns=\"{SvgNamespace}\" viewBox=\"0 0 1 1\" {attributeName}=\"{value}\"><path d=\"M0 0\" /></svg>",
            SvgSanitizationFailure.UnsupportedStructure);
    }

    [Theory]
    [InlineData("circle")]
    [InlineData("rect")]
    [InlineData("defs")]
    [InlineData("use")]
    [InlineData("text")]
    public async Task Sanitize_RejectsElementsOutsideAuditedAllowlist(string elementName)
    {
        await AssertFailureAsync(
            Wrap($"<{elementName} />"),
            SvgSanitizationFailure.UnsupportedStructure);
    }

    [Fact]
    public async Task Sanitize_RejectsForeignNamespaceElements()
    {
        var input = $"<svg xmlns=\"{SvgNamespace}\" xmlns:h=\"http://www.w3.org/1999/xhtml\" viewBox=\"0 0 1 1\"><h:script /></svg>";

        await AssertFailureAsync(input, SvgSanitizationFailure.UnsafeContent);
    }

    [Fact]
    public async Task Sanitize_RejectsChildNamespaceReset()
    {
        var input = $"<svg xmlns=\"{SvgNamespace}\" viewBox=\"0 0 1 1\"><g xmlns=\"\"><path d=\"M0 0\" /></g></svg>";

        await AssertFailureAsync(input, SvgSanitizationFailure.UnsafeContent);
    }

    [Fact]
    public async Task Sanitize_RejectsExternalEntityAndDoctype()
    {
        var input = """
            <?xml version="1.0"?>
            <!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" />&xxe;</svg>
            """;

        await AssertFailureAsync(input, SvgSanitizationFailure.InvalidXml);
    }

    [Fact]
    public async Task Sanitize_RejectsDoctypeWithoutEntityReferences()
    {
        var input = $"<!DOCTYPE svg><svg xmlns=\"{SvgNamespace}\" viewBox=\"0 0 1 1\"><path d=\"M0 0\" /></svg>";

        await AssertFailureAsync(input, SvgSanitizationFailure.InvalidXml);
    }

    [Fact]
    public async Task Sanitize_RejectsProcessingInstructions()
    {
        await AssertFailureAsync(
            Wrap("<?xml-stylesheet href=\"https://example.com/a.css\"?><path d=\"M0 0\" />"),
            SvgSanitizationFailure.UnsafeContent);
    }

    [Fact]
    public async Task Sanitize_RejectsTextContent()
    {
        await AssertFailureAsync(
            Wrap("<g>unsafe text</g>"),
            SvgSanitizationFailure.UnsupportedStructure);
    }

    [Fact]
    public async Task Sanitize_RejectsExcessiveElementDepth()
    {
        var content = "<path d=\"M0 0\" />";
        for (var index = 0; index < 32; index++)
        {
            content = $"<g>{content}</g>";
        }

        await AssertFailureAsync(Wrap(content), SvgSanitizationFailure.UnsupportedStructure);
    }

    [Fact]
    public async Task Sanitize_HonorsCancellation()
    {
        await using var stream = CreateStream(Wrap("<path d=\"M0 0\" />"));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _sanitizer.SanitizeAsync(stream, cancellation.Token));
    }

    [Fact]
    public async Task CurrentRepositoryIcons_AllSanitizeSuccessfully()
    {
        var svgRoot = FindRepositorySvgRoot();
        var files = Directory.GetFiles(svgRoot, "*.svg", SearchOption.AllDirectories);

        Assert.Equal(11, files.Length);
        foreach (var file in files)
        {
            await using var stream = File.OpenRead(file);
            var output = await _sanitizer.SanitizeAsync(stream);
            Assert.Equal(XNamespace.Get(SvgNamespace) + "svg", XDocument.Parse(output).Root!.Name);
        }
    }

    [Theory]
    [InlineData("amenities", "wifi.svg")]
    [InlineData("amenity-categories", "base-services.svg")]
    public async Task NormalizedLegacySourceIcon_SanitizesSuccessfully(
        string directory,
        string fileName)
    {
        var file = Path.Combine(FindRepositorySvgRoot(), directory, fileName);
        await using var stream = File.OpenRead(file);

        var output = await _sanitizer.SanitizeAsync(stream);

        Assert.Equal(XNamespace.Get(SvgNamespace) + "svg", XDocument.Parse(output).Root!.Name);
    }

    [Fact]
    public async Task SanitizedOutput_CanBeStoredByMediaStorage()
    {
        using var temp = new TemporaryDirectory();
        var environment = CreateEnvironment(temp.Path);
        var storage = new FileSystemMediaStorage(
            Options.Create(new MediaStorageOptions
            {
                RootPath = "../../media-root",
                PublicBasePath = "/uploads"
            }),
            environment);
        var sanitized = await SanitizeAsync(Wrap("<path d=\"M0 0h1v1H0z\" fill=\"#123456\" />"));
        await using var content = CreateStream(sanitized);

        var asset = await storage.StoreSanitizedSvgAsync(MediaAssetNamespace.Amenities, 17, content);
        var relativePath = asset.PublicPath[(storage.PublicBasePath.Length + 1)..]
            .Replace('/', Path.DirectorySeparatorChar);
        var storedPath = Path.GetFullPath(Path.Combine(storage.RootPath, relativePath));
        var storedOutput = await File.ReadAllTextAsync(storedPath);

        Assert.True(File.Exists(storedPath));
        Assert.Equal(sanitized, storedOutput);
        Assert.Equal(XNamespace.Get(SvgNamespace) + "svg", XDocument.Parse(storedOutput).Root!.Name);
        Assert.Matches("^/uploads/amenities/17/[0-9a-f]{32}\\.svg$", asset.PublicPath);
    }

    private async Task<string> SanitizeAsync(string input)
    {
        await using var stream = CreateStream(input);
        return await _sanitizer.SanitizeAsync(stream);
    }

    private async Task AssertFailureAsync(string input, SvgSanitizationFailure failure) =>
        await AssertFailureAsync(Encoding.UTF8.GetBytes(input), failure);

    private async Task AssertFailureAsync(byte[] input, SvgSanitizationFailure failure)
    {
        await using var stream = new MemoryStream(input);
        var exception = await Assert.ThrowsAsync<SvgSanitizationException>(() =>
            _sanitizer.SanitizeAsync(stream));

        Assert.Equal(failure, exception.Failure);
        Assert.False(string.IsNullOrWhiteSpace(exception.Message));
    }

    private static string Wrap(string content) =>
        $"<svg xmlns=\"{SvgNamespace}\" viewBox=\"0 0 1 1\">{content}</svg>";

    private static MemoryStream CreateStream(string content) =>
        new(Encoding.UTF8.GetBytes(content));

    private static string FindRepositorySvgRoot()
    {
        var fixtureRoot = Path.Combine(AppContext.BaseDirectory, "SvgCompatibilityFixtures");
        if (Directory.Exists(fixtureRoot))
        {
            return fixtureRoot;
        }

        throw new DirectoryNotFoundException("Could not find the copied repository SVG fixtures.");
    }

    private static IWebHostEnvironment CreateEnvironment(string tempRoot)
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
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"kooch-svg-sanitizer-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
