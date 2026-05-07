# Batch convert all Mixamo animation packs in
# Assets\models\animations\runner\<pack>\*.fbx to GLB.
#
# Skips: the Meshy_AI Sentinel mesh files (one shipped with each pack -
# the mesh, not an animation; we already have peek.glb as the rig).
#
# Output: Assets\models\animations\runner_glb\<pack-slug>\<anim-slug>.glb
#
# Run from the cold-exit project root:
#     powershell -File tools\convert-runner-packs.ps1
#
# Honors a -Resume switch that skips clips whose GLB already exists.

param([switch]$Resume)

$root = 'Assets\models\animations\runner'
$out  = 'Assets\models\animations\runner_glb'

$packMap = @{
  'Basic Shooter Pack'             = 'basic-shooter'
  'Pistol_Handgun Locomotion Pack' = 'pistol-locomotion'
  'Rifle 8-Way Locomotion Pack'    = 'rifle-8way'
  'Shooter Pack'                   = 'shooter'
  'Slim Shooter Pack'              = 'slim-shooter'
}

function Slug([string]$s) {
  $s = $s.ToLower()
  $s = $s -replace '\.fbx$',''
  $s = $s -replace '[\s_]+','-'
  $s = $s -replace '[()]',''
  $s = $s -replace '[^a-z0-9\-]',''
  $s = $s -replace '-+','-'
  return $s.Trim('-')
}

$total = 0
$converted = 0
$skipped = 0
$failed = 0
$startTime = Get-Date

foreach ($pack in $packMap.Keys) {
  $packDir = Join-Path $root $pack
  if (-not (Test-Path $packDir)) { Write-Output "[skip-pack] $pack"; continue }
  $slug = $packMap[$pack]
  $outDir = Join-Path $out $slug
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $fbxFiles = Get-ChildItem -Path $packDir -Filter '*.fbx'
  foreach ($f in $fbxFiles) {
    if ($f.Name -like 'Meshy_AI_*') { continue }   # mesh, not anim
    $total++
    $clipSlug = Slug $f.BaseName
    $dst = Join-Path $outDir "$clipSlug.glb"
    if ($Resume -and (Test-Path $dst)) { $skipped++; continue }
    $args = @('--in', $f.FullName, '--out', $dst, '--strip-root-motion')
    Write-Output "[$total] $slug/$clipSlug"
    $log = & 'tools\blender-fbx-to-glb.bat' @args 2>&1
    if (Test-Path $dst) {
      $converted++
    } else {
      $failed++
      Write-Output "  FAIL - last lines:"
      $log | Select-Object -Last 5 | ForEach-Object { Write-Output "    $_" }
    }
  }
}

$elapsed = (Get-Date) - $startTime
Write-Output ""
Write-Output "=== runner pack conversion complete ==="
Write-Output "total: $total"
Write-Output "converted: $converted"
Write-Output "skipped (resume): $skipped"
Write-Output "failed: $failed"
$mm = $elapsed.Minutes
$ss = $elapsed.Seconds
Write-Output "elapsed: $mm m $ss s"
