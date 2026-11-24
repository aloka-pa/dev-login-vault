# Resizes icons/icon-source.png to the four extension icon sizes, on a cream circle so the padlock
# stays visible on dark toolbars.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$circleColor = [System.Drawing.Color]::FromArgb(255, 0xFF, 0xF3, 0xDC)   # cream #FFF3DC
$iconScale = 0.78                                                           # padlock size inside the circle
$iconDir = Join-Path $PSScriptRoot '..\icons'
$src = [System.Drawing.Image]::FromFile((Resolve-Path (Join-Path $iconDir 'icon-source.png')))
try {
  foreach ($size in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $brush = New-Object System.Drawing.SolidBrush $circleColor
    $g.FillEllipse($brush, 0, 0, $size - 0.5, $size - 0.5)
    $brush.Dispose()
    $scale = @{ 16 = 0.9; 32 = 0.84 }[$size]; if (-not $scale) { $scale = $iconScale }   # small sizes: bigger padlock
    $inner = $size * $scale
    $offset = ($size - $inner) / 2
    $g.DrawImage($src, [single]$offset, [single]$offset, [single]$inner, [single]$inner)
    $g.Dispose()
    $bmp.Save((Join-Path $iconDir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }
} finally { $src.Dispose() }
Write-Output 'Icons written: 16, 32, 48, 128'
