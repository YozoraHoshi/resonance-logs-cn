<#
.SYNOPSIS
    Synthesizes bundled voice-prompt WAVs from the locale-matched preset voices.

.DESCRIPTION
    Drives qwen3-tts-sidecar directly (no running app required). For each
    locale in src-tauri/voice-prompts/prompts.json it clones the matching
    file under src-tauri/voice-presets/ and writes the finished playback
    WAVs into src-tauri/voice-prompts/.

    The current preset references are still placeholder tones (presets.json
    revision 0). Re-run this script after those recordings are replaced.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-voice-prompts.ps1
#>
param(
    [string]$ModelDir,
    [ValidateSet("Auto", "Cpu", "Vulkan")]
    [string]$Backend = "Auto",
    [string[]]$Locales,
    [string[]]$Keys
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$promptsRoot = Join-Path $repoRoot "src-tauri\voice-prompts"
$presetsRoot = Join-Path $repoRoot "src-tauri\voice-presets"
$manifestPath = Join-Path $promptsRoot "prompts.json"
$stagingRoot = Join-Path $repoRoot "src-tauri\target\voice-prompt-gen"

$languageIds = @{
    "zh-CN" = 2055
    "en-US" = 2050
    "ja-JP" = 2058
}

function ConvertTo-JsonPathString {
    param([string]$Value)
    return ($Value -replace '\\', '\\')
}

function ConvertTo-JsonTextString {
    param([string]$Value)
    $builder = New-Object System.Text.StringBuilder
    foreach ($ch in $Value.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq '"' -or $ch -eq '\' -or $code -lt 32) {
            [void]$builder.AppendFormat('\u{0:x4}', $code)
        } else {
            [void]$builder.Append($ch)
        }
    }
    return $builder.ToString()
}

function Write-JobFile {
    param(
        [string]$Path,
        [string]$TransformerPath,
        [string]$TokenizerPath,
        [string]$SourceJson,
        [array]$Items
    )
    $itemsJson = ($Items | ForEach-Object {
        '{"id":"' + $_.id +
        '","text":"' + (ConvertTo-JsonTextString $_.text) +
        '","output_path":"' + (ConvertTo-JsonPathString $_.output_path) +
        '","language_id":' + $_.language_id + '}'
    }) -join ","
    $json = '{"protocol_version":3,"transformer_path":"' +
        (ConvertTo-JsonPathString $TransformerPath) +
        '","tokenizer_path":"' +
        (ConvertTo-JsonPathString $TokenizerPath) +
        '","source":' + $SourceJson +
        ',"items":[' + $itemsJson + ']}'
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Resolve-ModelFile {
    param([string]$Directory, [string[]]$Candidates)
    foreach ($name in $Candidates) {
        $path = Join-Path $Directory $name
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }
    throw "none of [$($Candidates -join ', ')] found under $Directory"
}

function Resolve-ModelDir {
    param([string]$Requested)
    if ($Requested) {
        if (-not (Test-Path -LiteralPath $Requested)) {
            throw "model directory not found: $Requested"
        }
        return (Resolve-Path -LiteralPath $Requested).Path
    }

    $modelsRoot = Join-Path $env:LOCALAPPDATA "com.resonance-logs-cn\voice\models"
    if (Test-Path -LiteralPath $modelsRoot) {
        $found = Get-ChildItem -LiteralPath $modelsRoot -Directory |
            Where-Object {
                (Test-Path -LiteralPath (Join-Path $_.FullName "qwen3-tts-tokenizer-f16.gguf")) -and
                ((Test-Path -LiteralPath (Join-Path $_.FullName "qwen3-tts-0.6b-q8_0.gguf")) -or
                 (Test-Path -LiteralPath (Join-Path $_.FullName "qwen3-tts-0.6b-f16.gguf")))
            } |
            Select-Object -First 1
        if ($found) {
            return $found.FullName
        }
    }
    throw "no installed qwen3-tts model found; pass -ModelDir"
}

function Resolve-Sidecar {
    param([string]$RequestedBackend)
    $binaries = Join-Path $repoRoot "src-tauri\binaries"
    $cpu = Join-Path $binaries "qwen3-tts-sidecar-cpu-x86_64-pc-windows-msvc.exe"
    $vulkan = Join-Path $binaries "qwen3-tts-sidecar-vulkan-x86_64-pc-windows-msvc.exe"
    $choice = $RequestedBackend
    if ($choice -eq "Auto") {
        $choice = if (Test-Path -LiteralPath $vulkan) { "Vulkan" } else { "Cpu" }
    }
    $path = if ($choice -eq "Vulkan") { $vulkan } else { $cpu }
    if (-not (Test-Path -LiteralPath $path)) {
        throw "sidecar not found for $choice at $path"
    }
    return @{
        Backend = $choice.ToLowerInvariant()
        Path = $path
    }
}

function Invoke-SidecarJob {
    param([string]$ExePath, [string]$Backend, [string]$JobPath, [string]$LogPrefix)
    $stdoutPath = "$LogPrefix.stdout.jsonl"
    $stderrPath = "$LogPrefix.stderr.log"
    $quotedExe = '"' + $ExePath + '"'
    $quotedJob = '"' + $JobPath + '"'
    & $env:ComSpec /d /s /c "$quotedExe --job $quotedJob --backend $Backend 1> `"$stdoutPath`" 2> `"$stderrPath`""
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "sidecar job failed with exit code $exitCode; see $stderrPath"
    }
    return @{ Stdout = $stdoutPath; Stderr = $stderrPath }
}

