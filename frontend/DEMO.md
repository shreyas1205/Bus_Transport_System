# Isolated HOD demo frontend

From the repository root:

```powershell
npm --prefix frontend run dev:demo
```

Open **http://localhost:5173**. The isolated backend must already be running at
http://127.0.0.1:4001. This command starts only Vite.

Demo mode forces `/api` and `http://localhost:5173` for the API and Socket.IO
settings, overriding any stale `VITE_API_URL` or `VITE_SOCKET_URL` environment
values. Vite forwards `/api` and `/socket.io` (HTTP polling and WebSocket upgrades)
to port 4001. If that backend is unavailable, requests fail; there is no retry
against port 4000. Vite binds to localhost and fails if 5173 is occupied.
Normal `npm --prefix frontend run dev` configuration is unchanged.

For Samsung Chrome over USB debugging, run:

```powershell
adb reverse tcp:5173 tcp:5173
```

Then open **http://localhost:5173** on the phone. No port-4000 or port-4001
reverse mapping is needed: the desktop Vite proxy reaches the backend.
No public tunnel is needed.

The backend HTTP and Socket.IO CORS settings use `FRONTEND_URL`; it should be
`http://localhost:5173`. The checked backend configuration already matches.
Use this exact browser origin, including on the phone, rather than a LAN IP or
`http://127.0.0.1:5173`. An isolated backend launched with a different
`FRONTEND_URL` should have its launch environment corrected separately.

Checks (no servers or database access):

```powershell
npm --prefix frontend run check:demo
npm --prefix frontend run build
npm --prefix frontend run build -- --mode demo --outDir dist-demo
```

Demo mode is intended for the Vite development server and its proxy. A static
deployment of a demo build would need equivalent proxy configuration.
