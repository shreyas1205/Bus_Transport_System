[CmdletBinding()]
param([switch]$ValidateStorage)

$ErrorActionPreference = 'Stop'
$target = 'naviguard_hod_demo_20261020'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User

function Assert-PrivateStorage {
    $file = $env:NAVIGUARD_DEMO_CREDENTIAL_FILE
    $root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'NaviGuard\HodDemo'))
    $full = [IO.Path]::GetFullPath($file)
    if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid credential location.' }
    $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    if ($full.StartsWith($project + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Credentials must be outside the project.' }
    $cursor = Get-Item -LiteralPath $full
    while ($null -ne $cursor) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are not allowed.' }
        $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
    }
    foreach ($item in @($full, [IO.Path]::GetDirectoryName($full))) {
        $acl = Get-Acl -LiteralPath $item
        if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
            throw 'Private ACL or owner check failed.'
        }
        $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or
            $rules[0].AccessControlType -ne 'Allow' -or
            $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Credential ACL must allow only the current user.'
        }
    }
}

if ($ValidateStorage) {
    try { Assert-PrivateStorage }
    catch {
        [Console]::Error.WriteLine('Demo seed stopped; operation=validate private credential storage. Private storage validation failed; exception details withheld.')
        exit 1
    }
    exit 0
}

# Read only DATABASE_URL from .env; never load it into the process environment.
# No Prisma CLI, db push/reset, package installation or application startup.
$saved = @{}
foreach ($key in @('NAVIGUARD_DEMO_DATABASE_URL','NAVIGUARD_DEMO_CREDENTIAL_FILE','NODE_OPTIONS','NODE_PATH')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
$operation = 'locate Node executable'
$failed = $false
try {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $operation = 'read DATABASE_URL from backend/.env'
    $envText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\.env'))
    $entries = [regex]::Matches($envText, '(?m)^\s*(?:export[ \t]+)?DATABASE_URL[ \t]*=[ \t]*([^\r\n]*)')
    if ($entries.Count -ne 1) { throw 'Exactly one DATABASE_URL is required.' }
    $value = $entries[0].Groups[1].Value.Trim()
    # Accept single-line dotenv quoting and comments, without interpolation or evaluation.
    $entry = [regex]::Match($value, '^(?:"([^"]*)"|''([^'']*)''|`([^`]*)`|([^#\s]+))[ \t]*(?:#.*)?$')
    if (-not $entry.Success) { throw 'Unsupported DATABASE_URL format.' }
    $sourceUrl = $null
    foreach ($index in 1..4) {
        if ($entry.Groups[$index].Success) { $sourceUrl = $entry.Groups[$index].Value; break }
    }
    $operation = 'construct pinned demo connection'
    $connection = [regex]::Match($sourceUrl, '\A(postgresql://[^/?#]+/)[^/?#]+(\?[^#]*)?\z')
    if (-not $connection.Success) { throw 'Invalid PostgreSQL connection.' }
    # Preserve encoded credentials, host, port and options verbatim; change only the database.
    $demoUrl = $connection.Groups[1].Value + $target + $connection.Groups[2].Value
    $uri = [Uri]$demoUrl
    if ($uri.Scheme -cne 'postgresql' -or $uri.Host -cnotin @('localhost', '127.0.0.1') -or
        $uri.AbsolutePath -cne ('/' + $target) -or $uri.Fragment -or
        $uri.UserInfo -notmatch '^[^:]+:.+$' -or $uri.Port -notin @(-1, 5432)) {
        throw 'Demo connection safety check failed.'
    }
    # Only the options already pinned by the seed are permitted.
    $optionNames = @()
    if ($uri.Query) {
        foreach ($option in $uri.Query.Substring(1).Split('&')) {
            if ($option -cnotin @('schema=public', 'connection_limit=1')) { throw 'Unsafe connection option.' }
            $name = $option.Split('=')[0]
            if ($optionNames -contains $name) { throw 'Duplicate connection option.' }
            $optionNames += $name
        }
    }
    $env:NAVIGUARD_DEMO_DATABASE_URL = $demoUrl
    $operation = 'create private credential directory'
    $runDirectory = Join-Path $env:LOCALAPPDATA ('NaviGuard\HodDemo\' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($runDirectory) | Out-Null
    $operation = 'protect credential directory ACL'
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $runDirectory -AclObject $acl
    $operation = 'create private credential file'
    $env:NAVIGUARD_DEMO_CREDENTIAL_FILE = Join-Path $runDirectory 'credentials.json'
    $stream = [IO.File]::Open($env:NAVIGUARD_DEMO_CREDENTIAL_FILE, [IO.FileMode]::CreateNew)
    $stream.Dispose()
    $operation = 'protect credential file ACL'
    $fileAcl = New-Object System.Security.AccessControl.FileSecurity
    $fileAcl.SetOwner($sid)
    $fileAcl.SetAccessRuleProtection($true, $false)
    $fileAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $env:NAVIGUARD_DEMO_CREDENTIAL_FILE -AclObject $fileAcl
    $operation = 'validate private credential storage'
    Assert-PrivateStorage
    Write-Host ('Private credential file (retain if interrupted): ' + $env:NAVIGUARD_DEMO_CREDENTIAL_FILE)
    $env:NODE_OPTIONS = $null
    $env:NODE_PATH = $null
    $operation = 'execute seed child process'
    # Windows PowerShell can turn native stderr into ErrorRecords. Capture it
    # without letting Stop replace the child's sanitized diagnostic.
    try {
        $ErrorActionPreference = 'Continue'
        $childOutput = @(& $node (Join-Path $PSScriptRoot 'seed-hod-demo.mjs') --execute 2>&1)
        $childExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    foreach ($line in $childOutput) {
        $text = [string]$line
        if ($text.StartsWith('Demo seed stopped during ') -and
            $text.Contains('; operation=') -and $text.Contains('Prisma code=') -and
            $text.EndsWith('No automatic cleanup or retry was performed.')) {
            [Console]::Error.WriteLine($text)
        } elseif ($text -eq 'Demo seed committed; counts, passwords, relationships and guardian authorization verified.') {
            Write-Host $text
        }
        # Suppress all other native output, including startup stacks and paths.
    }
    if ($childExitCode -ne 0) {
        $failed = $true
        [Console]::Error.WriteLine('Seed child process failed. Retain the private file and investigate; do not reset or retry blindly.')
    } else {
    Write-Host 'Private credentials and demo guardian approval saved to:'
    Write-Host $env:NAVIGUARD_DEMO_CREDENTIAL_FILE
    }
} catch {
    $failed = $true
    # Never interpolate the exception: it may contain credentials or file data.
    [Console]::Error.WriteLine("Demo seed stopped; operation=$operation. Launcher error details withheld. Retain any private credential file; no automatic cleanup or retry was performed.")
} finally {
    $envText = $entries = $value = $entry = $sourceUrl = $connection = $demoUrl = $uri = $null
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
if ($failed) { exit 1 }
