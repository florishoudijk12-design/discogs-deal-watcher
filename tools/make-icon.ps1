# Generate the desktop, dashboard and GitHub assets from the approved Deal Shark artwork.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = Join-Path $PSScriptRoot 'assets\discogs-deal-shark-source.png'
$assets = Join-Path $PSScriptRoot '..\dashboard\assets'

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Logo source not found: $source"
}

$null = New-Item -ItemType Directory -Force -Path $assets

function New-ResizedLogo([System.Drawing.Image]$image, [int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bitmap.SetResolution(96, 96)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($image, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  } finally {
    $graphics.Dispose()
  }
  return $bitmap
}

function Get-PngBytes([System.Drawing.Bitmap]$bitmap) {
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return ,$stream.ToArray()
  } finally {
    $stream.Dispose()
  }
}

$sourceImage = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($asset in @(
    @{ Name = 'icon.png'; Size = 512 },
    @{ Name = 'thumbnail.png'; Size = 1024 }
  )) {
    $bitmap = New-ResizedLogo $sourceImage $asset.Size
    try {
      [System.IO.File]::WriteAllBytes((Join-Path $assets $asset.Name), (Get-PngBytes $bitmap))
    } finally {
      $bitmap.Dispose()
    }
  }

  $sizes = 256, 128, 64, 48, 32, 24, 16
  $images = foreach ($size in $sizes) {
    $bitmap = New-ResizedLogo $sourceImage $size
    try {
      [pscustomobject]@{ Size = $size; Bytes = (Get-PngBytes $bitmap) }
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $sourceImage.Dispose()
}

$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($output)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$images.Count)
  $offset = 6 + 16 * $images.Count
  foreach ($image in $images) {
    $dimension = if ($image.Size -ge 256) { 0 } else { $image.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$image.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $image.Bytes.Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
  $writer.Flush()
  [System.IO.File]::WriteAllBytes((Join-Path $assets 'icon.ico'), $output.ToArray())
} finally {
  $writer.Dispose()
  $output.Dispose()
}

Write-Host "Wrote Discogs Deal Shark icon.png (512), thumbnail.png (1024) and icon.ico ($($images.Count) sizes)."
