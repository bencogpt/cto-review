<#
.SYNOPSIS
  CTO Review replica - publish a JSON file to the shared server folder data\updates (SPEC 9.10).

.DESCRIPTION
  Every visitor's browser reads data\updates\manifest.json on each page load and merges the files it lists.
  IIS does not list folders, so this script copies the file into data\updates and rewrites manifest.json
  from all *.json files in that folder (manifest.json excluded), sorted by date.
  Windows PowerShell 5.1 compatible, no extra modules.

.EXAMPLE
  .\add-update.ps1 -File C:\Downloads\cto-review-update-2026-11-19.json -SiteRoot C:\inetpub\wwwroot\cto-review
.EXAMPLE
  .\add-update.ps1 -Remove cto-review-update-2026-11-19.json -SiteRoot C:\inetpub\wwwroot\cto-review
.EXAMPLE
  .\add-update.ps1 -Rebuild -SiteRoot C:\inetpub\wwwroot\cto-review
  (-SiteRoot defaults to the folder above this script, i.e. the site when the script sits in <site>\tools\)
#>
[CmdletBinding(DefaultParameterSetName = 'Add')]
param(
  [Parameter(ParameterSetName = 'Add', Mandatory = $true)][string]$File,
  [Parameter(ParameterSetName = 'Remove', Mandatory = $true)][string]$Remove,
  [Parameter(ParameterSetName = 'Rebuild', Mandatory = $true)][switch]$Rebuild,
  [string]$SiteRoot
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$SafeName = '^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$'
$MaxBytes = 25MB

function Fail([string]$msg) { Write-Host "refusing: $msg" -ForegroundColor Red; exit 1 }
function Has($o, [string]$name) { return ($null -ne $o) -and ($o -is [psobject]) -and ($o.PSObject.Properties.Name -contains $name) }
function Get($o, [string]$name) { if (Has $o $name) { return $o.$name } return $null }
function IsHttp($u) { return ($u -is [string]) -and ($u.Trim() -match '^(?i)https?://') }
function DateText($v) { # ConvertFrom-Json may turn ISO strings into [datetime] in some hosts: keep text
  if ($null -eq $v) { return '' }
  if ($v -is [datetime]) { return $v.ToString('yyyy-MM-ddTHH:mm:sszzz') }
  return [string]$v
}

function Test-Brief($b) {
  if ((Get $b 'format_version') -ne '2-layered') { return 'brief: format_version is not 2-layered' }
  $d = DateText (Get $b 'date')
  if ($d -notmatch '^\d{4}-\d{2}-\d{2}$') { return 'brief: no ISO date (YYYY-MM-DD)' }
  $items = @(Get $b 'items')
  if (-not (Has $b 'items') -or $items.Count -eq 0 -or $null -eq $items[0]) { return 'brief: items is missing or empty' }
  foreach ($it in $items) {
    foreach ($s in @(Get $it 'sources')) {
      $u = Get $s 'url'
      if ($u -and -not (IsHttp $u)) { return 'brief: a source link is not http(s)' }
    }
  }
  return $null
}

# -> @{ kind; date; generated_at } or throws with the reason
function Get-Kind($o) {
  if ($o -is [array]) { throw 'not a CTO Review file (a JSON array)' }
  $fmt = Get $o 'format'
  if ($fmt -eq 'cto-review-update') {
    if ((Get $o 'format_version') -ne 1) { throw 'update: unsupported format_version' }
    $e = Test-Brief (Get $o 'brief'); if ($e) { throw "update $e" }
    return @{ kind = 'update'; date = (DateText $o.brief.date); generated_at = (DateText (Get $o 'generated_at')) }
  }
  if ($fmt -eq 'cto-review-export') {
    if ((Get $o 'format_version') -ne 1 -or -not (Has $o 'briefs')) { throw 'export: unsupported format_version or no briefs' }
    $dates = @()
    foreach ($b in @($o.briefs)) { $e = Test-Brief $b; if ($e) { throw "export $e" }; $dates += (DateText $b.date) }
    $last = ''; if ($dates.Count) { $last = ($dates | Sort-Object)[-1] }
    return @{ kind = 'export'; date = $last; generated_at = (DateText (Get $o 'generated_at')) }
  }
  if (((Get $o 'format_version') -eq '2-layered') -and (Has $o 'date')) {
    $e = Test-Brief $o; if ($e) { throw $e }
    return @{ kind = 'brief'; date = (DateText $o.date); generated_at = (DateText (Get $o 'generated_at')) }
  }
  if ((Has $o 'entries') -and -not (Has $o 'sources')) {
    foreach ($x in @($o.entries)) {
      foreach ($k in 'key', 'term', 'category', 'definition_he') { if (-not ((Get $x $k) -is [string]) -or -not (Get $x $k)) { throw "glossary: an entry misses $k" } }
      $u = Get $x 'url'; if ($u -and -not (IsHttp $u)) { throw 'glossary: a link is not http(s)' }
    }
    $g = DateText (Get $o 'generated_at'); if (-not $g) { $g = DateText (Get $o 'updated') }
    return @{ kind = 'glossary'; date = ''; generated_at = $g }
  }
  if ((Has $o 'sources') -and -not (Has $o 'entries') -and -not (Has $o 'briefs')) {
    foreach ($s in @($o.sources)) { if (-not (Get $s 'id') -or -not (IsHttp (Get $s 'url'))) { throw 'sources: a source has no id or no http(s) url' } }
    return @{ kind = 'sources'; date = ''; generated_at = (DateText (Get $o 'updated')) }
  }
  throw 'not a CTO Review file (update, export, brief, glossary or sources)'
}

function Read-Json([string]$path) {
  if ((Get-Item -LiteralPath $path).Length -gt $MaxBytes) { throw 'file is larger than 25 MB' }
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) # strips a BOM
  return ($text | ConvertFrom-Json)
}

