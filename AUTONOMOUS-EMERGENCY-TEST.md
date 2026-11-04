# NaviGuard Autonomous Emergency Response — Demo Test

This project defaults to `EMERGENCY_DISPATCH_MODE=demo`. Demo mode selects nearby emergency resources and records a simulated distress delivery. It does **not** contact real police, hospitals, or ambulance services.

## 1. Start NaviGuard

Backend:

```powershell
cd backend
npm run dev
```

Frontend in another terminal:

```powershell
cd frontend
npm run dev
```

## 2. Log in as the seeded Driver from PowerShell

```powershell
$login = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:4000/api/auth/login" `
  -ContentType "application/json" `
  -Body (@{
    email = "driver1@campusbus.local"
    password = "Pass@123"
  } | ConvertTo-Json)

$headers = @{
  Authorization = "Bearer $($login.token)"
}

$me = Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:4000/api/auth/me" `
  -Headers $headers

$vehicleId = $me.driverRoutes[0].assignedBus.id
$vehicleId
```

If `$vehicleId` is empty, assign a bus and route to the Driver from the Admin account first.

## 3. Simulate normal movement

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:4000/api/vehicles/$vehicleId/location" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    latitude = 12.9141
    longitude = 77.5263
    speedKmph = 45
  } | ConvertTo-Json)
```

Wait two seconds:

```powershell
Start-Sleep -Seconds 2
```

## 4. Simulate the accident

```powershell
$result = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:4000/api/vehicles/$vehicleId/location" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    latitude = 12.9141
    longitude = 77.5263
    speedKmph = 2
  } | ConvertTo-Json)

$result.accidentDetection | Format-List
```

For the default thresholds, the 45 km/h -> 2 km/h change produces a high-confidence GPS event and should show:

- `possibleAccident : True`
- `autonomousDispatchTriggered : True`
- `requiresVerification : False`

The Driver web UI should show a full red emergency popup, a pulsing top alarm bar, and a repeating warning sound. The autonomous event does not wait for the Driver to open the SOS page.

## 5. Wait for nearby resource lookup

The OpenStreetMap/Overpass lookup can take a few seconds:

```powershell
Start-Sleep -Seconds 10

$incidents = Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:4000/api/incidents" `
  -Headers $headers

$latest = $incidents |
  Where-Object { $_.type -eq "CRASH" } |
  Sort-Object createdAt -Descending |
  Select-Object -First 1

$latest | Format-List id,type,verificationStatus,confirmationSource,emergencyDispatchStatus,aiConfidence
```

Expected high-confidence result:

- `verificationStatus = CONFIRMED`
- `confirmationSource = AUTONOMOUS_ENGINE`
- `emergencyDispatchStatus = MOCK_DISPATCHED` when nearby resources were found in demo mode
- `emergencyDispatchStatus = FAILED` if the external resource lookup was unavailable or no suitable resource was returned

Inspect the selected facilities:

```powershell
$latest.detectionSignals.autonomousEmergencyResponse.resourceLookup.police | Format-Table name,distanceMeters
$latest.detectionSignals.autonomousEmergencyResponse.resourceLookup.hospitals | Format-Table name,distanceMeters,capabilityScore
```

## 6. Verify cross-role alerts

- Admin: notification should report that autonomous emergency response was activated.
- Parent linked to an affected student: critical NaviGuard emergency notification should appear.
- Driver: global red alarm remains visible until the Driver acknowledges it.
- SOS & Accident Center: the incident should show `CONFIRMED` and the dispatch status.

## Production integration

For a real authorized dispatcher integration, configure:

```env
EMERGENCY_DISPATCH_MODE="webhook"
EMERGENCY_DISPATCH_WEBHOOK_URL="https://your-authorized-dispatch-endpoint.example/..."
EMERGENCY_DISPATCH_WEBHOOK_TOKEN="..."
```

Do not point this at an arbitrary police/hospital website. The endpoint must be an authorized emergency-dispatch integration that accepts automated distress messages.