function Test-GeneratedWav {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 44) {
        throw "generated WAV is too small: $Path"
    }
    $riff = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4)
    $wave = [System.Text.Encoding]::ASCII.GetString($bytes, 8, 4)
    if ($riff -ne "RIFF" -or $wave -ne "WAVE") {
        throw "generated file is not a RIFF/WAVE: $Path"
    }
}

$resolvedModelDir = Resolve-ModelDir -Requested $ModelDir
$transformerPath = Resolve-ModelFile -Directory $resolvedModelDir -Candidates @(
    "qwen3-tts-0.6b-q8_0.gguf",
    "qwen3-tts-0.6b-f16.gguf"
)
$tokenizerPath = Resolve-ModelFile -Directory $resolvedModelDir -Candidates @("qwen3-tts-tokenizer-f16.gguf")
function Get-RequestedFilters {
    param([string[]]$Requested)
    $filters = @()
    foreach ($item in @($Requested)) {
        if (-not $item) {
            continue
        }
        $filters += ($item -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }
    return $filters
}

function Test-PromptSelected {
    param([string]$Key, [string[]]$Requested)
    $filters = Get-RequestedFilters -Requested $Requested
    if ($filters.Count -eq 0) {
        return $true
    }
    foreach ($item in $filters) {
        if ($Key -eq $item -or $Key.EndsWith(":$item")) {
            return $true
        }
    }
    return $false
}

$sidecar = Resolve-Sidecar -RequestedBackend $Backend
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$localeFilters = Get-RequestedFilters -Requested $Locales
$selectedLocales = if ($localeFilters.Count -gt 0) { $localeFilters } else { @("zh-CN", "en-US", "ja-JP") }
$generated = @()

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

Write-Host "transformer: $($transformerPath)"
Write-Host "tokenizer:   $($tokenizerPath)"
Write-Host "sidecar:     $($sidecar.Backend) $($sidecar.Path)"

foreach ($locale in $selectedLocales) {
    if (-not $languageIds.ContainsKey($locale)) {
        throw "unsupported locale: $locale"
    }
    $referenceWav = Join-Path $presetsRoot "$locale.wav"
    if (-not (Test-Path -LiteralPath $referenceWav)) {
        throw "missing preset reference audio: $referenceWav"
    }

    $items = @()
    foreach ($prompt in $manifest.prompts) {
        if (-not (Test-PromptSelected -Key $prompt.key -Requested $Keys)) {
            continue
        }
        $variant = $prompt.variants.$locale
        if (-not $variant) {
            throw "prompt $($prompt.key) is missing locale $locale"
        }
        $fileName = Split-Path -Leaf $variant.file
        $outputPath = Join-Path $stagingRoot $fileName
        $items += @{
            id = "$($prompt.key)-$locale"
            text = [string]$variant.text
            output_path = $outputPath
            language_id = $languageIds[$locale]
            relative = [string]$variant.file
        }
    }
    if ($items.Count -eq 0) {
        continue
    }

    $jobPath = Join-Path $stagingRoot "job.$locale.json"
    $profilePath = Join-Path $stagingRoot "preset.$locale.q3sp"
    $sourceJson = if (Test-Path -LiteralPath $profilePath) {
        '{"mode":"profile_existing","existing_q3sp_path":"' +
            (ConvertTo-JsonPathString $profilePath) + '"}'
    } else {
        '{"mode":"profile_new","reference_wav_path":"' +
            (ConvertTo-JsonPathString $referenceWav) +
            '","save_q3sp_path":"' +
            (ConvertTo-JsonPathString $profilePath) + '"}'
    }
    Write-JobFile -Path $jobPath -TransformerPath $transformerPath -TokenizerPath $tokenizerPath -SourceJson $sourceJson -Items $items

    Write-Host "`n=== Generating $locale ($($items.Count) prompts) ===" -ForegroundColor Cyan
    Invoke-SidecarJob -ExePath $sidecar.Path -Backend $sidecar.Backend -JobPath $jobPath -LogPrefix (Join-Path $stagingRoot $locale) | Out-Null

    foreach ($item in $items) {
        Test-GeneratedWav -Path $item.output_path
        Write-Host ("  ok {0} ({1:N1} KB)" -f (Split-Path -Leaf $item.output_path), ((Get-Item -LiteralPath $item.output_path).Length / 1KB))
        $generated += $item
    }
}

if ($generated.Count -eq 0) {
    throw "no prompts matched the requested locales/keys"
}

foreach ($item in $generated) {
    $destination = Join-Path $promptsRoot $item.relative
    $destinationDir = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item -LiteralPath $item.output_path -Destination $destination -Force
}

Write-Host "`nreplaced bundled prompt WAVs in $promptsRoot" -ForegroundColor Green
Write-Host "increase prompts.json revision if these files will be committed"
