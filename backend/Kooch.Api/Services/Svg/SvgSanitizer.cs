using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace Kooch.Api.Services.Svg;

public sealed partial class SvgSanitizer : ISvgSanitizer
{
    public const int MaximumInputBytes = 256 * 1024;
    private const int MaximumElementDepth = 32;
    private const int MaximumElementCount = 2048;
    private const double MaximumDimension = 100_000;
    private const double MaximumViewBoxCoordinate = 10_000_000;
    private const string SvgNamespaceName = "http://www.w3.org/2000/svg";

    private static readonly XNamespace SvgNamespace = SvgNamespaceName;
    private static readonly HashSet<string> AllowedElements = new(StringComparer.Ordinal)
    {
        "svg",
        "g",
        "path"
    };

    private static readonly HashSet<string> UnsafeElements = new(StringComparer.OrdinalIgnoreCase)
    {
        "script",
        "style",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "image",
        "audio",
        "video",
        "animate",
        "animateMotion",
        "animateTransform",
        "set"
    };

    private static readonly HashSet<string> RootAttributes = new(StringComparer.Ordinal)
    {
        "viewBox",
        "width",
        "height",
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-opacity",
        "opacity",
        "clip-rule"
    };

    private static readonly HashSet<string> GroupAttributes = new(StringComparer.Ordinal)
    {
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-opacity",
        "opacity",
        "clip-rule"
    };

    private static readonly HashSet<string> PathAttributes = new(GroupAttributes, StringComparer.Ordinal)
    {
        "d"
    };

    private static readonly HashSet<string> PaintAttributes = new(StringComparer.Ordinal)
    {
        "fill",
        "stroke"
    };

    private static readonly HashSet<string> OpacityAttributes = new(StringComparer.Ordinal)
    {
        "fill-opacity",
        "stroke-opacity",
        "opacity"
    };

    public async Task<string> SanitizeAsync(
        Stream input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!input.CanRead)
        {
            throw new ArgumentException("The SVG input stream must be readable.", nameof(input));
        }

        var content = await ReadBoundedAsync(input, cancellationToken);
        if (content.Length == 0)
        {
            throw Failure(SvgSanitizationFailure.EmptyInput, "SVG file is empty.");
        }

        XDocument document;
        try
        {
            await using var bufferedInput = new MemoryStream(content, writable: false);
            using var reader = XmlReader.Create(bufferedInput, new XmlReaderSettings
            {
                Async = true,
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                MaxCharactersInDocument = MaximumInputBytes,
                IgnoreComments = false,
                IgnoreProcessingInstructions = false,
                IgnoreWhitespace = false
            });
            document = await XDocument.LoadAsync(reader, LoadOptions.None, cancellationToken);
        }
        catch (XmlException exception)
        {
            throw Failure(
                SvgSanitizationFailure.InvalidXml,
                "SVG file is not valid XML.",
                exception);
        }

        var root = document.Root;
        if (root is null)
        {
            throw Failure(SvgSanitizationFailure.InvalidXml, "SVG file has no document element.");
        }

