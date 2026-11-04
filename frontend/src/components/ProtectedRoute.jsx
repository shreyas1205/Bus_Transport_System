import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

const fallbackByRole = {
  STUDENT: '/live-location',
  PARENT: '/',
  DRIVER: '/live-location',
  STAFF: '/fees',
  ADMIN: '/',
};

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="center-page">
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  if (
    roles &&
    !roles.includes(user.role)
  ) {
    return (
      <Navigate
        to={fallbackByRole[user.role] || '/login'}
        replace
      />
    );
  }

  return children;
}