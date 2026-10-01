#Requires -Version 7
<#
.SYNOPSIS
    Re-exports the shared parts of the live ~/.claude setup into kit/.

.DESCRIPTION
    Reads tools/export.json. Every `mirror` path is copied from its live source into a
    staging directory, `substitutions` are applied ({HOME} expands to this machine's
    profile path in its \, \\ and / spellings), then the `replacements` from the local
    tools/denylist.local.json. tools/scan.ps1 runs over the staging copy; only a clean
    scan lets anything reach kit/. Mirrored directories are replaced whole, so files
    deleted upstream disappear here too. `curated` paths are never written.

.PARAMETER WhatIf
    List source -> destination for every mirror path and fail on any missing source.
    Writes nothing.

.PARAMETER Check
    Build and scan the staging copy, then exit 1 if it differs from kit/. Writes nothing
    to kit/. Use it to see whether the repo has drifted from the live setup.
#>
param(
    [switch] $WhatIf,
    [switch] $Check
)

$ErrorActionPreference = 'Stop'
$repo   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$config = Get-Content (Join-Path $PSScriptRoot 'export.json') -Raw | ConvertFrom-Json
$claude = Join-Path $HOME '.claude'

function Resolve-Source([string] $kitPath) {
    $override = $config.sources.PSObject.Properties[$kitPath]
    if ($override) { return $override.Value }
    $rel = $kitPath.Substring('kit/'.Length).TrimEnd('/') -replace '/', '\'
    Join-Path $claude $rel
}

# --- Resolve the map; a missing source is always fatal -----------------------------
$entries = foreach ($kitPath in $config.mirror) {
    [pscustomobject]@{
        KitPath = $kitPath
        IsDir   = $kitPath.EndsWith('/')
        Source  = Resolve-Source $kitPath
    }
}
$missing = $entries | Where-Object { -not (Test-Path -LiteralPath $_.Source) }
if ($WhatIf) {
    foreach ($e in $entries) { '{0} <- {1}' -f $e.KitPath, $e.Source }
    "$(@($entries).Count) entries"
}
if ($missing) {
    foreach ($m in $missing) { Write-Host "missing source: $($m.Source) (for $($m.KitPath))" -ForegroundColor Red }
    exit 1
}
if ($WhatIf) { exit 0 }

# --- Stage ------------------------------------------------------------------------
$stage = Join-Path ([IO.Path]::GetTempPath()) "claude-setup-export-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stage | Out-Null

function Test-Excluded([IO.FileSystemInfo] $item, [string] $baseDir) {
    $rel = [IO.Path]::GetRelativePath($baseDir, $item.FullName)
    foreach ($seg in $rel -split '[\\/]') {
        foreach ($pattern in $config.exclude) { if ($seg -like $pattern) { return $true } }
    }
    $false
}

function Test-Bom([string] $path) {
    $b = [IO.File]::ReadAllBytes($path)
    $b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF
}

# Hash of the content with line endings normalised, so a CRLF checkout of an LF file
# is not drift. A BOM still counts: PowerShell 5.1 reads a BOM-less script as ANSI.
function Get-TextHash([string] $path) {
    $text = [IO.File]::ReadAllText($path).Replace("`r`n", "`n")
    $bytes = [Text.Encoding]::UTF8.GetBytes("$(Test-Bom $path)|$text")
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
}

