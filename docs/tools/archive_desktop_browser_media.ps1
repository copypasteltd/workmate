param(
  [string[]]$BareAttempts = @('02','03','05','06','07','08','09','10','11','12','13','14','15'),
  [string[]]$UiAttempts = @('22','23'),
  [string]$ReceiptName = 'desktop-browser-media-relocation-01.json'
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath 'D:\dev\copypasted\自有agent').Path
Set-Location -LiteralPath $workspace
$desktop = Join-Path $workspace 'dev\copypaste-desktop'
$delivery = Join-Path $workspace 'dev\copypaste-delivery'
$sourceDirectory = Join-Path $desktop 'assets\screenshots'
$archiveDirectory = Join-Path $delivery ('.data\desktop-browser-media-history\' + [guid]::NewGuid().ToString())
$receiptPath = Join-Path $workspace ('docs\quality\' + $ReceiptName)
if (Test-Path -LiteralPath $receiptPath) { throw 'Preserve the previous relocation receipt.' }
foreach ($attempt in @($BareAttempts) + @($UiAttempts)) {
  if ($attempt -notmatch '^\d{2}$') { throw 'Use explicit two-digit attempt numbers.' }
}
$tracked = @(& git -C $desktop -c core.fsmonitor=false -c core.untrackedCache=false ls-files -- assets/screenshots)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Desktop index.' }
$selected = @()
foreach ($file in Get-ChildItem -LiteralPath $sourceDirectory -File) {
  $matchesBare = @($BareAttempts | Where-Object { $file.Name -match ('^workmate-(?:browser-' + $_ + '-|'+ $_ + '-native-browser\.)') }).Count -gt 0
  $matchesUi = @($UiAttempts | Where-Object { $file.Name -match ('^workmate-local-' + $_ + '-') }).Count -gt 0
  if (!$matchesBare -and !$matchesUi) { continue }
  if ($tracked -contains ('assets/screenshots/' + $file.Name)) { throw 'Refuse to relocate published media.' }
  $target = [IO.Path]::GetFullPath((Join-Path $archiveDirectory $file.Name))
  foreach ($verifiedPath in @($file.FullName, $target)) {
    if (!$verifiedPath.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path left the authorized workspace.' }
  }
  if (Test-Path -LiteralPath $target) { throw 'Never overwrite retained media.' }
  $selected += [ordered]@{
    original_path = $file.FullName.Substring($workspace.Length + 1).Replace('\','/')
    archive_path = $target.Substring($workspace.Length + 1).Replace('\','/')
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = $file.Length
  }
}
New-Item -ItemType Directory -Path $archiveDirectory | Out-Null
foreach ($item in $selected) {
  $source = Join-Path $workspace $item.original_path
  $target = Join-Path $workspace $item.archive_path
  Move-Item -LiteralPath $source -Destination $target
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw 'Relocated bytes changed.' }
}
$receipt = [ordered]@{
  at = [DateTime]::UtcNow.ToString('o')
  status = 'preserved_unpublished_media_in_owned_ignored_archive'
  bare_attempts = $BareAttempts
  packaged_attempts = $UiAttempts
  files = $selected
  original_bytes_preserved = $true
  published_files_moved = 0
  historical_reports_rewritten = $false
  scope = 'Unpublished failed or superseded captures retain their original bytes. Historical reports retain original paths; this receipt maps them to the local ignored archive. Only selected final passing captures belong in the current README gallery.'
}
$json = $receipt | ConvertTo-Json -Depth 7
[IO.File]::WriteAllText($receiptPath, $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Output ('Preserved ' + $selected.Count + ' unpublished captures; no published files or historical reports changed.')
