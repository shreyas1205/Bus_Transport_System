import {BrowserRouter,Routes,Route} from 'react-router-dom';
import {AuthProvider} from './auth';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
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
import './styles.css';
const all=['ADMIN','FLEET_MANAGER','DRIVER','STUDENT','STAFF','PARENT'];
const boarding=['ADMIN','FLEET_MANAGER','DRIVER'];
const self=['STUDENT','STAFF','PARENT'];
const ops=['ADMIN','FLEET_MANAGER'];
const dashboardRoles=['ADMIN','FLEET_MANAGER'];
const routeRoles=['ADMIN','FLEET_MANAGER','DRIVER'];
function Secure({children,roles}){return <ProtectedRoute roles={roles}>{children}</ProtectedRoute>}
export default function App(){return <AuthProvider><BrowserRouter><Routes>
  <Route path="/login" element={<Login/>}/>
  <Route element={<Secure roles={all}><Layout/></Secure>}>
    <Route path="/" element={<Secure roles={dashboardRoles}><Dashboard/></Secure>}/>
    <Route path="/routes" element={<Secure roles={routeRoles}><RoutesPage/></Secure>}/>
    <Route path="/complaints" element={<Secure roles={['ADMIN','STUDENT']}><Complaints/></Secure>}/>
    <Route path="/live-location" element={<Secure roles={['ADMIN','STUDENT','PARENT']}><LiveLocation/></Secure>}/>
    <Route path="/boarding" element={<Secure roles={boarding}><Boarding/></Secure>}/>
    <Route path="/boarding-status" element={<Secure roles={['STUDENT','PARENT']}><BoardingStatus/></Secure>}/>
    <Route path="/fees" element={<Secure roles={self}><Fees/></Secure>}/>
    <Route path="/transport-selection" element={<Secure roles={['STUDENT']}><TransportSelection/></Secure>}/>
    <Route path="/fees/settings" element={<Secure roles={['ADMIN']}><FeeSettings/></Secure>}/>
    <Route path="/passes" element={<Secure roles={self}><Passes/></Secure>}/>
    <Route path="/maintenance" element={<Secure roles={ops}><Maintenance/></Secure>}/>
    <Route path="/sos" element={<Secure roles={['ADMIN','FLEET_MANAGER','DRIVER']}><SOS/></Secure>}/>
    <Route path="/profile" element={<Profile/>}/>
    <Route path="/users" element={<Secure roles={['ADMIN']}><Users/></Secure>}/><Route path="/fleet" element={<Secure roles={['ADMIN']}><Fleet/></Secure>}/>
  </Route>
</Routes></BrowserRouter></AuthProvider>}
