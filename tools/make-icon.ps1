# Render the Deal Watcher mark to dashboard/assets/icon.png, thumbnail.png and icon.ico.
# The geometry mirrors dashboard/assets/logo.svg and stays legible at Windows shortcut sizes.
Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\dashboard\assets'
$null = New-Item -ItemType Directory -Force -Path $assets

function New-RoundedRectanglePath([float]$size, [float]$radius) {
  $diameter = 2 * $radius
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($size - $diameter, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($size - $diameter, $size - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $size - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Polygon([float[]]$coordinates, [float]$scale) {
  $points = @()
  for ($i = 0; $i -lt $coordinates.Length; $i += 2) {
    $points += New-Object System.Drawing.PointF(($coordinates[$i] * $scale), ($coordinates[$i + 1] * $scale))
  }
  return ,[System.Drawing.PointF[]]$points
}

function New-LogoBitmap([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 256.0
  $tilePath = New-RoundedRectanglePath $size (56 * $scale)
  $tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $size)),
    [System.Drawing.Color]::FromArgb(0x18, 0x23, 0x32),
    [System.Drawing.Color]::FromArgb(0x09, 0x0e, 0x15))
  $graphics.FillPath($tileBrush, $tilePath)

  $cx = 124 * $scale
  $cy = 112 * $scale
  $recordRadius = 82 * $scale
  $recordBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0x09, 0x0d, 0x13))
  $recordPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(0x39, 0x44, 0x53), [Math]::Max(1, 5 * $scale))
  $graphics.FillEllipse($recordBrush, $cx - $recordRadius, $cy - $recordRadius, 2 * $recordRadius, 2 * $recordRadius)
  $graphics.DrawEllipse($recordPen, $cx - $recordRadius, $cy - $recordRadius, 2 * $recordRadius, 2 * $recordRadius)

  $groovePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(215, 0x2b, 0x35, 0x42), [Math]::Max(1, 3 * $scale))
  foreach ($grooveRadius in 69, 56, 43) {
    $radius = $grooveRadius * $scale
    $graphics.DrawEllipse($groovePen, $cx - $radius, $cy - $radius, 2 * $radius, 2 * $radius)
  }

  $labelRadius = 27 * $scale
  $graphics.FillEllipse([System.Drawing.Brushes]::White, $cx - $labelRadius, $cy - $labelRadius, 2 * $labelRadius, 2 * $labelRadius)
  $holeRadius = 8 * $scale
  $holeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0x11, 0x19, 0x25))
  $graphics.FillEllipse($holeBrush, $cx - $holeRadius, $cy - $holeRadius, 2 * $holeRadius, 2 * $holeRadius)

  $arrow = New-Polygon @(105, 116, 143, 116, 143, 155, 167, 155, 124, 203, 81, 155, 105, 155) $scale
  $arrowShadow = New-Polygon @(105, 121, 143, 121, 143, 160, 167, 160, 124, 208, 81, 160, 105, 160) $scale
  $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(115, 0x03, 0x0a, 0x06))
  $graphics.FillPolygon($shadowBrush, $arrowShadow)
  $arrowRect = New-Object System.Drawing.RectangleF((81 * $scale), (116 * $scale), (86 * $scale), (87 * $scale))
  $arrowBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $arrowRect,
    [System.Drawing.Color]::FromArgb(0x35, 0xe5, 0x86),
    [System.Drawing.Color]::FromArgb(0x1b, 0xbd, 0x63),
    90)
  $graphics.FillPolygon($arrowBrush, $arrow)

  $gemBase = New-Polygon @(180, 164, 210, 164, 224, 181, 195, 215, 166, 181) $scale
  $gemBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0x7c, 0x3a, 0xed))
  $graphics.FillPolygon($gemBrush, $gemBase)
  $gemFacets = @(
    @{ Points = @(180, 164, 195, 164, 187, 181, 166, 181); Color = @(0xa7, 0x8b, 0xfa) },
    @{ Points = @(195, 164, 210, 164, 224, 181, 203, 181); Color = @(0x8b, 0x5c, 0xf6) },
    @{ Points = @(187, 181, 203, 181, 195, 215); Color = @(0xb7, 0x94, 0xf6) },
    @{ Points = @(166, 181, 187, 181, 195, 215); Color = @(0x6d, 0x28, 0xd9) },
    @{ Points = @(203, 181, 224, 181, 195, 215); Color = @(0x5b, 0x21, 0xb6) }
  )
  foreach ($facet in $gemFacets) {
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($facet.Color[0], $facet.Color[1], $facet.Color[2]))
    $graphics.FillPolygon($brush, (New-Polygon $facet.Points $scale))
    $brush.Dispose()
  }

  $tileBrush.Dispose()
  $tilePath.Dispose()
  $recordBrush.Dispose()
  $recordPen.Dispose()
  $groovePen.Dispose()
  $holeBrush.Dispose()
  $shadowBrush.Dispose()
  $arrowBrush.Dispose()
  $gemBrush.Dispose()
  $graphics.Dispose()
  return $bitmap
}

function Get-PngBytes($bitmap) {
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  return ,$stream.ToArray()
}

foreach ($asset in @(
  @{ Name = 'icon.png'; Size = 512 },
  @{ Name = 'thumbnail.png'; Size = 1024 }
)) {
  $bitmap = New-LogoBitmap $asset.Size
  [System.IO.File]::WriteAllBytes((Join-Path $assets $asset.Name), (Get-PngBytes $bitmap))
  $bitmap.Dispose()
}

$sizes = 256, 128, 64, 48, 32, 24, 16
$images = foreach ($size in $sizes) {
  $bitmap = New-LogoBitmap $size
  $bytes = Get-PngBytes $bitmap
  $bitmap.Dispose()
  [pscustomobject]@{ Size = $size; Bytes = $bytes }
}

$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($output)
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
$writer.Dispose()

Write-Host "Wrote icon.png (512), thumbnail.png (1024) and icon.ico ($($images.Count) sizes) to dashboard/assets"
