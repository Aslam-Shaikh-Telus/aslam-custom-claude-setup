<#
.SYNOPSIS
    Reviews the Claude Code starter kit against your existing setup and installs
    only the components you accept.

.DESCRIPTION
    This installer advises; it does not overwrite. It surveys your ~/.claude
    directory, classifies every component as Absent / Identical / Differs /
    Blocked / Unavailable, shows you what each one would change and what it
    costs you, and asks per component. settings.json is reconciled key by key.
    CLAUDE.md is never overwritten - the kit's version is written beside yours
    as CLAUDE.md.starter-kit for you to merge by hand.

    Nothing is written until you confirm a final action list, and anything about
    to be touched is backed up first.

.PARAMETER TargetRoot
    The .claude directory to install into. Defaults to $env:USERPROFILE\.claude.

.PARAMETER Report
    Print the survey table and exit. Writes nothing, asks nothing. Use this
    first.

.PARAMETER Components
    Apply only these component ids, without per-component prompts. Everything
    else is skipped.

.PARAMETER WhatIf
    Perform a full run but write nothing. Prints the action list that a real run
    would execute.

.NOTES
    Requires PowerShell 7. Deliberately written in PowerShell 5.1-compatible
    SYNTAX so that the version check below can actually run and report the
    problem, rather than the file failing to parse under 5.1.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]   $TargetRoot,
    [switch]   $Report,
    [string[]] $Components,
    [string]   $KitRoot
)

# ---------------------------------------------------------------------------
# 1. Refuse to run on PowerShell 5.1
# ---------------------------------------------------------------------------

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host ''
    Write-Host 'This installer requires PowerShell 7.' -ForegroundColor Red
    Write-Host ("You are running PowerShell {0}." -f $PSVersionTable.PSVersion)
    Write-Host ''
    Write-Host 'PowerShell 5.1 mangles this kit in ways that matter: ConvertFrom-Json'
    Write-Host 'does not enumerate arrays the way the hooks expect, and piping to a'
    Write-Host 'native process prepends a UTF-8 BOM that breaks JSON parsing on the'
    Write-Host 'other side. Install PowerShell 7 and re-run with pwsh:'
    Write-Host ''
    Write-Host '    winget install --id Microsoft.PowerShell --source winget'
    Write-Host '    pwsh -File INSTALL.ps1 -Report'
    Write-Host ''
    exit 2
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $KitRoot)    { $KitRoot    = $PSScriptRoot }
if (-not $TargetRoot) { $TargetRoot = Join-Path $env:USERPROFILE '.claude' }

$script:DryRun = [bool]$WhatIfPreference
$script:NonInteractive = [Console]::IsInputRedirected -or (-not [Environment]::UserInteractive)

# ---------------------------------------------------------------------------
# 2. Small helpers
# ---------------------------------------------------------------------------

function Write-Head {
    param([string] $Text)
    Write-Host ''
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ('-' * $Text.Length) -ForegroundColor DarkCyan
}

function Write-Wrapped {
    param([string] $Label, [string] $Text, [ConsoleColor] $Colour = 'Gray')
    $indent = ' ' * ($Label.Length + 2)
    $width  = 76 - $Label.Length
    $words  = $Text -split '\s+'
    $line   = ''
    $first  = $true
    foreach ($w in $words) {
        if (($line.Length + $w.Length + 1) -gt $width) {
            if ($first) { Write-Host ("{0}: {1}" -f $Label, $line) -ForegroundColor $Colour; $first = $false }
            else        { Write-Host ($indent + $line) -ForegroundColor $Colour }
            $line = $w
        }
        elseif ($line -eq '') { $line = $w }
        else { $line = $line + ' ' + $w }
    }
    if ($line -ne '') {
        if ($first) { Write-Host ("{0}: {1}" -f $Label, $line) -ForegroundColor $Colour }
        else        { Write-Host ($indent + $line) -ForegroundColor $Colour }
    }
}

# Normalised comparison: line-ending and trailing-whitespace differences are not
# real differences, and reporting them as such would train people to ignore the
# diff.
function Get-NormalisedText {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if ($null -eq $raw) { $raw = '' }
    $raw = $raw -replace "`r`n", "`n"
    return ($raw -replace "[ `t]+`n", "`n").TrimEnd()
}

