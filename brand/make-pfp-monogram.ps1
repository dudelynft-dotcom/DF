# Monogram PFP — "DF" side-by-side, properly centred, with a subtle
# gold gradient on the letters and a clean double-hairline ring.

Add-Type -AssemblyName System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'brand'
$size   = 400

function Bg       { [System.Drawing.Color]::FromArgb(0x0E, 0x0D, 0x08) }
function Surface  { [System.Drawing.Color]::FromArgb(0x17, 0x15, 0x0E) }
function Gold200  { [System.Drawing.Color]::FromArgb(0xE6, 0xCE, 0x90) }
function Gold300  { [System.Drawing.Color]::FromArgb(0xD9, 0xB8, 0x66) }
function Gold400  { [System.Drawing.Color]::FromArgb(0xC9, 0xA3, 0x4A) }
function Gold500  { [System.Drawing.Color]::FromArgb(0x9E, 0x7E, 0x36) }
function InkFaint { [System.Drawing.Color]::FromArgb(210, 0xF5, 0xEC, 0xD0) }

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$g.PixelOffsetMode   = 'HighQuality'
$g.TextRenderingHint = 'AntiAliasGridFit'

# ----- Background: radial Surface -> Bg, confined to the circle -----
$clipPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$clipPath.AddEllipse(0, 0, $size, $size)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $clipPath
$pgb.CenterPoint    = [System.Drawing.PointF]::new($size / 2, ($size / 2) - 30)
$pgb.CenterColor    = (Surface)
$pgb.SurroundColors = @((Bg))
$g.FillEllipse($pgb, 0, 0, $size, $size)
$pgb.Dispose()

# ----- Letters: "DF" side-by-side, gold gradient, centred -----
# Strategy: measure the combined text width at a target size, then scale
# so it fits inside an inner box with comfortable padding.
$letters   = 'DF'
$targetBox = 240   # letters fit inside this square, leaving room for the ring & subtitle
$fontFamily = 'Georgia'

# Pick a size that makes "DF" as-wide-as-possible inside $targetBox
# while leaving headroom. Loop up until overflow then step back.
$fontSize = 10.0
while ($true) {
    $tryFont = New-Object System.Drawing.Font $fontFamily, ($fontSize + 2), ([System.Drawing.FontStyle]::Regular)
    $sz = $g.MeasureString($letters, $tryFont)
    $tryFont.Dispose()
    if ($sz.Width -gt $targetBox -or ($sz.Height - 30) -gt $targetBox) { break }
    $fontSize += 2
}
$font = New-Object System.Drawing.Font $fontFamily, $fontSize, ([System.Drawing.FontStyle]::Regular)

# Measure final size and compute the centring origin. MeasureString
# includes a lot of vertical padding on serif fonts, so shave it.
$textSize = $g.MeasureString($letters, $font)
$drawW    = $textSize.Width
$drawH    = $textSize.Height
$originX  = ($size - $drawW) / 2
# Optical centre sits slightly above geometric centre for caps.
$originY  = ($size - $drawH) / 2 - 14

# Build a gradient brush spanning the text bounds: Gold200 top, Gold500 bottom.
$textRect = [System.Drawing.RectangleF]::new($originX, $originY, $drawW, $drawH)
$letterBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
    $textRect, (Gold200), (Gold500), 90.0
# Colour-blend to emphasise the mid-tone in the middle of the stroke.
$cb = New-Object System.Drawing.Drawing2D.ColorBlend 4
$cb.Colors    = @((Gold200), (Gold300), (Gold400), (Gold500))
$cb.Positions = @(0.0, 0.35, 0.65, 1.0)
$letterBrush.InterpolationColors = $cb

$g.DrawString($letters, $font, $letterBrush, $originX, $originY)
$letterBrush.Dispose()
$font.Dispose()

# ----- Ring: outer thin gold + inner hairline -----
$outerPen = New-Object System.Drawing.Pen (Gold400), 3
$g.DrawEllipse($outerPen, 4, 4, ($size - 8), ($size - 8))
$outerPen.Dispose()

$innerPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 0xC9, 0xA3, 0x4A)), 1
$inset = 20
$g.DrawEllipse($innerPen, $inset, $inset, ($size - 2 * $inset), ($size - 2 * $inset))
$innerPen.Dispose()

# ----- Subtitle: letter-spaced "DOGE · FORGE" along the bottom -----
$subFont = New-Object System.Drawing.Font 'Segoe UI', 11, ([System.Drawing.FontStyle]::Regular)
$subBrush = New-Object System.Drawing.SolidBrush (InkFaint)
$sub = 'DOGE    FORGE'
$spacing = 3

# Measure with letter-spacing to centre as a unit.
$total = 0.0
foreach ($c in $sub.ToCharArray()) {
    $total += $g.MeasureString([string]$c, $subFont).Width + $spacing
}
$total -= $spacing
$sx = ($size - $total) / 2
# Sit the subtitle tight under the visual baseline of the letters.
# MeasureString over-reports serif height, so compute from the letter
# origin instead of the canvas bottom.
$sy = $originY + ($drawH * 0.82)
foreach ($c in $sub.ToCharArray()) {
    $g.DrawString([string]$c, $subFont, $subBrush, $sx, $sy)
    $sx += $g.MeasureString([string]$c, $subFont).Width + $spacing
}
$subFont.Dispose()
$subBrush.Dispose()

# ----- Save -----
$out = Join-Path $outDir 'pfp-monogram.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $clipPath.Dispose()
Write-Host "  wrote $out ($size x $size)" -ForegroundColor Green
