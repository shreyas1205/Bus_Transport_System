[CmdletBinding()]
param(
    [string]$CredentialFile = $env:NAVIGUARD_DEMO_CREDENTIAL_FILE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$target = 'naviguard_hod_demo_20261020'
$child = $null
$failed = $false

function Assert-PrivateCredentialFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Credential file required.' }
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'NaviGuard\HodDemo'))
    $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $full.StartsWith($project + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $full.Substring(3).Contains(':')) { throw 'Invalid credential location.' }
    $file = Get-Item -LiteralPath $full -Force
    if ($file -isnot [IO.FileInfo]) { throw 'Expected a file.' }
    $cursor = $file
    while ($null -ne $cursor) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point rejected.' }
        $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
    }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($item in @($full, $file.Directory.FullName)) {
        $acl = Get-Acl -LiteralPath $item
        if (-not $acl.AreAccessRulesProtected -or
            $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
            throw 'Private ownership and protected ACL required.'
        }
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or
            $rules[0].AccessControlType -ne 'Allow' -or $rules[0].IsInherited -or
            $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
            ($rules[0].PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) {
            throw 'Only the current user may access private credentials.'
        }
    }
    return $full
}

function New-DemoSecret {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $rng.Dispose()
    }
}

try {
    $privatePath = Assert-PrivateCredentialFile $CredentialFile
    $fixture = [IO.File]::ReadAllText($privatePath) | ConvertFrom-Json
    if ($fixture.status -cne 'COMMITTED_AND_READ_ONLY_VERIFIED' -or
        $fixture.database -cne $target -or
        $fixture.VERIFIED_GUARDIAN_LINKS -isnot [string]) { throw 'Unverified demo credentials.' }
    $linksText = $fixture.VERIFIED_GUARDIAN_LINKS
    if (-not $linksText.Trim().StartsWith('[')) { throw 'Expected guardian approval array.' }
    $links = @($linksText | ConvertFrom-Json)
    if ($links.Count -eq 0) { throw 'Guardian approvals required.' }
    foreach ($link in $links) {
        if ($link.parentId -isnot [string] -or [string]::IsNullOrWhiteSpace($link.parentId) -or
            $link.studentId -isnot [string] -or [string]::IsNullOrWhiteSpace($link.studentId)) {
            throw 'Invalid guardian approval.'
        }
    }

    # Parse only DATABASE_URL: never evaluate .env or import its other values.
    $backend = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $envText = [IO.File]::ReadAllText((Join-Path $backend '.env'))
    $entries = [regex]::Matches($envText, '(?m)^\s*(?:export[ \t]+)?DATABASE_URL[ \t]*=[ \t]*([^\r\n]*)')
    if ($entries.Count -ne 1) { throw 'Exactly one DATABASE_URL required.' }
    $entry = [regex]::Match($entries[0].Groups[1].Value.Trim(), '^(?:"([^"]*)"|''([^'']*)''|`([^`]*)`|([^#\s]+))[ \t]*(?:#.*)?$')
    if (-not $entry.Success) { throw 'Unsupported database URL format.' }
    $sourceUrl = $null
    foreach ($index in 1..4) {
        if ($entry.Groups[$index].Success) { $sourceUrl = $entry.Groups[$index].Value; break }
    }
    $connection = [regex]::Match($sourceUrl, '\A(postgresql://[^/?#]+/)[^/?#]+(\?[^#]*)?\z')
    if (-not $connection.Success) { throw 'Invalid PostgreSQL connection.' }
    # Only the seed's known options are accepted, then dropped: demoMode.js
    # requires no URL overrides. Preserve encoded credentials without decoding.
    $uri = [Uri]$sourceUrl
    $options = @()
    if ($uri.Query) {
        foreach ($option in $uri.Query.Substring(1).Split('&')) {
            if ($option -cnotin @('schema=public', 'connection_limit=1') -or $options -contains $option) {
                throw 'Unsafe database option.'
            }
            $options += $option
        }
    }
    $demoUrl = $connection.Groups[1].Value + $target
    $uri = [Uri]$demoUrl
    if ($uri.Scheme -cne 'postgresql' -or $uri.Host -cnotin @('localhost', '127.0.0.1') -or
        $uri.Port -notin @(-1, 5432) -or $uri.AbsolutePath -cne ('/' + $target) -or
        $uri.UserInfo -notmatch '^[^:]+:.+$' -or $uri.Query -or $uri.Fragment) {
        throw 'Demo database isolation check failed.'
    }

    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $start.WorkingDirectory = $backend
    $start.Arguments = 'src/server.js'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    # Allowlist avoids inherited integration secrets, NODE_OPTIONS, NODE_PATH,
    # DOTENV_KEY, Prisma overrides and alternate database connection variables.
    $start.EnvironmentVariables.Clear()
    foreach ($key in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP')) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        if ($value) { $start.EnvironmentVariables[$key] = $value }
    }
    $start.EnvironmentVariables['DATABASE_URL'] = $demoUrl
    $start.EnvironmentVariables['NAVIGUARD_DEMO_MODE'] = 'true'
    $start.EnvironmentVariables['PORT'] = '4001'
    $start.EnvironmentVariables['HOST'] = '127.0.0.1'
    $start.EnvironmentVariables['NODE_ENV'] = 'production'
    $start.EnvironmentVariables['JWT_SECRET'] = New-DemoSecret
    $start.EnvironmentVariables['OTP_SECRET'] = New-DemoSecret
    $start.EnvironmentVariables['VERIFIED_GUARDIAN_LINKS'] = $linksText
    # Windows null device is empty and cannot restore original .env secrets.
    $start.EnvironmentVariables['DOTENV_CONFIG_PATH'] = '\\.\NUL'
    $start.EnvironmentVariables['DOTENV_CONFIG_QUIET'] = 'true'
    $start.EnvironmentVariables['AUTONOMOUS_DISPATCH_ENABLED'] = 'false'
    $start.EnvironmentVariables['EMERGENCY_DISPATCH_MODE'] = 'demo'
    $child = New-Object Diagnostics.Process
    $child.StartInfo = $start
    if (-not $child.Start()) { throw 'Backend did not start.' }
    # Drain both streams without displaying or retaining potentially sensitive
    # application errors. Concurrent draining prevents pipe-buffer deadlocks.
    $stdout = $child.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
    $stderr = $child.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    Write-Host 'Demo backend process launched for http://127.0.0.1:4001 (not a readiness check). Press Ctrl+C to stop.'
    while (-not $child.WaitForExit(250)) { }
    $stdout.GetAwaiter().GetResult()
    $stderr.GetAwaiter().GetResult()
    if ($child.ExitCode -ne 0) { throw 'Backend exited unsuccessfully.' }
} catch {
    $failed = $true
    # Exception messages, native output and private JSON may contain secrets.
    [Console]::Error.WriteLine('Demo launcher stopped. Check private file ACLs, verified status, database configuration and port availability. Error details withheld.')
} finally {
    if ($null -ne $child) {
        try { if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() } }
        catch { }
        $child.Dispose()
    }
    if (Get-Variable start -ErrorAction SilentlyContinue) { $start.EnvironmentVariables.Clear() }
    $fixture = $linksText = $links = $envText = $entries = $entry = $sourceUrl = $connection = $demoUrl = $uri = $null
}
if ($failed) { exit 1 }
