Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $root 'brand'

function Bg       { [System.Drawing.Color]::FromArgb(0x0E, 0x0D, 0x08) }
function Surface  { [System.Drawing.Color]::FromArgb(0x17, 0x15, 0x0E) }
function Gold     { [System.Drawing.Color]::FromArgb(0xC9, 0xA3, 0x4A) }
function GoldHi   { [System.Drawing.Color]::FromArgb(0xE6, 0xCE, 0x90) }
function Cream    { [System.Drawing.Color]::FromArgb(0xF5, 0xEC, 0xD0) }
function Muted    { [System.Drawing.Color]::FromArgb(180, 0xF5, 0xEC, 0xD0) }
function GreenC   { [System.Drawing.Color]::FromArgb(0x34, 0xD3, 0x99) }

function DrawBox($g, $x, $y, $w, $h, $title, $sub, $borderColor) {
    $boxFont = New-Object System.Drawing.Font 'Segoe UI', 14, ([System.Drawing.FontStyle]::Bold)
    $subFont = New-Object System.Drawing.Font 'Segoe UI', 11
    $rect = [System.Drawing.Rectangle]::new($x, $y, $w, $h)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush (Surface)), $rect)
    $bp = New-Object System.Drawing.Pen $borderColor, 2
    $g.DrawRectangle($bp, $rect); $bp.Dispose()
    $tb = New-Object System.Drawing.SolidBrush $borderColor
    $g.DrawString($title, $boxFont, $tb, ($x + 15), ($y + 12)); $tb.Dispose()
    $mb = New-Object System.Drawing.SolidBrush (Muted)
    $g.DrawString($sub, $subFont, $mb, ($x + 15), ($y + 42)); $mb.Dispose()
    $boxFont.Dispose(); $subFont.Dispose()
}

# ============================================================
# 1. MINING FLOW
# ============================================================
$W = 1400; $H = 550
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear((Bg))

$tf = New-Object System.Drawing.Font 'Georgia', 26, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('How Mining Works', $tf, (New-Object System.Drawing.SolidBrush (Cream)), 60, 30)
$tf.Dispose()

DrawBox $g 60  140 200 90 'YOU' 'Commit USDC' (Gold)
DrawBox $g 360 140 220 90 'MINER' '2% / day conversion' (Gold)
DrawBox $g 680 110 230 80 'fDOGE REWARDS' 'To your wallet' (GreenC)
DrawBox $g 680 240 230 80 '95% USDC' 'To LiquidityManager' (Gold)
DrawBox $g 1010 240 240 80 'LP POOL' 'fDOGE/USDC deepens' (GreenC)
DrawBox $g 680 380 230 80 '5% USDC' 'To Treasury' (Muted)

$ap = New-Object System.Drawing.Pen (Gold), 3
$g.DrawLine($ap, 260, 185, 360, 185)
$g.DrawLine($ap, 580, 170, 680, 150)
$g.DrawLine($ap, 580, 200, 680, 280)
$g.DrawLine($ap, 910, 280, 1010, 280)
$g.DrawLine($ap, 580, 220, 680, 420)
$ap.Dispose()

