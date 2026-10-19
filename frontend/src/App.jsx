import {
  BrowserRouter,
  Routes,
  Route
} from 'react-router-dom';

import { AuthProvider } from './auth';

import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import RoutesPage from './pages/Routes';
import Boarding from './pages/Boarding';
import BoardingStatus from './pages/BoardingStatus';
import Fees from './pages/Fees';
import FeeSettings from './pages/FeeSettings';
import Passes from './pages/Passes';
import Maintenance from './pages/Maintenance';
import SOS from './pages/SOS';
import Profile from './pages/Profile';
import Users from './pages/Users';
import TransportSelection from './pages/TransportSelection';
import Fleet from './pages/Fleet';
import LiveLocation from './pages/LiveLocation';
import Complaints from './pages/Complaints';
import Notifications from './pages/Notifications';

import './styles.css';

const all = [
  'ADMIN',
  'DRIVER',
  'STUDENT',
  'STAFF',
  'PARENT'
];

const boarding = [
  'ADMIN',
  'DRIVER'
];

const self = [
  'STUDENT',
  'STAFF',
  'PARENT'
];

const dashboardRoles = [
  'ADMIN',
  'PARENT'
];

const routeRoles = [
  'ADMIN',
  'DRIVER',
  'STUDENT',
  'PARENT'
];

function Secure({
  children,
  roles
}) {
  return (
    <ProtectedRoute roles={roles}>
      {children}
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>

          {/* PUBLIC ROUTES */}

          <Route
            path="/login"
            element={<Login />}
          />

          <Route
            path="/forgot-password"
            element={<ForgotPassword />}
          />

          {/* PROTECTED APPLICATION */}

          <Route
            element={
              <Secure roles={all}>
                <Layout />
              </Secure>
            }
          >

            {/* ADMIN DASHBOARD */}

            <Route
              path="/"
              element={
                <Secure
                  roles={dashboardRoles}
                >
                  <Dashboard />
                </Secure>
              }
            />

            <Route
              path="/analytics"
              element={
                <Secure
                  roles={['ADMIN']}
                >
                  <Analytics />
                </Secure>
              }
            />

            {/* ROUTES */}

            <Route
              path="/routes"
              element={
                <Secure
                  roles={routeRoles}
                >
                  <RoutesPage />
                </Secure>
              }
            />

            {/* COMPLAINTS */}

            <Route
              path="/complaints"
              element={
                <Secure
                  roles={[
                    'ADMIN',
                    'STUDENT',
                    'PARENT'
                  ]}
                >
                  <Complaints />
                </Secure>
              }
            />

            {/* LIVE LOCATION */}

            <Route
              path="/live-location"
              element={
                <Secure
                  roles={[
                    'ADMIN',
                    'DRIVER',
                    'STUDENT',
                    'PARENT'
                  ]}
                >
                  <LiveLocation />
                </Secure>
              }
            />

            {/* BOARDING */}

            <Route
              path="/boarding"
              element={
                <Secure
                  roles={boarding}
                >
                  <Boarding />
                </Secure>
              }
            />

            {/* BOARDING STATUS */}

            <Route
              path="/boarding-status"
              element={
                <Secure
                  roles={[
                    'STUDENT',
                    'PARENT'
                  ]}
                >
                  <BoardingStatus />
                </Secure>
              }
            />

            {/* PARENT NOTIFICATIONS */}

            <Route
              path="/notifications"
              element={
                <Secure
                  roles={[
                    'PARENT'
                  ]}
                >
                  <Notifications />
                </Secure>
              }
            />

            {/* FEES */}

            <Route
              path="/fees"
              element={
                <Secure
                  roles={self}
                >
                  <Fees />
                </Secure>
              }
            />

            {/* TRANSPORT SELECTION */}

            <Route
              path="/transport-selection"
              element={
                <Secure
                  roles={[
                    'STUDENT'
                  ]}
                >
                  <TransportSelection />
                </Secure>
              }
            />

            {/* FEE SETTINGS */}

            <Route
              path="/fees/settings"
              element={
                <Secure
                  roles={[
                    'ADMIN'
                  ]}
                >
                  <FeeSettings />
                </Secure>
              }
            />

            {/* PASSES */}

            <Route
              path="/passes"
              element={
                <Secure
                  roles={[
                    'STUDENT',
                    'STAFF'
                  ]}
                >
                  <Passes />
                </Secure>
              }
            />

            {/* MAINTENANCE */}

            <Route
              path="/maintenance"
              element={
                <Secure
                  roles={[
                    'ADMIN',
                    'DRIVER'
                  ]}
                >
                  <Maintenance />
                </Secure>
              }
            />

            {/* SOS */}

            <Route
              path="/sos"
              element={
                <Secure
                  roles={[
                    'ADMIN',
                    'DRIVER'
                  ]}
                >
                  <SOS />
                </Secure>
              }
            />

            {/* PROFILE */}

            <Route
              path="/profile"
              element={
                <Profile />
              }
            />

            {/* USER MANAGEMENT */}

            <Route
              path="/users"
              element={
                <Secure
                  roles={[
                    'ADMIN'
                  ]}
                >
                  <Users />
                </Secure>
              }
            />

            {/* FLEET */}

            <Route
              path="/fleet"
              element={
                <Secure
                  roles={[
                    'ADMIN'
                  ]}
                >
                  <Fleet />
                </Secure>
              }
            />

          </Route>

        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}