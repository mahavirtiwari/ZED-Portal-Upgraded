using SkiaSharp;

namespace Zed.Core.Mobile;

/// <summary>
/// The image work behind evidence uploads, shared by the MSME app's server and the portal's web data entry: the evidence
/// PDF built from photos (old PdfHelper.GenerateReport) and a photo stored as the app stores it (JPEG, longest side 1080 px).
/// </summary>
public static class EvidenceImages
{
    /// <summary>The app's photo size (PhotoCaptureHelper scales to 1080 px).</summary>
    public const int PhotoMaxSide = 1080;

    /// <summary>One A4 page per image, scaled to fit inside 10 pt margins, centred at the top. Null when one is not an image.</summary>
    public static byte[]? ImagesToPdf(IReadOnlyList<byte[]> images)
    {
        const float pageW = 595f, pageH = 842f, margin = 10f;
        var decoded = new List<SKImage>();
        try
        {
            foreach (var bytes in images)
            {
                using var data = SKData.CreateCopy(bytes);
                var image = SKImage.FromEncodedData(data);
                if (image is null) return null;
                decoded.Add(image);
            }

            using var output = new MemoryStream();
            using (var doc = SKDocument.CreatePdf(output))
            {
                foreach (var image in decoded)
                {
                    var canvas = doc.BeginPage(pageW, pageH);
                    var scale = Math.Min((pageW - 2 * margin) / image.Width, (pageH - 3 * margin) / image.Height);
                    var w = image.Width * scale;
                    var h = image.Height * scale;
                    canvas.DrawImage(image, SKRect.Create((pageW - w) / 2, 2 * margin, w, h), new SKSamplingOptions(SKFilterMode.Linear));
                    doc.EndPage();
                }
                if (decoded.Count == 0)
                {
                    doc.BeginPage(pageW, pageH);
                    doc.EndPage();
                }
                doc.Close();
            }
            return output.ToArray();
        }
        finally
        {
            foreach (var i in decoded) i.Dispose();
        }
    }

    /// <summary>
    /// A JPEG or PNG upload as the app stores a photo: JPEG, turned upright, longest side at most
    /// <see cref="PhotoMaxSide"/>. Null when the bytes are not an image.
    /// </summary>
    public static byte[]? ToAppJpeg(byte[] bytes, int quality = 90)
    {
        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data);
        if (codec is null) return null;
        using var decoded = SKBitmap.Decode(codec);
        if (decoded is null) return null;

        using var upright = Orient(decoded, codec.EncodedOrigin);
        var bitmap = upright ?? decoded;
        var scale = Math.Min(1f, (float)PhotoMaxSide / Math.Max(bitmap.Width, bitmap.Height));
        using var resized = scale < 1f
            ? bitmap.Resize(new SKImageInfo(Math.Max(1, (int)(bitmap.Width * scale)), Math.Max(1, (int)(bitmap.Height * scale))),
                new SKSamplingOptions(SKFilterMode.Linear))
            : null;
        using var image = SKImage.FromBitmap(resized ?? bitmap);
        using var jpeg = image.Encode(SKEncodedImageFormat.Jpeg, quality);
        return jpeg?.ToArray();
    }

    /// <summary>
    /// The bitmap turned as its EXIF orientation says (the rotations phone cameras write), or null when it is already upright
    /// or the orientation is a mirrored one.
    /// </summary>
    private static SKBitmap? Orient(SKBitmap source, SKEncodedOrigin origin)
    {
        var degrees = origin switch
        {
            SKEncodedOrigin.BottomRight => 180,
            SKEncodedOrigin.RightTop => 90,
            SKEncodedOrigin.LeftBottom => 270,
            _ => 0,
        };
        if (degrees == 0) return null;
        var result = degrees == 180 ? new SKBitmap(source.Width, source.Height) : new SKBitmap(source.Height, source.Width);
        using var canvas = new SKCanvas(result);
        canvas.Translate(result.Width / 2f, result.Height / 2f);
        canvas.RotateDegrees(degrees);
        canvas.Translate(-source.Width / 2f, -source.Height / 2f);
        canvas.DrawBitmap(source, 0, 0);
        return result;
    }
}