try {
    foreach ($e in $entries) {
        $dest = Join-Path $stage ($e.KitPath.TrimEnd('/') -replace '/', '\')
        if ($e.IsDir) {
            Get-ChildItem -LiteralPath $e.Source -Recurse -File -Force |
                Where-Object { -not (Test-Excluded $_ $e.Source) } |
                ForEach-Object {
                    $target = Join-Path $dest ([IO.Path]::GetRelativePath($e.Source, $_.FullName))
                    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
                    Copy-Item -LiteralPath $_.FullName -Destination $target
                }
        } else {
            New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
            Copy-Item -LiteralPath $e.Source -Destination $dest
        }
    }

    # --- Substitute ---------------------------------------------------------------
    $pairs = [System.Collections.Generic.List[object]]::new()
    foreach ($s in $config.substitutions) {
        if ($s.from -eq '{HOME}') {
            $homeBack = $HOME.TrimEnd('\')
            $to = $s.to
            # Longest spelling first so \\ is not half-replaced by the \ form.
            $pairs.Add(@($homeBack.Replace('\', '\\'), $to.Replace('\', '\\')))
            $pairs.Add(@($homeBack, $to))
            $pairs.Add(@($homeBack.Replace('\', '/'), $to))
        } else {
            $pairs.Add(@($s.from, $s.to))
        }
    }
    $denyFile = Join-Path $PSScriptRoot 'denylist.local.json'
    $replacements = if (Test-Path $denyFile) { @((Get-Content $denyFile -Raw | ConvertFrom-Json).replacements) } else { @() }

    foreach ($f in Get-ChildItem -LiteralPath $stage -Recurse -File) {
        $kitRel = [IO.Path]::GetRelativePath($stage, $f.FullName) -replace '\\', '/'
        $text = [IO.File]::ReadAllText($f.FullName)
        # kit/ is always LF. Live sources mix LF and CRLF, and git's autocrlf rewrites
        # endings on checkout anyway, so endings carry no meaning here.
        $new = $text.Replace("`r`n", "`n")
        foreach ($p in $pairs) {
            $new = [regex]::Replace($new, [regex]::Escape($p[0]), $p[1].Replace('$', '$$'), 'IgnoreCase')
        }
        foreach ($r in $replacements) {
            if ($r -and $r.file -eq $kitRel) { $new = $new.Replace($r.from, $r.to) }
        }
        if ($new -ne $text) { [IO.File]::WriteAllText($f.FullName, $new, [Text.UTF8Encoding]::new((Test-Bom $f.FullName))) }
    }

    # --- Scan -----------------------------------------------------------------------
    & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'scan.ps1') -Root $stage
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'export: scan failed - kit/ left unchanged. Add a replacement to tools/denylist.local.json or stop and review.' -ForegroundColor Red
        exit 1
    }

    # --- Compare / write ------------------------------------------------------------
    $drift = [System.Collections.Generic.List[string]]::new()
    foreach ($e in $entries) {
        $rel = $e.KitPath.TrimEnd('/') -replace '/', '\'
        $staged = Join-Path $stage $rel
        $kit    = Join-Path $repo $rel
        $a = if (Test-Path $staged) { Get-ChildItem -LiteralPath $staged -Recurse -File -Force } else { @() }
        $b = if (Test-Path $kit)    { Get-ChildItem -LiteralPath $kit    -Recurse -File -Force } else { @() }
        $hashA = @{}; foreach ($x in $a) { $hashA[[IO.Path]::GetRelativePath($stage, $x.FullName)] = Get-TextHash $x.FullName }
        $hashB = @{}; foreach ($x in $b) { $hashB[[IO.Path]::GetRelativePath($repo,  $x.FullName)] = Get-TextHash $x.FullName }
        foreach ($k in $hashA.Keys) { if ($hashB[$k] -ne $hashA[$k]) { $drift.Add($k) } }
        foreach ($k in $hashB.Keys) { if (-not $hashA.ContainsKey($k)) { $drift.Add("$k (deleted upstream)") } }
    }

    if ($Check) {
        if ($drift.Count) {
            $drift | ForEach-Object { "drift: $_" }
            Write-Host "export -Check: $($drift.Count) file(s) differ from live" -ForegroundColor Yellow
            exit 1
        }
        Write-Host 'export -Check: kit/ matches live'
        exit 0
    }

    foreach ($e in $entries) {
        $rel = $e.KitPath.TrimEnd('/') -replace '/', '\'
        $kit = Join-Path $repo $rel
        if (Test-Path $kit) { Remove-Item -LiteralPath $kit -Recurse -Force }
        New-Item -ItemType Directory -Force -Path (Split-Path $kit) | Out-Null
        Copy-Item -LiteralPath (Join-Path $stage $rel) -Destination $kit -Recurse
    }
    $drift | ForEach-Object { "updated: $_" }
    Write-Host "export: $($drift.Count) file(s) changed in kit/"
    exit 0
}
finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