$bmp.Save("$out\diagram-mining-flow.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "  wrote diagram-mining-flow.png"

# ============================================================
# 2. EMISSION CURVE
# ============================================================
$W = 1400; $H = 500
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear((Bg))

$tf = New-Object System.Drawing.Font 'Georgia', 26, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('Emission Curve: fDOGE per 1 USDC', $tf, (New-Object System.Drawing.SolidBrush (Cream)), 60, 25)
$tf.Dispose()

$numFont = New-Object System.Drawing.Font 'Georgia', 38, ([System.Drawing.FontStyle]::Bold)
$labelFont = New-Object System.Drawing.Font 'Segoe UI', 13, ([System.Drawing.FontStyle]::Bold)
$subFont = New-Object System.Drawing.Font 'Segoe UI', 11
$goldBrush = New-Object System.Drawing.SolidBrush (Gold)
$creamBrush = New-Object System.Drawing.SolidBrush (Cream)
$mutedBrush = New-Object System.Drawing.SolidBrush (Muted)

$phases = @(
    @{label='PHASE I'; range='0 - 7M supply'; rate='100'; h=280},
    @{label='PHASE II'; range='7M - 15M'; rate='40'; h=180},
    @{label='PHASE III'; range='15M - 21M'; rate='10'; h=100},
    @{label='PHASE IV'; range='21M+'; rate='0.2'; h=40}
)

$startX = 100; $colW = 300; $baseY = 400
for ($i = 0; $i -lt 4; $i++) {
    $p = $phases[$i]
    $x = $startX + $i * $colW
    $barH = $p.h
    $barY = $baseY - $barH
    $alpha = 255 - ($i * 50)
    $barColor = [System.Drawing.Color]::FromArgb($alpha, 0xC9, 0xA3, 0x4A)
    $barBrush = New-Object System.Drawing.SolidBrush $barColor
    $g.FillRectangle($barBrush, $x, $barY, 220, $barH)
    $barBrush.Dispose()
    $g.DrawString($p.rate, $numFont, $creamBrush, ($x + 20), ($barY + 10))
    $g.DrawString($p.label, $labelFont, $goldBrush, $x, ($baseY + 15))
    $g.DrawString($p.range, $subFont, $mutedBrush, $x, ($baseY + 40))
}

$numFont.Dispose(); $labelFont.Dispose(); $subFont.Dispose()
$goldBrush.Dispose(); $creamBrush.Dispose(); $mutedBrush.Dispose()

$bmp.Save("$out\diagram-emission-curve.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "  wrote diagram-emission-curve.png"

# ============================================================
# 3. LIQUIDITY FLYWHEEL
# ============================================================
$W = 1200; $H = 600
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear((Bg))

$tf = New-Object System.Drawing.Font 'Georgia', 26, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('Self-Deepening Liquidity Flywheel', $tf, (New-Object System.Drawing.SolidBrush (Cream)), 60, 25)
$tf.Dispose()

$boxFont = New-Object System.Drawing.Font 'Segoe UI', 13, ([System.Drawing.FontStyle]::Bold)
$subFont = New-Object System.Drawing.Font 'Segoe UI', 10
$numFont = New-Object System.Drawing.Font 'Georgia', 20, ([System.Drawing.FontStyle]::Bold)
$goldBrush = New-Object System.Drawing.SolidBrush (Gold)
$creamBrush = New-Object System.Drawing.SolidBrush (Cream)
$mutedBrush = New-Object System.Drawing.SolidBrush (Muted)

$steps = @(
    @{x=80;  y=130; title='1. User Mines'; sub='Commits USDC to Miner'},
    @{x=700; y=130; title='2. USDC Flows'; sub='95% to LiquidityManager'},
    @{x=700; y=370; title='3. Pool Deepens'; sub='fDOGE/USDC liquidity grows'},
    @{x=80;  y=370; title='4. Better Trading'; sub='Less slippage = more volume'}
)

foreach ($s in $steps) {
    DrawBox $g $s.x $s.y 380 100 $s.title $s.sub (Gold)
}

$ap = New-Object System.Drawing.Pen (Gold), 3
# Top: 1 -> 2
$g.DrawLine($ap, 460, 180, 700, 180)
# Right: 2 -> 3
$g.DrawLine($ap, 890, 230, 890, 370)
# Bottom: 3 -> 4
$g.DrawLine($ap, 700, 420, 460, 420)
# Left: 4 -> 1
$g.DrawLine($ap, 80, 370, 80, 230)

# Center label
$centerFont = New-Object System.Drawing.Font 'Georgia', 18, ([System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString("AUTOMATIC`nNO MANUAL LP", $centerFont, $goldBrush, [System.Drawing.RectangleF]::new(350, 240, 300, 100), $fmt)
$centerFont.Dispose()
$ap.Dispose()

$boxFont.Dispose(); $subFont.Dispose(); $numFont.Dispose()
$goldBrush.Dispose(); $creamBrush.Dispose(); $mutedBrush.Dispose()

$bmp.Save("$out\diagram-flywheel.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "  wrote diagram-flywheel.png"

# ============================================================
# 4. PROTOCOL ARCHITECTURE
# ============================================================
$W = 1400; $H = 650
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear((Bg))

$tf = New-Object System.Drawing.Font 'Georgia', 26, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('Protocol Architecture', $tf, (New-Object System.Drawing.SolidBrush (Cream)), 60, 25)
$tf.Dispose()

$layerFont = New-Object System.Drawing.Font 'Segoe UI', 10, ([System.Drawing.FontStyle]::Regular)
$mutedBrush = New-Object System.Drawing.SolidBrush (Muted)

# Layer labels
$g.DrawString('TOKENS', $layerFont, $mutedBrush, 60, 85)
$g.DrawString('MINING', $layerFont, $mutedBrush, 60, 230)
$g.DrawString('DEX', $layerFont, $mutedBrush, 60, 390)
$g.DrawString('IDENTITY', $layerFont, $mutedBrush, 60, 545)

# Horizontal dividers
$linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30, 0xC9, 0xA3, 0x4A)), 1
$g.DrawLine($linePen, 60, 220, 1340, 220)
$g.DrawLine($linePen, 60, 380, 1340, 380)
$g.DrawLine($linePen, 60, 535, 1340, 535)

# Token layer
DrawBox $g 200 100 220 80 'fDOGE' '210M cap, 0.1% fee' (Gold)
DrawBox $g 480 100 220 80 'cDOGE' '100M fixed, no fee' (GreenC)
DrawBox $g 760 100 220 80 'USDC' 'Gas + stablecoin' (Cream)
DrawBox $g 1040 100 220 80 'EURC / WUSDC' 'Stablecoins' (Muted)

# Mining layer
DrawBox $g 200 250 250 90 'Miner' 'Commit, convert, harvest' (Gold)
DrawBox $g 520 250 280 90 'LiquidityManager' 'Auto-seed fDOGE/USDC LP' (Gold)
DrawBox $g 870 250 220 90 'Treasury' '5% of mining flows' (Muted)

# DEX layer
DrawBox $g 200 405 250 90 'TdogeFactory' 'Deploy + register pairs' (Gold)
DrawBox $g 520 405 250 90 'ForgeRouter' '0.10% fee, path swaps' (Gold)
DrawBox $g 840 405 300 90 'LP Pairs (UniV2)' 'cDOGE, EURC, WUSDC' (GreenC)

# Identity layer
DrawBox $g 200 560 300 65 'TdogeNames' '.fdoge identity, 100% fee to LP' (Gold)

# Arrows
$ap = New-Object System.Drawing.Pen (Gold), 2
$g.DrawLine($ap, 310, 180, 310, 250) # fDOGE -> Miner
$g.DrawLine($ap, 450, 295, 520, 295) # Miner -> LM
$g.DrawLine($ap, 800, 295, 870, 295) # LM -> Treasury
$g.DrawLine($ap, 660, 340, 660, 405) # LM -> Router
$g.DrawLine($ap, 770, 450, 840, 450) # Router -> Pairs
$ap.Dispose()

$layerFont.Dispose(); $mutedBrush.Dispose(); $linePen.Dispose()

$bmp.Save("$out\diagram-architecture.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "  wrote diagram-architecture.png"

Write-Host "`nAll diagrams generated." -ForegroundColor Green
