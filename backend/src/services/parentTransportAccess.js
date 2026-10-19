import { prisma } from '../prisma.js';

// Explicit, operator-maintained approvals after independent guardianship checks.
// Phone matching only proposes a link; it never grants transport access.
export async function verifiedParentStudent(parentId, db = prisma) {
  const profile = await db.parentProfile.findUnique({ where: { userId: parentId }, select: { studentId: true } });
  if (!profile?.studentId) return null;
  let approvals;
  try { approvals = JSON.parse(process.env.VERIFIED_GUARDIAN_LINKS || '[]'); } catch { return null; }
  if (!Array.isArray(approvals) || !approvals.some(link => link?.parentId === parentId && link?.studentId === profile.studentId)) return null;
  const student = await db.user.findUnique({ where: { id: profile.studentId }, select: { id: true, role: true } });
  return student?.role === 'STUDENT' ? student.id : null;
}

export async function requireVerifiedParentTransport(req, res, next) {
  if (req.user.role !== 'PARENT') return next();
  try {
    const studentId = await verifiedParentStudent(req.user.id);
    if (!studentId) return res.status(403).json({ message: 'Guardian verification is required. Contact Admin to verify your student link.' });
    req.verifiedStudentId = studentId;
    next();
  } catch (error) { next(error); }
}
