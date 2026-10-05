# Regenerates launcher/postadmin.ico (the PSQL logo) at all standard sizes.
# Usage: powershell -ExecutionPolicy Bypass -File launcher/make-icon.ps1
Add-Type -AssemblyName System.Drawing

function New-LogoPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded square with a Postgres-blue gradient.
  $r = [Math]::Max(3, [int]($size * 0.22))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2; $w = $size - 1
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($w - $d, 0, $d, $d, 270, 90)
  $path.AddArc($w - $d, $w - $d, $d, $d, 0, 90)
  $path.AddArc(0, $w - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 74, 144, 217)), ([System.Drawing.Color]::FromArgb(255, 31, 78, 121)), 60
  $g.FillPath($bg, $path)

  # "PSQL" on one line for large sizes, stacked PS / QL for small ones.
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'; $fmt.FormatFlags = 'NoWrap'
  $family = New-Object System.Drawing.FontFamily 'Segoe UI'
  $text = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($size -ge 48) {
    $text.AddString('PSQL', $family, 1, $size * 0.30, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $fmt)
  } else {
    $half = $size / 2.0
    $em = $size * 0.50
    $text.AddString('PS', $family, 1, $em, (New-Object System.Drawing.RectangleF 0, ($size * 0.02), $size, $half), $fmt)
    $text.AddString('QL', $family, 1, $em, (New-Object System.Drawing.RectangleF 0, ($half - $size * 0.04), $size, $half), $fmt)
  }
  $g.FillPath([System.Drawing.Brushes]::White, $text)
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  if ($size -ge 256) {
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    # Classic 32-bit DIB entry (header + bottom-up BGRA + empty AND mask); System.Drawing can't read small PNG entries.
    $bw = New-Object System.IO.BinaryWriter $ms
    $bw.Write([UInt32]40); $bw.Write([Int32]$size); $bw.Write([Int32]($size * 2))
    $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]0)
    $bw.Write([UInt32]($size * $size * 4)); $bw.Write([Int32]0); $bw.Write([Int32]0); $bw.Write([UInt32]0); $bw.Write([UInt32]0)
    for ($y = $size - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $size; $x++) {
        $c = $bmp.GetPixel($x, $y)
        $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A)
      }
    }
    $maskRow = [int]([Math]::Ceiling($size / 32.0) * 4)
    $bw.Write((New-Object byte[] ($maskRow * $size)))
    $bw.Flush()
  }
  $bmp.Dispose()
  return ,$ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = $sizes | ForEach-Object { ,(New-LogoPng $_) }

$out = Join-Path $PSScriptRoot 'postadmin.ico'
$fs = [System.IO.File]::Create($out)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length
  $bw.Write([byte]($s % 256)); $bw.Write([byte]($s % 256))
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset)
  $offset += $len
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()

# Preview PNG for docs/review.
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'logo-256.png'), $pngs[-1])
Write-Output "Wrote $out"
