using System.Buffers.Binary;
using System.Collections.Concurrent;
using SkiaSharp;

namespace Zed.Core.Documents;

/// <summary>
/// TrueType (glyf) font subsetting for PDFs drawn with SkiaSharp. The SkiaSharp build in use embeds whole
/// system fonts (Arial is about 550 KB per style in a PDF); a subset with only the characters a document
/// uses is a few KB. Glyphs are renumbered; cmap (format 4), hmtx, loca, maxp, hhea and post (format 3)
/// are rebuilt; hinting tables are kept; layout tables (GSUB/GPOS/kern...) are dropped, as Skia's
/// DrawText does not shape text anyway. Fonts that are not single TrueType files (CFF/OTF, collections)
/// are returned unchanged.
/// </summary>
public static class FontSubsetter
{
    private static readonly string[] KeepTables = ["OS/2", "cmap", "cvt ", "fpgm", "gasp", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post", "prep"];
    private static readonly ConcurrentDictionary<(string Family, int Weight, int Slant), byte[]?> FontFiles = new();

    /// <summary>Printable ASCII plus the punctuation the portal's fixed texts use.</summary>
    public const string BasicCharacters =
        " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ ‘’“”•–—…₹";

    /// <summary>
    /// A typeface containing only <paramref name="characters"/> (plus <see cref="BasicCharacters"/>), or the
    /// original typeface when it cannot be subset. The caller disposes the result if it is not the original.
    /// </summary>
    public static SKTypeface Subset(SKTypeface typeface, IEnumerable<char> characters)
    {
        var key = (typeface.FamilyName, typeface.FontWeight, (int)typeface.FontSlant);
        var file = FontFiles.GetOrAdd(key, _ => ReadFontFile(typeface));
        if (file is null) return typeface;
        var subset = SubsetTrueType(file, characters.Concat(BasicCharacters));
        if (subset is null) return typeface;
        using var data = SKData.CreateCopy(subset);
        return SKTypeface.FromData(data) ?? typeface;
    }

    private static byte[]? ReadFontFile(SKTypeface typeface)
    {
        using var stream = typeface.OpenStream(out var index);
        if (stream is null || index != 0 || !stream.HasLength) return null;
        var bytes = new byte[stream.Length];
        return stream.Read(bytes, bytes.Length) == bytes.Length ? bytes : null;
    }

    /// <summary>The subset font file, or null when the font is not a plain TrueType file.</summary>
    public static byte[]? SubsetTrueType(byte[] font, IEnumerable<char> characters)
    {
        try
        {
            return Build(font, characters);
        }
        catch (Exception e) when (e is IndexOutOfRangeException or ArgumentOutOfRangeException or InvalidDataException)
        {
            return null;
        }
    }

    private static byte[]? Build(byte[] font, IEnumerable<char> characters)
    {
        var span = font.AsSpan();
        var version = BinaryPrimitives.ReadUInt32BigEndian(span);
        if (version != 0x00010000 && version != 0x74727565) return null; // 'true'; not 'OTTO' (CFF) or 'ttcf'
        var tables = new Dictionary<string, (int Offset, int Length)>();
        int numTables = BinaryPrimitives.ReadUInt16BigEndian(span[4..]);
        for (var i = 0; i < numTables; i++)
        {
            var rec = span.Slice(12 + 16 * i, 16);
            var tag = System.Text.Encoding.ASCII.GetString(rec[..4]);
            tables[tag] = ((int)BinaryPrimitives.ReadUInt32BigEndian(rec[8..]), (int)BinaryPrimitives.ReadUInt32BigEndian(rec[12..]));
        }
        foreach (var t in new[] { "head", "hhea", "hmtx", "maxp", "cmap", "loca", "glyf" })
            if (!tables.ContainsKey(t)) return null;

        byte[] Table(string tag) => font.AsSpan(tables[tag].Offset, tables[tag].Length).ToArray();
        var head = Table("head");
        var hhea = Table("hhea");
        var maxp = Table("maxp");
        var hmtx = Table("hmtx");
        var glyf = Table("glyf");
        var loca = Table("loca");
        var longLoca = BinaryPrimitives.ReadInt16BigEndian(head.AsSpan(50)) == 1;
        int numGlyphs = BinaryPrimitives.ReadUInt16BigEndian(maxp.AsSpan(4));
        int numHMetrics = BinaryPrimitives.ReadUInt16BigEndian(hhea.AsSpan(34));

        (int Start, int End) GlyphRange(int g)
        {
            if (longLoca)
                return ((int)BinaryPrimitives.ReadUInt32BigEndian(loca.AsSpan(4 * g)), (int)BinaryPrimitives.ReadUInt32BigEndian(loca.AsSpan(4 * g + 4)));
            return (BinaryPrimitives.ReadUInt16BigEndian(loca.AsSpan(2 * g)) * 2, BinaryPrimitives.ReadUInt16BigEndian(loca.AsSpan(2 * g + 2)) * 2);
        }

        // Characters → old glyph ids, through the font's own cmap.
        var cmap = ReadCmap(Table("cmap"));
        if (cmap is null) return null;
        var charToOld = new SortedDictionary<int, int>();
        foreach (var c in characters.Distinct())
            if (cmap.TryGetValue(c, out var g) && g > 0 && g < numGlyphs) charToOld[c] = g;

        // Glyph closure (composite glyphs reference components).
        var keep = new SortedSet<int> { 0 };
        var pending = new Stack<int>(charToOld.Values);
        while (pending.Count > 0)
        {
            var g = pending.Pop();
            if (!keep.Add(g) && g != 0) continue;
            foreach (var component in Components(glyf, GlyphRange(g))) if (!keep.Contains(component)) pending.Push(component);
        }
        var oldToNew = new Dictionary<int, int>();
        var order = keep.ToList();
        for (var i = 0; i < order.Count; i++) oldToNew[order[i]] = i;

        // glyf + loca (long), with component ids renumbered.
        using var newGlyf = new MemoryStream();
        var newLoca = new byte[4 * (order.Count + 1)];
        for (var i = 0; i < order.Count; i++)
        {
            BinaryPrimitives.WriteUInt32BigEndian(newLoca.AsSpan(4 * i), (uint)newGlyf.Length);
            var (start, end) = GlyphRange(order[i]);
            if (end > start)
            {
                var data = glyf.AsSpan(start, end - start).ToArray();
                RenumberComponents(data, oldToNew);
                newGlyf.Write(data);
                while (newGlyf.Length % 4 != 0) newGlyf.WriteByte(0);
            }
        }
        BinaryPrimitives.WriteUInt32BigEndian(newLoca.AsSpan(4 * order.Count), (uint)newGlyf.Length);

        // hmtx: one long metric per glyph.
        var newHmtx = new byte[4 * order.Count];
        for (var i = 0; i < order.Count; i++)
        {
            var g = order[i];
            var advance = BinaryPrimitives.ReadUInt16BigEndian(hmtx.AsSpan(4 * Math.Min(g, numHMetrics - 1)));
            var lsb = g < numHMetrics
                ? BinaryPrimitives.ReadInt16BigEndian(hmtx.AsSpan(4 * g + 2))
                : BinaryPrimitives.ReadInt16BigEndian(hmtx.AsSpan(4 * numHMetrics + 2 * (g - numHMetrics)));
            BinaryPrimitives.WriteUInt16BigEndian(newHmtx.AsSpan(4 * i), advance);
            BinaryPrimitives.WriteInt16BigEndian(newHmtx.AsSpan(4 * i + 2), lsb);
        }
        BinaryPrimitives.WriteUInt16BigEndian(hhea.AsSpan(34), (ushort)order.Count);
        BinaryPrimitives.WriteUInt16BigEndian(maxp.AsSpan(4), (ushort)order.Count);
        BinaryPrimitives.WriteInt16BigEndian(head.AsSpan(50), 1);
        BinaryPrimitives.WriteUInt32BigEndian(head.AsSpan(8), 0); // checkSumAdjustment, set below

        // post format 3 (no glyph names).
        var post = tables.ContainsKey("post") ? Table("post").AsSpan(0, 32).ToArray() : new byte[32];
        BinaryPrimitives.WriteUInt32BigEndian(post, 0x00030000);

        var output = new SortedDictionary<string, byte[]>(StringComparer.Ordinal)
        {
            ["head"] = head, ["hhea"] = hhea, ["maxp"] = maxp, ["hmtx"] = newHmtx, ["loca"] = newLoca,
            ["glyf"] = newGlyf.ToArray(), ["post"] = post,
            ["cmap"] = WriteCmap(charToOld.Select(kv => (kv.Key, oldToNew[kv.Value]))),
        };
        if (tables.ContainsKey("name") && TrimNames(Table("name")) is { } names) output["name"] = names;
        foreach (var tag in KeepTables)
            if (!output.ContainsKey(tag) && tables.ContainsKey(tag)) output[tag] = Table(tag);

        var result = Assemble(output);
        var adjustment = 0xB1B0AFBA - Checksum(result);
        BinaryPrimitives.WriteUInt32BigEndian(result.AsSpan(HeadOffset(result) + 8), adjustment);
        return result;
    }

    /// <summary>name table with only the Windows English family/style/full/PostScript names (ids 1-6); licence texts dropped.</summary>
    private static byte[]? TrimNames(byte[] name)
    {
        var s = name.AsSpan();
        int count = BinaryPrimitives.ReadUInt16BigEndian(s[2..]);
        int storage = BinaryPrimitives.ReadUInt16BigEndian(s[4..]);
        var kept = new List<(ushort Platform, ushort Encoding, ushort Language, ushort Id, byte[] Text)>();
        for (var i = 0; i < count; i++)
        {
            var rec = s.Slice(6 + 12 * i, 12);
            ushort platform = BinaryPrimitives.ReadUInt16BigEndian(rec), encoding = BinaryPrimitives.ReadUInt16BigEndian(rec[2..]),
                language = BinaryPrimitives.ReadUInt16BigEndian(rec[4..]), id = BinaryPrimitives.ReadUInt16BigEndian(rec[6..]);
            int length = BinaryPrimitives.ReadUInt16BigEndian(rec[8..]), offset = BinaryPrimitives.ReadUInt16BigEndian(rec[10..]);
            if (platform == 3 && encoding == 1 && language == 0x409 && id is >= 1 and <= 6)
                kept.Add((platform, encoding, language, id, s.Slice(storage + offset, length).ToArray()));
        }
        if (kept.Count == 0) return null;
        var headerLength = 6 + 12 * kept.Count;
        var result = new byte[headerLength + kept.Sum(k => k.Text.Length)];
        var o = result.AsSpan();
        BinaryPrimitives.WriteUInt16BigEndian(o[2..], (ushort)kept.Count);
        BinaryPrimitives.WriteUInt16BigEndian(o[4..], (ushort)headerLength);
        var at = 0;
        for (var i = 0; i < kept.Count; i++)
        {
            var rec = o.Slice(6 + 12 * i, 12);
            BinaryPrimitives.WriteUInt16BigEndian(rec, kept[i].Platform);
            BinaryPrimitives.WriteUInt16BigEndian(rec[2..], kept[i].Encoding);
            BinaryPrimitives.WriteUInt16BigEndian(rec[4..], kept[i].Language);
            BinaryPrimitives.WriteUInt16BigEndian(rec[6..], kept[i].Id);
            BinaryPrimitives.WriteUInt16BigEndian(rec[8..], (ushort)kept[i].Text.Length);
            BinaryPrimitives.WriteUInt16BigEndian(rec[10..], (ushort)at);
            kept[i].Text.CopyTo(o[(headerLength + at)..]);
            at += kept[i].Text.Length;
        }
        return result;
    }

    private static IEnumerable<int> Components(byte[] glyf, (int Start, int End) range)
    {
        if (range.End - range.Start < 10 || BinaryPrimitives.ReadInt16BigEndian(glyf.AsSpan(range.Start)) >= 0) yield break;
        var p = range.Start + 10;
        while (true)
        {
            var flags = BinaryPrimitives.ReadUInt16BigEndian(glyf.AsSpan(p));
            yield return BinaryPrimitives.ReadUInt16BigEndian(glyf.AsSpan(p + 2));
            p += 4 + ComponentArgumentLength(flags);
            if ((flags & 0x0020) == 0) yield break;
        }
    }

    private static void RenumberComponents(byte[] glyph, Dictionary<int, int> oldToNew)
    {
        if (glyph.Length < 10 || BinaryPrimitives.ReadInt16BigEndian(glyph) >= 0) return;
        var p = 10;
        while (true)
        {
            var flags = BinaryPrimitives.ReadUInt16BigEndian(glyph.AsSpan(p));
            var old = BinaryPrimitives.ReadUInt16BigEndian(glyph.AsSpan(p + 2));
            BinaryPrimitives.WriteUInt16BigEndian(glyph.AsSpan(p + 2), (ushort)oldToNew[old]);
            p += 4 + ComponentArgumentLength(flags);
            if ((flags & 0x0020) == 0) return;
        }
    }

    private static int ComponentArgumentLength(ushort flags) =>
        ((flags & 0x0001) != 0 ? 4 : 2) +
        ((flags & 0x0008) != 0 ? 2 : (flags & 0x0040) != 0 ? 4 : (flags & 0x0080) != 0 ? 8 : 0);

    /// <summary>Unicode BMP → glyph id from the (3,1) or (0,x) format 4 subtable, or (3,10)/(0,x) format 12.</summary>
    private static Dictionary<int, int>? ReadCmap(byte[] cmap)
    {
        var s = cmap.AsSpan();
        int count = BinaryPrimitives.ReadUInt16BigEndian(s[2..]);
        int? format4 = null, format12 = null;
        for (var i = 0; i < count; i++)
        {
            var rec = s.Slice(4 + 8 * i, 8);
            int platform = BinaryPrimitives.ReadUInt16BigEndian(rec), encoding = BinaryPrimitives.ReadUInt16BigEndian(rec[2..]);
            var offset = (int)BinaryPrimitives.ReadUInt32BigEndian(rec[4..]);
            var format = BinaryPrimitives.ReadUInt16BigEndian(s[offset..]);
            var unicode = platform == 0 || (platform == 3 && encoding is 1 or 10);
            if (!unicode) continue;
            if (format == 4) format4 ??= offset;
            if (format == 12) format12 ??= offset;
        }
        var map = new Dictionary<int, int>();
        if (format12 is { } f12)
        {
            var groups = (int)BinaryPrimitives.ReadUInt32BigEndian(s[(f12 + 12)..]);
            for (var g = 0; g < groups; g++)
            {
                var rec = s.Slice(f12 + 16 + 12 * g, 12);
                var start = BinaryPrimitives.ReadUInt32BigEndian(rec);
                var end = Math.Min(BinaryPrimitives.ReadUInt32BigEndian(rec[4..]), 0xFFFF);
                var glyph = BinaryPrimitives.ReadUInt32BigEndian(rec[8..]);
                for (var c = start; c <= end && start <= 0xFFFF; c++) map[(int)c] = (int)(glyph + c - start);
            }
            return map;
        }
        if (format4 is not { } f4) return null;
        int segX2 = BinaryPrimitives.ReadUInt16BigEndian(s[(f4 + 6)..]);
        var ends = f4 + 14;
        var starts = ends + segX2 + 2;
        var deltas = starts + segX2;
        var ranges = deltas + segX2;
        for (var i = 0; i < segX2 / 2; i++)
        {
            int end = BinaryPrimitives.ReadUInt16BigEndian(s[(ends + 2 * i)..]);
            int start = BinaryPrimitives.ReadUInt16BigEndian(s[(starts + 2 * i)..]);
            int delta = BinaryPrimitives.ReadInt16BigEndian(s[(deltas + 2 * i)..]);
            int rangeOffset = BinaryPrimitives.ReadUInt16BigEndian(s[(ranges + 2 * i)..]);
            for (var c = start; c <= end && c != 0xFFFF; c++)
            {
                int glyph;
                if (rangeOffset == 0) glyph = (c + delta) & 0xFFFF;
                else
                {
                    var at = ranges + 2 * i + rangeOffset + 2 * (c - start);
                    glyph = BinaryPrimitives.ReadUInt16BigEndian(s[at..]);
                    if (glyph != 0) glyph = (glyph + delta) & 0xFFFF;
                }
                if (glyph != 0) map[c] = glyph;
            }
        }
        return map;
    }

    /// <summary>cmap with one (3,1) format 4 subtable, one segment per character.</summary>
    private static byte[] WriteCmap(IEnumerable<(int Char, int Glyph)> mapping)
    {
        var pairs = mapping.Where(m => m.Char < 0xFFFF).OrderBy(m => m.Char).ToList();
        var segments = pairs.Count + 1;
        var length = 16 + 8 * segments;
        var table = new byte[12 + length];
        var s = table.AsSpan();
        BinaryPrimitives.WriteUInt16BigEndian(s[2..], 1);        // one encoding record
        BinaryPrimitives.WriteUInt16BigEndian(s[4..], 3);        // Windows
        BinaryPrimitives.WriteUInt16BigEndian(s[6..], 1);        // Unicode BMP
        BinaryPrimitives.WriteUInt32BigEndian(s[8..], 12);
        var f = s[12..];
        BinaryPrimitives.WriteUInt16BigEndian(f, 4);
        BinaryPrimitives.WriteUInt16BigEndian(f[2..], (ushort)length);
        BinaryPrimitives.WriteUInt16BigEndian(f[6..], (ushort)(segments * 2));
        var power = 1; var log = 0;
        while (power * 2 <= segments) { power *= 2; log++; }
        BinaryPrimitives.WriteUInt16BigEndian(f[8..], (ushort)(power * 2));
        BinaryPrimitives.WriteUInt16BigEndian(f[10..], (ushort)log);
        BinaryPrimitives.WriteUInt16BigEndian(f[12..], (ushort)(segments * 2 - power * 2));
        var ends = 14; var starts = ends + 2 * segments + 2; var deltas = starts + 2 * segments; var ranges = deltas + 2 * segments;
        for (var i = 0; i < segments; i++)
        {
            var (c, g) = i < pairs.Count ? pairs[i] : (0xFFFF, 0);
            BinaryPrimitives.WriteUInt16BigEndian(f[(ends + 2 * i)..], (ushort)c);
            BinaryPrimitives.WriteUInt16BigEndian(f[(starts + 2 * i)..], (ushort)c);
            BinaryPrimitives.WriteUInt16BigEndian(f[(deltas + 2 * i)..], (ushort)(i < pairs.Count ? (g - c) & 0xFFFF : 1));
            BinaryPrimitives.WriteUInt16BigEndian(f[(ranges + 2 * i)..], 0);
        }
        return table;
    }

    private static byte[] Assemble(SortedDictionary<string, byte[]> tables)
    {
        var count = tables.Count;
        var headerLength = 12 + 16 * count;
        var total = headerLength + tables.Values.Sum(t => (t.Length + 3) & ~3);
        var result = new byte[total];
        var s = result.AsSpan();
        BinaryPrimitives.WriteUInt32BigEndian(s, 0x00010000);
        BinaryPrimitives.WriteUInt16BigEndian(s[4..], (ushort)count);
        var power = 1; var log = 0;
        while (power * 2 <= count) { power *= 2; log++; }
        BinaryPrimitives.WriteUInt16BigEndian(s[6..], (ushort)(power * 16));
        BinaryPrimitives.WriteUInt16BigEndian(s[8..], (ushort)log);
        BinaryPrimitives.WriteUInt16BigEndian(s[10..], (ushort)(count * 16 - power * 16));
        var offset = headerLength;
        var i = 0;
        foreach (var (tag, data) in tables)
        {
            var rec = s.Slice(12 + 16 * i++, 16);
            System.Text.Encoding.ASCII.GetBytes(tag, rec);
            data.CopyTo(s[offset..]);
            BinaryPrimitives.WriteUInt32BigEndian(rec[4..], Checksum(result.AsSpan(offset, (data.Length + 3) & ~3)));
            BinaryPrimitives.WriteUInt32BigEndian(rec[8..], (uint)offset);
            BinaryPrimitives.WriteUInt32BigEndian(rec[12..], (uint)data.Length);
            offset += (data.Length + 3) & ~3;
        }
        return result;
    }

    private static int HeadOffset(byte[] font)
    {
        int count = BinaryPrimitives.ReadUInt16BigEndian(font.AsSpan(4));
        for (var i = 0; i < count; i++)
            if (System.Text.Encoding.ASCII.GetString(font, 12 + 16 * i, 4) == "head")
                return (int)BinaryPrimitives.ReadUInt32BigEndian(font.AsSpan(12 + 16 * i + 8));
        throw new InvalidDataException("No head table.");
    }

    private static uint Checksum(ReadOnlySpan<byte> data)
    {
        uint sum = 0;
        for (var i = 0; i + 3 < data.Length; i += 4) sum += BinaryPrimitives.ReadUInt32BigEndian(data[i..]);
        var rest = data.Length % 4;
        if (rest > 0)
        {
            Span<byte> last = stackalloc byte[4];
            data[^rest..].CopyTo(last);
            sum += BinaryPrimitives.ReadUInt32BigEndian(last);
        }
        return sum;
    }
}
