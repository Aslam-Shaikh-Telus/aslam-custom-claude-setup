#Requires -Version 7
<#
.SYNOPSIS
    Refuses content that must not leave the author's machine: colleague names and other
    denied terms, absolute user-profile paths, and secret-shaped strings.

.DESCRIPTION
    Rules, all case-insensitive:
      1. Every `terms` entry in tools/denylist.local.json and every `names` entry in
         ~/.claude/hooks/personal-terms.json, matched literally (word-bounded where the
         term starts or ends with a word character). Hits print as term#N so the
         report itself does not leak the term.
      2. Absolute user-profile paths (C:\Users\<name>, and the JSON-escaped form).
         Placeholders such as %USERPROFILE%, <HOME> and $env:... are allowed.
      3. Secret shapes ported from ~/.claude/hooks/guard-commands.js SECRET_PATTERNS.

    Either term file may be absent (a coworker's clone has neither); rules 2-3 still run.

.PARAMETER Root
    Directory to scan. Defaults to the repo root.

.OUTPUTS
    One line per hit: <relative path>:<line>: <rule>. Exit 1 on any hit, else 0.
#>
param(
    [string] $Root = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path

$denyFile  = Join-Path $PSScriptRoot 'denylist.local.json'
$namesFile = Join-Path $HOME '.claude\hooks\personal-terms.json'

function Get-TermRegex([string] $term) {
    $escaped = [regex]::Escape($term)
    $lead  = if ($term -match '^\w') { '\b' } else { '' }
    $trail = if ($term -match '\w$') { '\b' } else { '' }
    [regex]::new("$lead$escaped$trail", 'IgnoreCase')
}

$terms = [System.Collections.Generic.List[string]]::new()
foreach ($pair in @(@($denyFile, 'terms'), @($namesFile, 'names'))) {
    $file, $key = $pair
    if (Test-Path $file) {
        $json = Get-Content $file -Raw | ConvertFrom-Json
        foreach ($t in @($json.$key)) { if ($t) { $terms.Add([string]$t) } }
    } else {
        Write-Warning "$file not found - name checks skipped"
    }
}

$rules = [System.Collections.Generic.List[object]]::new()
for ($i = 0; $i -lt $terms.Count; $i++) {
    $rules.Add([pscustomobject]@{ Regex = (Get-TermRegex $terms[$i]); Label = "denied term#$($i + 1)" })
}
$rules.Add([pscustomobject]@{ Regex = [regex]::new('[A-Za-z]:\\+Users\\+(?!%|<|\$)[^\\\s"''`]+', 'IgnoreCase'); Label = 'absolute user path' })
$secretPatterns = @(
    @('\bAKIA[0-9A-Z]{16}\b', 'possible AWS access key ID'),
    @('-----BEGIN [A-Z ]*PRIVATE KEY-----', 'possible private key block'),
    @('\bxox[baprs]-[A-Za-z0-9-]{10,}', 'possible Slack token'),
    @('\bgh[pousr]_[A-Za-z0-9]{20,}\b', 'possible GitHub token'),
    @('\b(password|passwd|secret|api[_-]?key)\s*[:=]\s*["'']?[^\s"''{}$<>]{8,}', 'possible inline credential assignment')
)
foreach ($p in $secretPatterns) {
    $rules.Add([pscustomobject]@{ Regex = [regex]::new($p[0], 'IgnoreCase'); Label = $p[1] })
}

$skip = @(
    [IO.Path]::GetFullPath($denyFile)
)
$files = Get-ChildItem -LiteralPath $Root -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch '[\\/]\.git([\\/]|$)' -and $skip -notcontains $_.FullName }

$hits = 0
foreach ($f in $files) {
    $rel = [IO.Path]::GetRelativePath($Root, $f.FullName)
    $lines = [IO.File]::ReadAllLines($f.FullName)
    for ($n = 0; $n -lt $lines.Length; $n++) {
        foreach ($rule in $rules) {
            if ($rule.Regex.IsMatch($lines[$n])) {
                "${rel}:$($n + 1): $($rule.Label)"
                $hits++
            }
        }
    }
}

if ($hits) {
    Write-Host "scan: $hits hit(s) under $Root" -ForegroundColor Red
    exit 1
}
Write-Host "scan: clean ($($files.Count) files, $($rules.Count) rules)"
exit 0
