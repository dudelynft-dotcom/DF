# Generate three PFP variants. X crops avatars into a circle at display
# time, so every design must read cleanly when everything outside the
# inscribed circle is clipped. All outputs 400 x 400 PNG.

Add-Type -AssemblyName System.Drawing

$root    = Split-Path -Parent $PSScriptRoot
$dogeSrc = Join-Path $root 'frontend\public\doge.png'
$outDir  = Join-Path $root 'brand'

function Bg       { [System.Drawing.Color]::FromArgb(0x0E, 0x0D, 0x08) }
function Surface  { [System.Drawing.Color]::FromArgb(0x17, 0x15, 0x0E) }
function Raised   { [System.Drawing.Color]::FromArgb(0x1F, 0x1C, 0x12) }
function Gold400  { [System.Drawing.Color]::FromArgb(0xC9, 0xA3, 0x4A) }
function Gold300  { [System.Drawing.Color]::FromArgb(0xD9, 0xB8, 0x66) }
function Gold200  { [System.Drawing.Color]::FromArgb(0xE6, 0xCE, 0x90) }
function Ink      { [System.Drawing.Color]::FromArgb(0xF5, 0xEC, 0xD0) }

$size = 400

# ------------------------------------------------------------------
# Variant A: Medallion — doge fills the circle, soft radial vignette,
# a hairline gold edge. Reads like a commemorative coin.
# ------------------------------------------------------------------
function Make-Medallion {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode   = 'HighQuality'

    # Radial gradient: Raised centre → Bg edges.
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
    $pgb.CenterPoint    = [System.Drawing.PointF]::new($size / 2, $size / 2)
    $pgb.CenterColor    = (Raised)
    $pgb.SurroundColors = @((Bg))
    $g.FillEllipse($pgb, 0, 0, $size, $size)
    $pgb.Dispose(); $path.Dispose()

    # Doge — scaled to fill more of the frame (meme-coin vibe).
    $doge = [System.Drawing.Image]::FromFile($dogeSrc)
    $target = 300
    $ratio  = [Math]::Min($target / $doge.Width, $target / $doge.Height)
    $w = [int]($doge.Width * $ratio)
    $h = [int]($doge.Height * $ratio)
    $x = [int](($size - $w) / 2)
    $y = [int](($size - $h) / 2) + 10 # nudge down so eyes sit higher
    $g.DrawImage($doge, $x, $y, $w, $h)
    $doge.Dispose()

    # Hairline gold edge — sits on the clip boundary, inscribed ring.
    $edgePen = New-Object System.Drawing.Pen (Gold400), 2
    $g.DrawEllipse($edgePen, 2, 2, ($size - 4), ($size - 4))
    $edgePen.Dispose()

    $out = Join-Path $outDir 'pfp-medallion.png'
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "  wrote $out"
}

# ------------------------------------------------------------------
# Variant B: Monogram — "DF" serif in gold on dark bg with a thin
# hairline frame. Professional, scales perfectly at any size, great
# on a light feed.
# ------------------------------------------------------------------
function Make-Monogram {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'

    # Radial-ish background.
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
    $pgb.CenterPoint    = [System.Drawing.PointF]::new($size / 2, ($size / 2) - 20)
    $pgb.CenterColor    = (Surface)
    $pgb.SurroundColors = @((Bg))
    $g.FillEllipse($pgb, 0, 0, $size, $size)
    $pgb.Dispose(); $path.Dispose()

    # Inner hairline — gold, very thin, inset from the edge.
    $hp = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 0xC9, 0xA3, 0x4A)), 1
    $inset = 18
    $g.DrawEllipse($hp, $inset, $inset, ($size - 2 * $inset), ($size - 2 * $inset))
    $hp.Dispose()

    # "DF" — big serif, gold.
    $mf = New-Object System.Drawing.Font 'Georgia', 180, ([System.Drawing.FontStyle]::Regular)
    $gb = New-Object System.Drawing.SolidBrush (Gold400)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment     = 'Center'
    $fmt.LineAlignment = 'Center'
    # Slight vertical nudge up so it's optically centred.
    $g.DrawString('DF', $mf, $gb, [System.Drawing.RectangleF]::new(0, -10, $size, $size), $fmt)
    $mf.Dispose(); $gb.Dispose()

    # Small caps subtitle under the monogram.
    $sf = New-Object System.Drawing.Font 'Segoe UI', 10, ([System.Drawing.FontStyle]::Regular)
    $sb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(180, 0xF5, 0xEC, 0xD0))
    $sub = 'DOGE  FORGE'
    # Spaced caps, centred.
    $subSize = $g.MeasureString($sub, $sf)
    # Manually letter-space by drawing each char.
    $chars   = $sub.ToCharArray()
    $spacing = 4
    $total   = 0
    foreach ($c in $chars) { $total += $g.MeasureString([string]$c, $sf).Width + $spacing }
    $total -= $spacing
    $sx = ($size - $total) / 2
    $sy = $size - 90
    foreach ($c in $chars) {
        $g.DrawString([string]$c, $sf, $sb, $sx, $sy)
        $sx += $g.MeasureString([string]$c, $sf).Width + $spacing
    }
    $sf.Dispose(); $sb.Dispose()

    $out = Join-Path $outDir 'pfp-monogram.png'
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "  wrote $out"
}

# ------------------------------------------------------------------
# Variant C: Gold coin — doge on a warm gold radial with a darker
# rim. High-contrast, very "meme coin" — pops on a dark X feed.
# ------------------------------------------------------------------
function Make-Coin {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode   = 'HighQuality'

    # Transparent background outside the coin for clean X crop.
    $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

    # Coin body: radial Gold200 → Gold400.
    $coinPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $coinPath.AddEllipse(0, 0, $size, $size)
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $coinPath
    $pgb.CenterPoint    = [System.Drawing.PointF]::new(($size / 2) - 30, ($size / 2) - 30)
    $pgb.CenterColor    = (Gold200)
    $pgb.SurroundColors = @((Gold400))
    $g.FillEllipse($pgb, 0, 0, $size, $size)
    $pgb.Dispose(); $coinPath.Dispose()

    # Darker outer rim for depth.
    $rimPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 0x3A, 0x2D, 0x12)), 3
    $g.DrawEllipse($rimPen, 2, 2, ($size - 4), ($size - 4))
    $rimPen.Dispose()

    # Inner bezel (second hairline, offset inward).
    $bezel = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 0xFF, 0xF2, 0xC8)), 1
    $g.DrawEllipse($bezel, 14, 14, ($size - 28), ($size - 28))
    $bezel.Dispose()

    # Doge artwork on the coin.
    $doge = [System.Drawing.Image]::FromFile($dogeSrc)
    $target = 280
    $ratio  = [Math]::Min($target / $doge.Width, $target / $doge.Height)
    $w = [int]($doge.Width * $ratio)
    $h = [int]($doge.Height * $ratio)
    $x = [int](($size - $w) / 2)
    $y = [int](($size - $h) / 2) + 6
    $g.DrawImage($doge, $x, $y, $w, $h)
    $doge.Dispose()

    $out = Join-Path $outDir 'pfp-coin.png'
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "  wrote $out"
}

Write-Host ""
Write-Host "Generating PFP variants..." -ForegroundColor Cyan
Make-Medallion
Make-Monogram
Make-Coin
Write-Host "Done." -ForegroundColor Green
