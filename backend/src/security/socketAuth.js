import jwt from 'jsonwebtoken';

export function createSocketAuthenticator({ findUserById, getSecret }) {
  return async (socket, next) => {
    try {
      const token = socket.handshake?.auth?.token;
      if (typeof token !== 'string' || !token) throw new Error('Missing token');
      const payload = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
      if (typeof payload?.id !== 'string') throw new Error('Invalid token');
      const user = await findUserById(payload.id);
      const version = payload.pv === undefined ? 0 : payload.pv;
      if (!user || !Number.isInteger(version) || version !== user.passwordVersion) throw new Error('Expired token');

      socket.data.user = { id: user.id, role: user.role, name: user.name };
      await socket.join(`user:${user.id}`);
      if (user.role === 'ADMIN') await socket.join('role:ADMIN');
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  };
}

export function emitEmergencyUpdate(io, event, incident, payload = incident, adminsOnly = false) {
  if (!io?.to) return;
  io.to('role:ADMIN').emit(event, payload);
  if (!adminsOnly && incident?.driverId) {
    io.to(`user:${incident.driverId}`).emit(event, payload);
  }
}