        if (root.Name != SvgNamespace + "svg" || root.GetDefaultNamespace() != SvgNamespace)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "The document root must be an SVG element in the SVG namespace.");
        }

        if (document.Nodes().Any(node => node is XDocumentType or XProcessingInstruction))
        {
            throw Failure(
                SvgSanitizationFailure.UnsafeContent,
                "SVG file contains a prohibited document-level construct.");
        }

        var elementCount = 0;
        var sanitizedRoot = SanitizeElement(root, depth: 1, ref elementCount);
        return sanitizedRoot.ToString(SaveOptions.DisableFormatting);
    }

    private static XElement SanitizeElement(XElement source, int depth, ref int elementCount)
    {
        if (depth > MaximumElementDepth)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "SVG element nesting is too deep.");
        }

        elementCount++;
        if (elementCount > MaximumElementCount)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "SVG contains too many elements.");
        }

        if (source.Name.Namespace != SvgNamespace)
        {
            throw Failure(
                SvgSanitizationFailure.UnsafeContent,
                "SVG contains an element from an unsupported namespace.");
        }

        var elementName = source.Name.LocalName;
        if (!AllowedElements.Contains(elementName))
        {
            var failure = UnsafeElements.Contains(elementName)
                ? SvgSanitizationFailure.UnsafeContent
                : SvgSanitizationFailure.UnsupportedStructure;
            throw Failure(failure, $"SVG element '{elementName}' is not allowed.");
        }

        var sanitized = new XElement(SvgNamespace + elementName);
        if (depth == 1)
        {
            sanitized.Add(new XAttribute("xmlns", SvgNamespaceName));
        }

        var allowedAttributes = elementName switch
        {
            "svg" => RootAttributes,
            "g" => GroupAttributes,
            "path" => PathAttributes,
            _ => throw new UnreachableException()
        };

        var hasDefaultSvgNamespace = false;
        foreach (var attribute in source.Attributes())
        {
            if (attribute.IsNamespaceDeclaration)
            {
                if (depth == 1 &&
                    attribute.Name.LocalName == "xmlns" &&
                    attribute.Value == SvgNamespaceName)
                {
                    hasDefaultSvgNamespace = true;
                    continue;
                }

                throw Failure(
                    SvgSanitizationFailure.UnsafeContent,
                    "SVG contains an unsupported namespace declaration.");
            }

            var attributeName = attribute.Name.LocalName;
            if (attributeName.StartsWith("on", StringComparison.OrdinalIgnoreCase))
            {
                throw Failure(
                    SvgSanitizationFailure.UnsafeContent,
                    "SVG event-handler attributes are not allowed.");
            }

            if (attribute.Name.Namespace != XNamespace.None)
            {
                throw Failure(
                    SvgSanitizationFailure.UnsafeContent,
                    "SVG contains an attribute from an unsupported namespace.");
            }

            var value = attribute.Value.Trim();
            RejectUnsafeReferenceOrCss(attributeName, value);
            if (!allowedAttributes.Contains(attributeName))
            {
                throw Failure(
                    SvgSanitizationFailure.UnsupportedStructure,
                    $"SVG attribute '{attributeName}' is not supported on '{elementName}'.");
            }

            ValidateAttributeValue(attributeName, value);
            sanitized.Add(new XAttribute(attributeName, value));
        }

        if (depth == 1 && !hasDefaultSvgNamespace)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "SVG root must declare the default SVG namespace.");
        }

        if (elementName == "svg" && source.Attribute("viewBox") is null)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "SVG root must define a viewBox.");
        }

        if (elementName == "path" && source.Attribute("d") is null)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "SVG path must define path data.");
        }

        foreach (var node in source.Nodes())
        {
            switch (node)
            {
                case XElement child:
                    sanitized.Add(SanitizeElement(child, depth + 1, ref elementCount));
                    break;
                case XComment comment:
                    // Preserve source-license comments; they are inert XML content.
                    sanitized.Add(new XComment(comment.Value));
                    break;
                case XText text when string.IsNullOrWhiteSpace(text.Value):
                    break;
                case XProcessingInstruction:
                    throw Failure(
                        SvgSanitizationFailure.UnsafeContent,
                        "SVG processing instructions are not allowed.");
                default:
                    throw Failure(
                        SvgSanitizationFailure.UnsupportedStructure,
                        "SVG text and non-geometric content are not supported.");
            }
        }

        return sanitized;
    }

    private static void RejectUnsafeReferenceOrCss(string attributeName, string value)
    {
        if (attributeName.Equals("style", StringComparison.OrdinalIgnoreCase) ||
            attributeName.Equals("href", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("url(", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("@import", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("javascript:", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("data:", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("file:", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("http:", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("https:", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("expression(", StringComparison.OrdinalIgnoreCase) ||
            value.StartsWith("//", StringComparison.Ordinal))
        {
            throw Failure(
                SvgSanitizationFailure.UnsafeContent,
                "SVG styles and resource references are not allowed.");
        }
    }

    private static void ValidateAttributeValue(string attributeName, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                $"SVG attribute '{attributeName}' cannot be empty.");
        }

        if (PaintAttributes.Contains(attributeName))
        {
            ValidatePaint(value);
            return;
        }

        if (OpacityAttributes.Contains(attributeName))
        {
            ValidateNumberInRange(value, 0, 1, attributeName);
            return;
        }

        switch (attributeName)
        {
            case "viewBox":
                ValidateViewBox(value);
                break;
            case "width":
            case "height":
                ValidateDimension(value, attributeName);
                break;
            case "stroke-width":
                ValidateNumberInRange(value, 0, MaximumDimension, attributeName);
                break;
            case "fill-rule":
            case "clip-rule":
                if (value is not ("nonzero" or "evenodd"))
                {
                    throw Failure(
                        SvgSanitizationFailure.UnsupportedStructure,
                        $"SVG attribute '{attributeName}' has an unsupported value.");
                }
                break;
            case "d":
                if (!PathDataPattern().IsMatch(value))
                {
                    throw Failure(
                        SvgSanitizationFailure.UnsupportedStructure,
                        "SVG path data contains unsupported characters.");
                }
                break;
        }
    }

    private static void ValidatePaint(string value)
    {
        if (value.Equals("none", StringComparison.OrdinalIgnoreCase) ||
            value.Equals("currentColor", StringComparison.OrdinalIgnoreCase) ||
            value.Equals("transparent", StringComparison.OrdinalIgnoreCase) ||
            HexColorPattern().IsMatch(value) ||
            IsValidRgbFunction(value))
        {
            return;
        }

        throw Failure(
            SvgSanitizationFailure.UnsupportedStructure,
            "SVG paint value is not supported.");
    }

    private static bool IsValidRgbFunction(string value)
    {
        var isRgba = value.StartsWith("rgba(", StringComparison.OrdinalIgnoreCase);
        if (!isRgba && !value.StartsWith("rgb(", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!value.EndsWith(')'))
        {
            return false;
        }

        var start = value.IndexOf('(') + 1;
        var parts = value[start..^1].Split(',', StringSplitOptions.TrimEntries);
        if (parts.Length != (isRgba ? 4 : 3))
        {
            return false;
        }

        for (var index = 0; index < 3; index++)
        {
            var part = parts[index];
            if (part.EndsWith('%'))
            {
                if (!TryParseFinite(part[..^1], out var percent) || percent is < 0 or > 100)
                {
                    return false;
                }
            }
            else if (!TryParseFinite(part, out var channel) || channel is < 0 or > 255)
            {
                return false;
            }
        }

        return !isRgba ||
               (TryParseFinite(parts[3], out var alpha) && alpha is >= 0 and <= 1);
    }

    private static void ValidateViewBox(string value)
    {
        var parts = value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 4 || parts.Any(part => !TryParseFinite(part, out _)))
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "SVG viewBox must contain four finite numbers.");
        }

        var numbers = parts.Select(part => double.Parse(part, CultureInfo.InvariantCulture)).ToArray();
        if (numbers.Any(number => Math.Abs(number) > MaximumViewBoxCoordinate) ||
            numbers[2] <= 0 ||
            numbers[3] <= 0)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                "SVG viewBox dimensions are outside the supported range.");
        }
    }

    private static void ValidateDimension(string value, string attributeName)
    {
        var numericValue = value.EndsWith("px", StringComparison.OrdinalIgnoreCase)
            ? value[..^2]
            : value;
        ValidateNumberInRange(numericValue, double.Epsilon, MaximumDimension, attributeName);
    }

    private static void ValidateNumberInRange(
        string value,
        double minimum,
        double maximum,
        string attributeName)
    {
        if (!TryParseFinite(value, out var number) || number < minimum || number > maximum)
        {
            throw Failure(
                SvgSanitizationFailure.UnsupportedStructure,
                $"SVG attribute '{attributeName}' is outside the supported range.");
        }
    }

    private static bool TryParseFinite(string value, out double number)
    {
        number = 0;
        return NumberPattern().IsMatch(value) &&
               double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out number) &&
               double.IsFinite(number);
    }

    private static async Task<byte[]> ReadBoundedAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        await using var buffer = new MemoryStream(capacity: MaximumInputBytes);
        var chunk = new byte[81920];
        while (true)
        {
            var read = await input.ReadAsync(chunk.AsMemory(), cancellationToken);
            if (read == 0)
            {
                return buffer.ToArray();
            }

            if (buffer.Length + read > MaximumInputBytes)
            {
                throw Failure(
                    SvgSanitizationFailure.TooLarge,
                    "SVG file must be 256KB or smaller.");
            }

            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }
    }

    private static SvgSanitizationException Failure(
        SvgSanitizationFailure failure,
        string message,
        Exception? innerException = null) =>
        new(failure, message, innerException);

    [GeneratedRegex(@"^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex PathDataPattern();

    [GeneratedRegex(@"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$", RegexOptions.CultureInvariant)]
    private static partial Regex HexColorPattern();

    [GeneratedRegex(@"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$", RegexOptions.CultureInvariant)]
    private static partial Regex NumberPattern();
}
