# Generate a multi-size Windows .ico from icon.png.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File build\make-icon.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $PSScriptRoot 'icon.png'
$outPath = Join-Path $PSScriptRoot 'icon.ico'
if (-not (Test-Path $srcPath)) { throw "Missing $srcPath" }

$src = [System.Drawing.Image]::FromFile($srcPath)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = @()
try {
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.DrawImage($src, 0, 0, $size, $size)
    } finally {
      $g.Dispose()
    }
    $ms = New-Object System.IO.MemoryStream
    try {
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $pngs += ,$ms.ToArray()
    } finally {
      $ms.Dispose()
      $bmp.Dispose()
    }
  }
} finally {
  $src.Dispose()
}

$fs = [System.IO.File]::Create($outPath)
$bw = New-Object System.IO.BinaryWriter($fs)
try {
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $size = $sizes[$i]
    $bytes = $pngs[$i]
    $dimension = if ($size -ge 256) { 0 } else { $size }
    $bw.Write([Byte]$dimension)
    $bw.Write([Byte]$dimension)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
  }
  foreach ($bytes in $pngs) { $bw.Write($bytes) }
} finally {
  $bw.Dispose()
  $fs.Dispose()
}

Write-Host "Wrote $outPath ($((Get-Item $outPath).Length) bytes, $($sizes.Count) sizes)"
