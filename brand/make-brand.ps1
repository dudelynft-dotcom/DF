# Generate X (Twitter) PFP + banner for DOGE FORGE.
# Brand palette pulled from tailwind.config.ts:
#   bg-base     #0E0D08
#   bg-surface  #17150E
#   gold-400    #C9A34A
#   gold-300    #D9B866
#   ink         #F5ECD0
#
# Outputs into brand/:
#   pfp.png     400 x 400    (X profile picture)
#   banner.png  1500 x 500   (X header)
#
# Uses System.Drawing so it runs on vanilla Windows with no extra deps.

Add-Type -AssemblyName System.Drawing

$root    = Split-Path -Parent $PSScriptRoot
$dogeSrc = Join-Path $root 'frontend\public\doge.png'
$outDir  = Join-Path $root 'brand'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Bg       { [System.Drawing.Color]::FromArgb(0x0E, 0x0D, 0x08) }
function Surface  { [System.Drawing.Color]::FromArgb(0x17, 0x15, 0x0E) }
function Gold400  { [System.Drawing.Color]::FromArgb(0xC9, 0xA3, 0x4A) }
function Gold300  { [System.Drawing.Color]::FromArgb(0xD9, 0xB8, 0x66) }
function Ink      { [System.Drawing.Color]::FromArgb(0xF5, 0xEC, 0xD0) }
function InkMuted { [System.Drawing.Color]::FromArgb(0xB8, 0xAE, 0x94) }

# ------------------------------------------------------------------
# PFP — 400 x 400
# doge centered on a deep-gradient square, thin gold ring on the
# edge for presence on a feed.
# ------------------------------------------------------------------
function Make-Pfp {
    $size = 400
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode   = 'HighQuality'

    # Radial-ish gradient: surface in the centre, bg at the edges.
    # GDI+ has no real radial gradient so fake it with a PathGradientBrush.
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(-50, -50, ($size + 100), ($size + 100))
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
    $pgb.CenterPoint    = [System.Drawing.PointF]::new($size / 2, $size / 2)
    $pgb.CenterColor    = (Surface)
    $pgb.SurroundColors = @((Bg))
    $g.FillRectangle($pgb, 0, 0, $size, $size)
    $pgb.Dispose()
    $path.Dispose()

    # Subtle concentric gold-tinted rings for depth (very faint).
    for ($i = 0; $i -lt 3; $i++) {
        $alpha = 18 - ($i * 5)
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($alpha, 0xC9, 0xA3, 0x4A)), 1
        $r = 130 + ($i * 30)
        $g.DrawEllipse($pen, ($size / 2 - $r), ($size / 2 - $r), ($r * 2), ($r * 2))
        $pen.Dispose()
    }

    # Doge artwork — fit into an inner square with padding.
    $doge = [System.Drawing.Image]::FromFile($dogeSrc)
    $pad      = 48
    $innerMax = $size - (2 * $pad)
    $ratio    = [Math]::Min($innerMax / $doge.Width, $innerMax / $doge.Height)
    $w        = [int]($doge.Width  * $ratio)
    $h        = [int]($doge.Height * $ratio)
    $x        = [int](($size - $w) / 2)
    $y        = [int](($size - $h) / 2)
    $g.DrawImage($doge, $x, $y, $w, $h)
    $doge.Dispose()

    # Outer gold ring — thin, premium feel (not a cheap thick border).
    $ringPen = New-Object System.Drawing.Pen (Gold400), 4
    $inset   = 6
    $g.DrawEllipse($ringPen, $inset, $inset, ($size - 2 * $inset), ($size - 2 * $inset))
    $ringPen.Dispose()

    $out = Join-Path $outDir 'pfp.png'
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "  wrote $out ($size x $size)"
}