function JStr([string]$s) { # JSON string literal (names/kinds/dates are plain ASCII, but escape anyway)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($ch -eq '"') { [void]$sb.Append('\"') } elseif ($ch -eq '\') { [void]$sb.Append('\\') }
    elseif ($c -lt 32 -or $c -gt 126) { [void]$sb.Append(('\u{0:x4}' -f $c)) } else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

function Write-Manifest([string]$folder) {
  $entries = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File | Sort-Object Name)) {
    if ($f.Name -ieq 'manifest.json' -or $f.Name -cnotmatch $SafeName) { continue }
    try { $k = Get-Kind (Read-Json $f.FullName) } catch { Write-Host "warning: not listed (invalid): $($f.Name): $($_.Exception.Message)" -ForegroundColor Yellow; continue }
    $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $sortDate = $k.date; if (-not $sortDate) { $sortDate = '0000' }
    $entries += New-Object psobject -Property @{ name = $f.Name; kind = $k.kind; date = $k.date; generated_at = $k.generated_at;
                                                  size = [long]$f.Length; sha256 = $hash; sortkey = "$sortDate|$($k.generated_at)|$($f.Name)" }
  }
  $entries = @($entries | Sort-Object sortkey)
  $now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('{')
  $lines.Add(' "format": "cto-review-updates-manifest",')
  $lines.Add(' "format_version": 1,')
  $lines.Add(' "files": [' + ((@($entries | ForEach-Object { JStr $_.name })) -join ', ') + '],')
  $lines.Add(' "entries": [')
  for ($i = 0; $i -lt $entries.Count; $i++) {
    $e = $entries[$i]
    $comma = ''; if ($i -lt $entries.Count - 1) { $comma = ',' }
    $lines.Add('  {"name": ' + (JStr $e.name) + ', "kind": ' + (JStr $e.kind) + ', "date": ' + (JStr $e.date) + ', "generated_at": ' + (JStr $e.generated_at) +
               ', "size": ' + $e.size + ', "sha256": ' + (JStr $e.sha256) + '}' + $comma)
  }
  $lines.Add(' ],')
  $lines.Add(' "generated_at": ' + (JStr $now))
  $lines.Add('}')
  $tmp = Join-Path $folder 'manifest.json.tmp'
  [System.IO.File]::WriteAllText($tmp, (($lines -join "`n") + "`n"), $Utf8NoBom)
  Move-Item -LiteralPath $tmp -Destination (Join-Path $folder 'manifest.json') -Force
  return @($entries | ForEach-Object { $_.name })
}

if (-not $SiteRoot) { $SiteRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$SiteRoot = [System.IO.Path]::GetFullPath($SiteRoot)
if (-not (Test-Path -LiteralPath (Join-Path $SiteRoot 'index.html'))) { Fail "$SiteRoot has no index.html (is it the site folder?)" }
$folder = Join-Path (Join-Path $SiteRoot 'data') 'updates'
if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }

if ($PSCmdlet.ParameterSetName -eq 'Add') {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { Fail "$File not found" }
  $src = (Resolve-Path -LiteralPath $File).ProviderPath
  $name = [System.IO.Path]::GetFileName($src)
  if ($name -cnotmatch $SafeName -or $name -ieq 'manifest.json') { Fail "file name '$name' must be letters, digits, . _ - and end with .json" }
  try { $k = Get-Kind (Read-Json $src) } catch { Fail "$name is not a valid CTO Review file: $($_.Exception.Message)" }
  $dst = Join-Path $folder $name
  if ($src -ne $dst) {
    $part = "$dst.part"
    Copy-Item -LiteralPath $src -Destination $part -Force
    Move-Item -LiteralPath $part -Destination $dst -Force
  }
  $d = ''; if ($k.date) { $d = ", $($k.date)" }
  Write-Host "published $name ($($k.kind)$d) -> $dst"
} elseif ($PSCmdlet.ParameterSetName -eq 'Remove') {
  $name = [System.IO.Path]::GetFileName($Remove)
  if ($name -cnotmatch $SafeName -or $name -ieq 'manifest.json') { Fail "bad file name '$name'" }
  $p = Join-Path $folder $name
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Host "removed $name" } else { Write-Host "$name was not in $folder" }
}
$files = @(Write-Manifest $folder)
Write-Host ("manifest.json: {0} file(s): {1}" -f $files.Count, ($files -join ', '))
