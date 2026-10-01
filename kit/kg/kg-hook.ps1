# Generic SessionStart hook: injects registered knowledge-graph context when the
# session directory matches a KG's pattern. Registry-driven — adding a new project
# KG means adding a registry entry, never editing this script or settings.json.
#
# Registry: ~/.claude/kg/registry.json — array of
#   { "name": "...", "path": "<abs KG clone>", "match": "<regex vs cwd>",
#     "index": "index.md", "branch": "kg/<user>" }
#
# Installed to ~/.claude/kg/kg-hook.ps1 by any KG repo's .claude-kit/setup.ps1.
# Must NEVER fail a session start: on any error it exits 0 with no output.

$ErrorActionPreference = 'SilentlyContinue'

try {
    # Claude Code passes hook input as JSON on stdin; cwd is the session directory.
    $cwd = $null
    $raw = [Console]::In.ReadToEnd()
    if ($raw) {
        $payload = $raw | ConvertFrom-Json
        if ($payload -and $payload.cwd) { $cwd = [string]$payload.cwd }
    }
    if (-not $cwd) { $cwd = (Get-Location).Path }

    $registryPath = Join-Path $env:USERPROFILE '.claude\kg\registry.json'
    if (-not (Test-Path $registryPath)) { exit 0 }

    # Windows PowerShell 5.1's ConvertFrom-Json does NOT enumerate a JSON array down the
    # pipeline — it emits the whole array as a single object. Written as
    # `@(Get-Content ... | ConvertFrom-Json)` this yields a ONE-element array wrapping the
    # real array, so `foreach` iterates once with $kg bound to every entry at once:
    # $kg.match then returns ALL patterns, which stringify into one bogus regex and make
    # unrelated directories match (or not) at random. Harmless with a single registered KG,
    # silently wrong with two or more. Parse into a variable first, then flatten.
    $registryRaw = Get-Content $registryPath -Raw
    if (-not $registryRaw -or -not $registryRaw.Trim()) { exit 0 }
    $registryParsed = ConvertFrom-Json $registryRaw
    $registry = [Object[]]@($registryParsed)

    foreach ($kg in $registry) {
        if (-not $kg.match -or -not $kg.path) { continue }
        if ($cwd -notmatch $kg.match) { continue }

        Write-Output "# Knowledge graph: $($kg.name)"
        Write-Output "Location: $($kg.path)"
        Write-Output ""

        # Inside the KG repo itself its CLAUDE.md already imports the index,
        # so emit nothing beyond the header there rather than loading it twice.
        $kgRoot = $kg.path.TrimEnd('\', '/')
        $insideKg = $cwd.TrimEnd('\', '/') -like "$kgRoot*"

        if (-not $insideKg) {
            $indexFile = Join-Path $kg.path $kg.index
            if (Test-Path $indexFile) {
                Write-Output (Get-Content $indexFile -Raw)
                Write-Output ""
            }
        }
    }
} catch {
    # Swallow everything — a broken hook must not break session startup.
}
exit 0