# ------------------------------------------------------------------
# Banner — 1500 x 500 (X header)
# Layout:
#   left 60%:  wordmark (DOGE FORGE) + thin rule + tagline
#   right 40%: the doge artwork, with a gradient fade so text has room
# Remember X crops the top/bottom ~15% on mobile; keep content in the
# horizontal middle band.
# ------------------------------------------------------------------
function Make-Banner {
    $W = 1500; $H = 500
    $bmp = New-Object System.Drawing.Bitmap $W, $H
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode   = 'HighQuality'
    $g.TextRenderingHint = 'ClearTypeGridFit'

    # Base fill: bg-base.
    $g.Clear((Bg))

    # Subtle diagonal surface-tone band across the middle for depth.
    $lgbRect = [System.Drawing.RectangleF]::new(0, 0, $W, $H)
    $lgb = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
        $lgbRect, (Bg), (Surface), 20.0
    $g.FillRectangle($lgb, 0, 0, $W, $H)
    $lgb.Dispose()

    # Right-side doge image with a horizontal alpha fade so it blends
    # into the banner instead of looking pasted-on.
    $doge = [System.Drawing.Image]::FromFile($dogeSrc)
    $dH = 380
    $dRatio = $dH / $doge.Height
    $dW = [int]($doge.Width * $dRatio)
    $dX = $W - $dW - 60
    $dY = [int](($H - $dH) / 2)

    # Draw into a temp bitmap so we can fade it.
    $tmp = New-Object System.Drawing.Bitmap $dW, $dH
    $tg  = [System.Drawing.Graphics]::FromImage($tmp)
    $tg.InterpolationMode = 'HighQualityBicubic'
    $tg.DrawImage($doge, 0, 0, $dW, $dH)
    $tg.Dispose(); $doge.Dispose()

    # Apply a left-edge alpha fade.
    $rect = [System.Drawing.Rectangle]::new(0, 0, $dW, $dH)
    $data = $tmp.LockBits($rect, 'ReadWrite', 'Format32bppArgb')
    $bytes = New-Object byte[] ($data.Stride * $dH)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $fadeEnd = [int]($dW * 0.25)
    for ($y = 0; $y -lt $dH; $y++) {
        for ($x = 0; $x -lt $dW; $x++) {
            $idx = ($y * $data.Stride) + ($x * 4) + 3 # alpha byte
            if ($x -lt $fadeEnd) {
                $scale = [double]$x / $fadeEnd
                $bytes[$idx] = [byte]([Math]::Min(255, $bytes[$idx] * $scale))
            }
        }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
    $tmp.UnlockBits($data)

    $g.DrawImage($tmp, $dX, $dY, $dW, $dH)
    $tmp.Dispose()

    # Left-side content: wordmark + rule + tagline.
    $leftX = 80

    # Tiny eyebrow above the wordmark.
    $eyebrowFont = New-Object System.Drawing.Font 'Segoe UI', 13, ([System.Drawing.FontStyle]::Regular)
    $eyebrowBrush = New-Object System.Drawing.SolidBrush (Gold400)
    # Manual letter-spacing by drawing each char separately.
    $eyebrow = "ARC NETWORK  ·  MINING PROTOCOL"
    $eyebrowX = $leftX
    $eyebrowY = 140
    $sf = New-Object System.Drawing.StringFormat
    foreach ($ch in $eyebrow.ToCharArray()) {
        $g.DrawString([string]$ch, $eyebrowFont, $eyebrowBrush, $eyebrowX, $eyebrowY, $sf)
        $charW = $g.MeasureString([string]$ch, $eyebrowFont).Width
        $eyebrowX += $charW + 3
    }
    $eyebrowFont.Dispose(); $eyebrowBrush.Dispose()

    # Wordmark: "DOGE FORGE".
    # "DOGE" in ink, "FORGE" in gold — matches site hero.
    $wmFont = New-Object System.Drawing.Font 'Georgia', 88, ([System.Drawing.FontStyle]::Regular)
    $wmY    = 180
    $dogeBrush  = New-Object System.Drawing.SolidBrush (Ink)
    $forgeBrush = New-Object System.Drawing.SolidBrush (Gold400)
    $dogeSize   = $g.MeasureString('DOGE', $wmFont)
    $g.DrawString('DOGE', $wmFont, $dogeBrush, $leftX, $wmY)
    $g.DrawString('FORGE', $wmFont, $forgeBrush, ($leftX + $dogeSize.Width - 6), $wmY)
    $dogeBrush.Dispose(); $forgeBrush.Dispose(); $wmFont.Dispose()

    # Hairline under the wordmark.
    $rulePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(80, 0xC9, 0xA3, 0x4A)), 1
    $g.DrawLine($rulePen, $leftX, 320, ($leftX + 460), 320)
    $rulePen.Dispose()

    # Tagline.
    $tagFont = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Regular)
    $tagBrush = New-Object System.Drawing.SolidBrush (InkMuted)
    $g.DrawString('Mine fDOGE. Trade on Arc.', $tagFont, $tagBrush, $leftX, 340)
    $tagFont.Dispose(); $tagBrush.Dispose()

    # URL footer — low-prominence.
    $urlFont  = New-Object System.Drawing.Font 'Consolas', 14
    $urlBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(160, 0xB8, 0xAE, 0x94))
    $g.DrawString('dogeforge.fun', $urlFont, $urlBrush, $leftX, 390)
    $urlFont.Dispose(); $urlBrush.Dispose()

    $out = Join-Path $outDir 'banner.png'
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "  wrote $out ($W x $H)"
}

Write-Host ""
Write-Host "Generating DOGE FORGE brand assets..." -ForegroundColor Cyan
Make-Pfp
Make-Banner
Write-Host "Done." -ForegroundColor Green
