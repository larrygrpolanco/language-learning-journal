# One-off. Generates the PWA icons from the design tokens: the app's warm ground with the
# ruled-sheet motif and a gold rule. Derived from styles, not invented branding.
# Re-runnable; overwrites public/icon-*.png.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$out = Join-Path $root 'public'
New-Item -ItemType Directory -Path $out -Force | Out-Null

# --color-bg #f3f2f2, --color-text #201f1d, --color-accent #b68235, --rule-ink rgba(32,31,29,.09)
$ground = [System.Drawing.Color]::FromArgb(243, 242, 242)
$ink     = [System.Drawing.Color]::FromArgb(32, 31, 29)
$gold    = [System.Drawing.Color]::FromArgb(182, 130, 53)
$ruleInk = [System.Drawing.Color]::FromArgb(23, 32, 31, 29)

function Make-Icon([int]$size, [string]$path, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($ground)

  # A maskable icon must keep its content inside the safe circle (80% of the canvas).
  $inset = if ($maskable) { [int]($size * 0.20) } else { [int]($size * 0.11) }
  $w = $size - 2 * $inset

  # Ruled lines, echoing the journal sheet.
  $rulePen = New-Object System.Drawing.Pen $ruleInk, ([float][Math]::Max(1, $size / 128))
  $step = $w / 6.0
  for ($i = 1; $i -le 5; $i++) {
    $y = $inset + $step * $i
    $g.DrawLine($rulePen, [float]$inset, [float]$y, [float]($size - $inset), [float]$y)
  }
  $rulePen.Dispose()

  # The gold rule: colour as a stroke, never a fill.
  $goldPen = New-Object System.Drawing.Pen $gold, ([float][Math]::Max(2, $size / 32))
  $gy = $inset + $step * 5
  $g.DrawLine($goldPen, [float]$inset, [float]$gy, [float]($inset + $w * 0.55), [float]$gy)
  $goldPen.Dispose()

  # A serif J sitting on the rules, in the heading face if it is installed.
  $family = $null
  foreach ($name in @('Cormorant Garamond', 'Georgia', 'Times New Roman')) {
    try { $family = New-Object System.Drawing.FontFamily $name; break } catch { }
  }
  if ($family) {
    $font = New-Object System.Drawing.Font $family, ([float]($w * 0.62)), ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush $ink
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = 'Center'
    $fmt.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF ([float]$inset), ([float]($inset - $step * 0.35)), ([float]$w), ([float]($step * 5))
    $g.DrawString('J', $font, $brush, $rect, $fmt)
    $font.Dispose(); $brush.Dispose(); $fmt.Dispose(); $family.Dispose()
  }

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $path ($((Get-Item $path).Length) bytes)"
}

Make-Icon 192 (Join-Path $out 'icon-192.png') $false
Make-Icon 512 (Join-Path $out 'icon-512.png') $false
Make-Icon 512 (Join-Path $out 'icon-maskable-512.png') $true
Make-Icon 180 (Join-Path $out 'apple-touch-icon.png') $false