function ConvertTo-KitPath {
    param([string] $Rel)
    return (Join-Path $KitRoot ($Rel -replace '/', '\')).TrimEnd('\')
}

# Only paths under kit/ are installed into the target .claude directory.
# Anything outside kit/ (docs, tools, tests) is shipped with the repo, not installed.
function ConvertTo-TargetPath {
    param([string] $Rel)
    if ($Rel -notlike 'kit/*') { return $null }
    $stripped = $Rel.Substring(4)
    return (Join-Path $TargetRoot ($stripped -replace '/', '\')).TrimEnd('\')
}

# Expand a manifest 'files' entry into concrete (kit, target) file pairs.
# A trailing '/' claims the directory and everything under it.
function Expand-ComponentFiles {
    param([string] $Rel)
    $kitPath    = ConvertTo-KitPath $Rel
    $targetPath = ConvertTo-TargetPath $Rel
    $pairs = @()

    if ($Rel.EndsWith('/')) {
        if (Test-Path -LiteralPath $kitPath -PathType Container) {
            foreach ($f in Get-ChildItem -LiteralPath $kitPath -Recurse -File) {
                $sub = $f.FullName.Substring($kitPath.Length).TrimStart('\')
                $pairs += [pscustomobject]@{
                    Rel    = ($Rel + ($sub -replace '\\', '/'))
                    Kit    = $f.FullName
                    Target = if ($targetPath) { Join-Path $targetPath $sub } else { $null }
                }
            }
        }
        else {
            # Directory not built yet - one placeholder pair so the component
            # reports Unavailable rather than silently reporting Absent.
            $pairs += [pscustomobject]@{ Rel = $Rel; Kit = $kitPath; Target = $targetPath }
        }
    }
    else {
        $pairs += [pscustomobject]@{ Rel = $Rel; Kit = $kitPath; Target = $targetPath }
    }
    return $pairs
}

# ---------------------------------------------------------------------------
# 3. Load the manifest
# ---------------------------------------------------------------------------

$manifestPath = Join-Path $KitRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Host "manifest.json not found at $manifestPath" -ForegroundColor Red
    exit 2
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

# The kit's desired settings values. Written by step B3; may be a bare {} in an
# unfinished kit, in which case every settings key is reported as unavailable
# rather than guessed at.
$kitSettingsPath = Join-Path $KitRoot ($manifest.settingsSource -replace '/', '\')
$kitSettings = $null
if (Test-Path -LiteralPath $kitSettingsPath) {
    $kitSettings = Get-Content -LiteralPath $kitSettingsPath -Raw | ConvertFrom-Json
}

$targetSettingsPath = Join-Path $TargetRoot 'settings.json'
$targetSettings = $null
if (Test-Path -LiteralPath $targetSettingsPath) {
    try { $targetSettings = Get-Content -LiteralPath $targetSettingsPath -Raw | ConvertFrom-Json }
    catch {
        Write-Host "Could not parse $targetSettingsPath - it will be treated as absent and never modified." -ForegroundColor Yellow
        Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
        $targetSettings = $null
        $script:SettingsUnparseable = $true
    }
}

function Get-JsonValue {
    param($Object, [string] $KeyPath)
    if ($null -eq $Object) { return $null }
    $node = $Object
    foreach ($part in ($KeyPath -split '\.')) {
        if ($null -eq $node) { return $null }
        $prop = $node.PSObject.Properties[$part]
        if ($null -eq $prop) { return $null }
        $node = $prop.Value
    }
    return $node
}

function Format-JsonValue {
    param($Value)
    if ($null -eq $Value) { return '<not set>' }
    if ($Value -is [string]) { return $Value }
    return (ConvertTo-Json $Value -Depth 8 -Compress)
}

# ---------------------------------------------------------------------------
# 4. Survey
# ---------------------------------------------------------------------------

function Get-FileState {
    param($Pair)
    if (-not (Test-Path -LiteralPath $Pair.Kit -PathType Leaf)) { return 'Unavailable' }
    if (-not $Pair.Target) { return 'NotInstalled' }
    if (-not (Test-Path -LiteralPath $Pair.Target -PathType Leaf)) { return 'Absent' }
    if ((Get-NormalisedText $Pair.Kit) -eq (Get-NormalisedText $Pair.Target)) { return 'Identical' }
    return 'Differs'
}

function Get-SettingsKeyStates {
    param($Component)
    $rows = @()
    if (-not $Component.PSObject.Properties['settingsKeys']) { return $rows }
    foreach ($prop in $Component.settingsKeys.PSObject.Properties) {
        $key = $prop.Name
        # 'hooks.<Event>[<Matcher>]' entries are merged as hook blocks, not as
        # scalar key paths - the kit appends its hook entry alongside yours.
        $isHook = $key.StartsWith('hooks.')
        $kitVal = if ($isHook) { $null } else { Get-JsonValue $kitSettings $key }
        $curVal = if ($isHook) { $null } else { Get-JsonValue $targetSettings $key }

        if ($isHook) {
            $state = 'Hook'
        }
        elseif ($null -eq $kitVal) {
            $state = 'Unavailable'
        }
        elseif ($null -eq $curVal) {
            $state = 'Absent'
        }
        elseif ((Format-JsonValue $kitVal) -eq (Format-JsonValue $curVal)) {
            $state = 'Identical'
        }
        else {
            $state = 'Differs'
        }

        $rows += [pscustomobject]@{
            Key       = $key
            KitValue  = $kitVal
            CurValue  = $curVal
            Rationale = $prop.Value
            State     = $state
            IsHook    = $isHook
        }
    }
    return $rows
}

$survey = @()
foreach ($c in $manifest.components) {
    $pairs = @()
    foreach ($rel in $c.files) { $pairs += Expand-ComponentFiles $rel }

    $fileStates = @()
    foreach ($p in $pairs) {
        $fileStates += [pscustomobject]@{ Pair = $p; State = (Get-FileState $p) }
    }
    $keyStates = @(Get-SettingsKeyStates $c)

    $states = @($fileStates | ForEach-Object { $_.State })
    if     ($states -contains 'Unavailable')                     { $state = 'Unavailable' }
    elseif ($states.Count -eq 0 -and $keyStates.Count -eq 0)      { $state = 'Unavailable' }
    elseif ($states -contains 'Differs')                          { $state = 'Differs' }
    elseif (@($keyStates | Where-Object { $_.State -eq 'Differs' }).Count -gt 0) { $state = 'Differs' }
    elseif ($states -contains 'Absent')                           { $state = 'Absent' }
    elseif (@($keyStates | Where-Object { $_.State -eq 'Absent' }).Count -gt 0)  { $state = 'Absent' }
    elseif ($states.Count -gt 0)                                  { $state = 'Identical' }
    elseif (@($keyStates | Where-Object { $_.State -eq 'Unavailable' }).Count -eq $keyStates.Count) { $state = 'Unavailable' }
    else                                                          { $state = 'Identical' }

    $pending = $false
    if ($c.PSObject.Properties['_pendingScan']) { $pending = [bool]$c._pendingScan }
    if ($pending) { $state = 'Unavailable' }

    $survey += [pscustomobject]@{
        Id         = $c.id
        Title      = $c.title
        Tier       = $c.tier
        Benefit    = $c.benefit
        Cost       = $c.cost
        Requires   = @($c.requires)
        Policy     = $c.conflictPolicy
        Files      = $fileStates
        Keys       = $keyStates
        State      = $state
        Pending    = $pending
        Decision   = 'skip'
    }
}

$tierOrder = @{ 'core' = 0; 'recommended' = 1; 'advanced' = 2 }
$survey = $survey | Sort-Object @{ Expression = { $tierOrder[$_.Tier] } }, Id

# ---------------------------------------------------------------------------
# 5. Report before prompting
# ---------------------------------------------------------------------------

Write-Head "Claude Code starter kit - survey of $TargetRoot"
if ($script:DryRun) { Write-Host '(-WhatIf: this run will not write anything)' -ForegroundColor Yellow }
Write-Host ''

$table = $survey | ForEach-Object {
    [pscustomobject]@{
        Component = $_.Id
        Tier      = $_.Tier
        State     = $_.State
        Policy    = $_.Policy
        Benefit   = if ($_.Benefit.Length -gt 60) { $_.Benefit.Substring(0, 57) + '...' } else { $_.Benefit }
    }
}
$table | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

Write-Host 'State: Absent = not on your machine | Identical = already matches | Differs = you have your own version'
Write-Host '       Unavailable = this kit build does not ship the files yet'
Write-Host ''
Write-Host 'Nothing above has been changed. Run without -Report to choose per component.'

if ($Report) { exit 0 }

# ---------------------------------------------------------------------------
# 6. Prompt per component
# ---------------------------------------------------------------------------

function Show-Diff {
    param($Component)
    foreach ($fs in $Component.Files) {
        if ($fs.State -ne 'Differs') { continue }
        Write-Host ''
        Write-Host ("--- diff: {0}" -f $fs.Pair.Rel) -ForegroundColor Yellow
        $git = Get-Command git -ErrorAction SilentlyContinue
        if ($git) {
            & git --no-pager diff --no-index --no-color -- $fs.Pair.Target $fs.Pair.Kit
        }
        else {
            $a = (Get-NormalisedText $fs.Pair.Target) -split "`n"
            $b = (Get-NormalisedText $fs.Pair.Kit)    -split "`n"
            Compare-Object $a $b | ForEach-Object {
                $sign = if ($_.SideIndicator -eq '=>') { '+' } else { '-' }
                Write-Host ($sign + $_.InputObject)
            }
        }
    }
    foreach ($k in $Component.Keys) {
        if ($k.State -ne 'Differs') { continue }
        Write-Host ''
        Write-Host ("--- settings key: {0}" -f $k.Key) -ForegroundColor Yellow
        Write-Host ("    yours: {0}" -f (Format-JsonValue $k.CurValue))
        Write-Host ("    kit:   {0}" -f (Format-JsonValue $k.KitValue))
    }
}

function Read-Choice {
    param([string] $Prompt, [string[]] $Valid, [string] $Default)
    if ($script:NonInteractive) {
        Write-Host ("{0} [non-interactive: {1}]" -f $Prompt, $Default) -ForegroundColor DarkGray
        return $Default
    }
    while ($true) {
        $answer = Read-Host $Prompt
        if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
        $answer = $answer.Trim().ToLower()
        if ($Valid -contains $answer) { return $answer }
        Write-Host ("Please answer one of: {0}" -f ($Valid -join ', ')) -ForegroundColor DarkYellow
    }
}

$accepted = New-Object System.Collections.Generic.HashSet[string]
$quit = $false

Write-Head 'Choosing components'
Write-Host 'Default answer is skip - pressing Enter never changes your machine.'

foreach ($c in $survey) {
    if ($quit) { break }

    if ($c.State -eq 'Unavailable') {
        $why = if ($c.Pending) { 'not sanitized yet (step A2 outstanding)' } else { 'files not present in this kit build' }
        Write-Host ''
        Write-Host ("[{0}] {1}" -f $c.Id, $c.Title) -ForegroundColor DarkGray
        Write-Host ("  Unavailable - {0}. Skipping." -f $why) -ForegroundColor DarkGray
        continue
    }

    $blockedBy = @($c.Requires | Where-Object { -not $accepted.Contains($_) })
    if ($blockedBy.Count -gt 0) {
        Write-Host ''
        Write-Host ("[{0}] {1}" -f $c.Id, $c.Title) -ForegroundColor DarkGray
        Write-Host ("  Blocked - requires {0}, which you did not accept. Skipping." -f ($blockedBy -join ', ')) -ForegroundColor DarkGray
        continue
    }

    if ($c.State -eq 'Identical') {
        Write-Host ''
        Write-Host ("[{0}] {1} - already identical, nothing to do." -f $c.Id, $c.Title) -ForegroundColor DarkGray
        $accepted.Add($c.Id) | Out-Null
        continue
    }

    Write-Host ''
    Write-Host ("[{0}] {1}  ({2}, {3}, policy: {4})" -f $c.Id, $c.Title, $c.Tier, $c.State, $c.Policy) -ForegroundColor White
    Write-Wrapped 'Benefit' $c.Benefit 'Green'
    Write-Wrapped 'Cost'    $c.Cost    'DarkYellow'

    if ($Components) {
        if ($Components -contains $c.Id) {
            $c.Decision = 'apply'
            $accepted.Add($c.Id) | Out-Null
            Write-Host '  -> apply (named on -Components)' -ForegroundColor Green
        }
        else {
            Write-Host '  -> skip (not named on -Components)' -ForegroundColor DarkGray
        }
        continue
    }

    $choice = $null
    while ($null -eq $choice) {
        $ans = Read-Choice '  [a]pply  [s]kip  [d]iff  [l]ater  [q]uit' @('a', 's', 'd', 'l', 'q') 's'
        switch ($ans) {
            'd' { Show-Diff $c }
            'a' { $choice = 'apply' }
            's' { $choice = 'skip' }
            'l' { $choice = 'later' }
            'q' { $choice = 'quit' }
        }
    }

    $c.Decision = $choice
    if ($choice -eq 'apply') { $accepted.Add($c.Id) | Out-Null }
    if ($choice -eq 'quit')  { $quit = $true }
}

if ($quit) {
    Write-Host ''
    Write-Host 'Quit before writing anything. Your setup is unchanged.' -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------------------
# 7. Build the action list
# ---------------------------------------------------------------------------

$actions   = @()
$sideBySide = @()
$keyActions = @()

foreach ($c in $survey) {
    if ($c.Decision -ne 'apply') { continue }

    foreach ($fs in $c.Files) {
        if ($fs.State -in @('Unavailable', 'NotInstalled', 'Identical')) { continue }
        if ($c.Policy -eq 'side-by-side') {
            $dest = $fs.Pair.Target
            if ($fs.State -eq 'Differs') { $dest = $fs.Pair.Target + '.starter-kit' }
            $sideBySide += [pscustomobject]@{
                Component = $c.Id; Source = $fs.Pair.Kit; Dest = $dest
                Overwrote = ($fs.State -eq 'Differs')
            }
            $actions += [pscustomobject]@{
                Component = $c.Id
                Verb      = if ($fs.State -eq 'Differs') { 'write beside yours' } else { 'create' }
                Path      = $dest
                Source    = $fs.Pair.Kit
                Backup    = ($fs.State -ne 'Absent' -and $fs.State -ne 'Differs')
            }
        }
        else {
            $actions += [pscustomobject]@{
                Component = $c.Id
                Verb      = if ($fs.State -eq 'Absent') { 'create' } else { 'replace' }
                Path      = $fs.Pair.Target
                Source    = $fs.Pair.Kit
                Backup    = ($fs.State -eq 'Differs')
            }
        }
    }

    # settings.json: reconcile key by key, never file by file.
    foreach ($k in $c.Keys) {
        if ($k.IsHook) {
            if (-not $kitSettings -or -not $kitSettings.PSObject.Properties['hooks']) {
                Write-Host ("  note: {0} needs settings key '{1}', but kit/settings.json does not define it yet (step B3). Skipping that key." -f $c.Id, $k.Key) -ForegroundColor DarkYellow
                continue
            }
            $keyActions += [pscustomobject]@{ Component = $c.Id; Key = $k.Key; Kind = 'hook'; NewValue = $null; OldValue = $null }
            continue
        }
        if ($k.State -in @('Identical', 'Unavailable')) {
            if ($k.State -eq 'Unavailable') {
                Write-Host ("  note: {0} needs settings key '{1}', but kit/settings.json does not define it yet (step B3). Skipping that key." -f $c.Id, $k.Key) -ForegroundColor DarkYellow
            }
            continue
        }
        if ($k.State -eq 'Absent') {
            $keyActions += [pscustomobject]@{ Component = $c.Id; Key = $k.Key; Kind = 'set'; NewValue = $k.KitValue; OldValue = $null }
            continue
        }

        # Differs - ask, per key, showing both values and why they differ.
        Write-Host ''
        Write-Host ("  settings key in conflict: {0}" -f $k.Key) -ForegroundColor Yellow
        Write-Host ("    your value: {0}" -f (Format-JsonValue $k.CurValue))
        Write-Host ("    kit value:  {0}" -f (Format-JsonValue $k.KitValue))
        Write-Wrapped '    why' $k.Rationale 'DarkGray'
        $ans = Read-Choice '    take the kit value? [y]es / [n]o (keep yours)' @('y', 'n') 'n'
        if ($ans -eq 'y') {
            $keyActions += [pscustomobject]@{ Component = $c.Id; Key = $k.Key; Kind = 'set'; NewValue = $k.KitValue; OldValue = $k.CurValue }
        }
        else {
            Write-Host '    keeping yours.' -ForegroundColor DarkGray
        }
    }
}

$later = @($survey | Where-Object { $_.Decision -eq 'later' } | ForEach-Object { $_.Id })

# ---------------------------------------------------------------------------
# 8. Site values, for accepted components only
# ---------------------------------------------------------------------------

$siteValues = @{}
$needsProxy = @($keyActions | Where-Object { $_.Kind -eq 'set' -and (Format-JsonValue $_.NewValue) -match '__HTTPS?_PROXY__' }).Count -gt 0
$needsRoot  = $actions.Count -gt 0

if ($needsProxy) {
    Write-Head 'Site values'
    Write-Host 'The kit ships proxy values as placeholders. The default below is the'
    Write-Host 'BC-region value from the machine this kit was built on - if you are in'
    Write-Host 'another region, enter yours.'
    $default = 'http://webproxystatic-bc.tsl.telus.com:8080/'
    if ($script:NonInteractive) {
        Write-Host ("  proxy [non-interactive: {0}]" -f $default) -ForegroundColor DarkGray
        $siteValues['__HTTPS_PROXY__'] = $default
        $siteValues['__HTTP_PROXY__']  = $default
    }
    else {
        $p = Read-Host ("  HTTPS/HTTP proxy [{0}]" -f $default)
        if ([string]::IsNullOrWhiteSpace($p)) { $p = $default }
        $siteValues['__HTTPS_PROXY__'] = $p
        $siteValues['__HTTP_PROXY__']  = $p
    }
}

if ($needsRoot) {
    $defaultRoot = 'C:\GitHub'
    if ($script:NonInteractive) {
        $siteValues['__CODE_ROOT__'] = $defaultRoot
    }
    else {
        $r = Read-Host ("  code root - where your repos live [{0}]" -f $defaultRoot)
        if ([string]::IsNullOrWhiteSpace($r)) { $r = $defaultRoot }
        $siteValues['__CODE_ROOT__'] = $r
    }
}

# ---------------------------------------------------------------------------
# 9. Confirm the whole action list
# ---------------------------------------------------------------------------

Write-Head 'Action list'

if ($actions.Count -eq 0 -and $keyActions.Count -eq 0) {
    Write-Host 'Nothing to do. Your setup is unchanged.' -ForegroundColor Green
    if ($later.Count -gt 0) {
        Write-Host ''
        Write-Host ("Marked for later: {0}" -f ($later -join ', '))
        Write-Host ("Re-run with: pwsh -File INSTALL.ps1 -Components {0}" -f ($later -join ','))
    }
    exit 0
}

Write-Host 'Files:'
if ($actions.Count -eq 0) { Write-Host '  (none)' }
foreach ($a in $actions) {
    Write-Host ("  {0,-20} {1,-20} {2}" -f $a.Component, $a.Verb, $a.Path)
}
Write-Host ''
Write-Host 'settings.json keys:'
if ($keyActions.Count -eq 0) { Write-Host '  (none)' }
foreach ($k in $keyActions) {
    if ($k.Kind -eq 'hook') {
        Write-Host ("  {0,-20} merge hook entry   {1}" -f $k.Component, $k.Key)
    }
    else {
        Write-Host ("  {0,-20} set                {1} = {2}" -f $k.Component, $k.Key, (Format-JsonValue $k.NewValue))
    }
}
Write-Host ''
Write-Host 'Keys you have set that the kit does not mention are left untouched.'

if ($script:DryRun) {
    Write-Host ''
    Write-Host '-WhatIf: stopping here. Nothing was written.' -ForegroundColor Yellow
    exit 0
}

Write-Host ''
$go = Read-Choice 'Apply the list above? [y]es / [n]o' @('y', 'n') 'n'
if ($go -ne 'y') {
    Write-Host 'Nothing was written.' -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------------------
# 10. Back up, then apply
# ---------------------------------------------------------------------------

$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path (Join-Path $TargetRoot 'backups') ("pre-starter-kit-" + $stamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Write-Host ("Backups: {0}" -f $backupDir) -ForegroundColor DarkGray

function Backup-Path {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $rel = $Path
    if ($Path.StartsWith($TargetRoot, [StringComparison]::OrdinalIgnoreCase)) {
        $rel = $Path.Substring($TargetRoot.Length).TrimStart('\')
    }
    else {
        $rel = Split-Path -Leaf $Path
    }
    $dest = Join-Path $backupDir $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $Path -Destination $dest -Force
}

function Expand-SiteTokens {
    param([string] $Text)
    foreach ($k in $siteValues.Keys) { $Text = $Text.Replace($k, $siteValues[$k]) }
    return $Text
}

foreach ($a in $actions) {
    Backup-Path $a.Path
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $a.Path) | Out-Null
    $content = Get-Content -LiteralPath $a.Source -Raw
    Set-Content -LiteralPath $a.Path -Value (Expand-SiteTokens $content) -NoNewline -Encoding utf8
    Write-Host ("  {0} {1}" -f $a.Verb, $a.Path) -ForegroundColor Green
}

if ($keyActions.Count -gt 0) {
    Backup-Path $targetSettingsPath
    $merged = $targetSettings
    if ($null -eq $merged) { $merged = [pscustomobject]@{} }

    function Set-JsonValue {
        param($Object, [string] $KeyPath, $Value)
        $parts = $KeyPath -split '\.'
        $node  = $Object
        for ($i = 0; $i -lt $parts.Count - 1; $i++) {
            $p = $parts[$i]
            if (-not $node.PSObject.Properties[$p] -or $null -eq $node.$p) {
                $node | Add-Member -NotePropertyName $p -NotePropertyValue ([pscustomobject]@{}) -Force
            }
            $node = $node.$p
        }
        $leaf = $parts[-1]
        $node | Add-Member -NotePropertyName $leaf -NotePropertyValue $Value -Force
    }

    foreach ($k in $keyActions) {
        if ($k.Kind -eq 'hook') {
            # Hook blocks are merged by the kit's settings.json in step B3; until
            # that file carries them there is nothing to merge.
            continue
        }
        $v = $k.NewValue
        if ($v -is [string]) { $v = Expand-SiteTokens $v }
        Set-JsonValue $merged $k.Key $v
        Write-Host ("  set {0}" -f $k.Key) -ForegroundColor Green
    }

    New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
    Set-Content -LiteralPath $targetSettingsPath -Value (ConvertTo-Json $merged -Depth 20) -Encoding utf8
    Write-Host ("  wrote {0}" -f $targetSettingsPath) -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 11. Post-install checklist
# ---------------------------------------------------------------------------

Write-Head 'Next steps'
Write-Host '1. Fill in hooks\personal-terms.json - the "names" array ships empty by'
Write-Host '   design. It is per-person and must never be committed.'
Write-Host '2. If you took the KG runner: copy kg\registry.example.json to kg\registry.json'
Write-Host '   and point it at your own KG repos. A registry entry pointing at a repo with'
Write-Host '   no remote fails quietly.'
Write-Host '3. Hooks are not merged by this installer. Copy the entries you want from the'
Write-Host '   "hooks" block of kit\settings.json into your settings.json, replacing <HOME>'
Write-Host '   with your profile path. Then restart Claude Code - hooks are read at start-up.'
Write-Host '4. Read docs\WALKTHROUGH.md before adopting anything in the advanced tier.'
foreach ($s in $sideBySide) {
    if ($s.Overwrote) {
        Write-Host ("5. {0} was NOT overwritten. The kit's version is at {1} - merge by hand." -f (Split-Path -Leaf $s.Dest).Replace('.starter-kit',''), $s.Dest) -ForegroundColor Yellow
    }
}
if ($later.Count -gt 0) {
    Write-Host ''
    Write-Host ("Marked for later: {0}" -f ($later -join ', '))
    Write-Host ("Re-run with: pwsh -File INSTALL.ps1 -Components {0}" -f ($later -join ','))
}
Write-Host ''
exit 0
