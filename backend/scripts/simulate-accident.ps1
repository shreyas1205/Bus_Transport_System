# NaviGuard live accident simulation (DEMO dispatch: no real emergency services are contacted).
# Prerequisites: backend running (npm run dev), EMERGENCY_DISPATCH_MODE not set to "webhook",
# and "Demo Driver" assigned to an active route with a bus (Admin > Routes & ETA).
# Usage (from backend folder):
#   powershell -ExecutionPolicy Bypass -File scripts\simulate-accident.ps1 -Scenario safe
#   powershell -ExecutionPolicy Bypass -File scripts\simulate-accident.ps1 -Scenario emergency
#   powershell -ExecutionPolicy Bypass -File scripts\simulate-accident.ps1 -Scenario noresponse
param(
  [ValidateSet('safe','emergency','noresponse','severe')] [string]$Scenario = 'safe',
  [string]$Api = 'http://localhost:4000/api',
  [string]$Email = 'driver@naviguard.demo',
  [string]$Password = 'NaviGuard@2026'
)
$ErrorActionPreference = 'Stop'
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Step "Logging in as $Email"
$login = Invoke-RestMethod -Method Post -Uri "$Api/auth/login" -ContentType 'application/json' -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }
Write-Host "Logged in as $($login.user.name) ($($login.user.role))"

# Medium impact -> needs verification (confidence 0.75). Severe -> automatic response (>= 0.8).
$sensor = if ($Scenario -eq 'severe') { @{ speedBefore = 70; speedAfter = 0; impactGForce = 7.5; tiltDegrees = 70 } }
          else { @{ speedBefore = 35; speedAfter = 3; impactGForce = 3.2; tiltDegrees = 8 } }
$sensor.latitude = 12.9716; $sensor.longitude = 77.5946

Step "Sending simulated crash sensor reading ($Scenario)"
try { $r = Invoke-RestMethod -Method Post -Uri "$Api/incidents/accident-detection" -Headers $h -ContentType 'application/json' -Body ($sensor | ConvertTo-Json) }
catch { Write-Host "Request refused: $($_.ErrorDetails.Message)" -ForegroundColor Red; Write-Host 'Make sure Demo Driver is assigned to an active route with a bus.'; exit 1 }
$inc = $r.incident
Write-Host "Incident $($inc.id): confidence $($inc.aiConfidence), status $($inc.verificationStatus)"
Write-Host "Open the Admin 'Incidents / SOS' page now to watch it update." -ForegroundColor Yellow

switch ($Scenario) {
  'safe' {
    Start-Sleep 5; Step "Driver responds: I'm safe"
    $x = Invoke-RestMethod -Method Patch -Uri "$Api/incidents/$($inc.id)/driver-response" -Headers $h -ContentType 'application/json' -Body '{"response":"SAFE"}'
    Write-Host $x.message -ForegroundColor Green
  }
  'emergency' {
    Start-Sleep 5; Step 'Driver confirms emergency'
    $x = Invoke-RestMethod -Method Patch -Uri "$Api/incidents/$($inc.id)/driver-response" -Headers $h -ContentType 'application/json' -Body '{"response":"EMERGENCY"}'
    Write-Host $x.message -ForegroundColor Green
    Write-Host "Students on board: $($x.onboardStudents) | parents notified: $($x.parentsNotified) | dispatch mode: $($x.dispatch.mode) | real services contacted: $($x.dispatch.realEmergencyServiceContacted)"
  }
  'noresponse' {
    Step 'Driver does not respond. Waiting 35 seconds for the countdown...'
    Start-Sleep 35
    Write-Host "Check Admin notifications: you should see 'Driver Not Responding'. No external dispatch is triggered by the timeout alone." -ForegroundColor Green
  }
  'severe' {
    Write-Host "Automatic response triggered: $($r.autonomousDispatchTriggered). Check the SOS page for the emergency information card." -ForegroundColor Green
  }
}
Write-Host "`nDone. Resolve the test incident from the Admin SOS page afterwards." -ForegroundColor Cyan
