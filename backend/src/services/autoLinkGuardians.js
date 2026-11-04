/**
 * Admin-provisioned guardian contact matching for NaviGuard's one-student
 * ParentProfile. No one manually supplies a database user ID.
 * Only link when exactly one student and one parent share a valid Indian
 * guardian mobile number, and do not overwrite an existing different link.
 * Both phone fields are ADMIN-maintained: production must verify guardian
 * ownership (college ERP or OTP) before trusting them for private data.
 */
export function normalizeGuardianPhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const input = String(value).trim();
  if (!/^\+?[\d\s()-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2);
  return null;
}

export async function reconcileGuardianLinks(db) {
  const [students, parents] = await Promise.all([
    db.user.findMany({
      where: { role: 'STUDENT' },
      select: {
        id: true,
        institutionId: true,
        studentProfile: { select: { guardianPhone: true } }
      }
    }),
    db.user.findMany({
      where: { role: 'PARENT' },
      select: {
        id: true,
        phone: true,
        parentProfile: { select: { studentId: true } }
      }
    })
  ]);

  const studentsByPhone = new Map();
  const parentsByPhone = new Map();
  for (const student of students) {
    const phone = normalizeGuardianPhone(student.studentProfile?.guardianPhone);
    if (phone) studentsByPhone.set(phone, [...(studentsByPhone.get(phone) || []), student]);
  }
  for (const parent of parents) {
    const phone = normalizeGuardianPhone(parent.phone);
    if (phone) parentsByPhone.set(phone, [...(parentsByPhone.get(phone) || []), parent]);
  }

  let linked = 0;
  let ambiguous = 0;
  // Revoke stale/ambiguous grants before considering new links. Do not silently
  // transfer a conflicting existing link to a different student in this run.
  const revoked = new Set();
  for (const parent of parents) {
    const existing = parent.parentProfile?.studentId;
    if (!existing) continue;
    const phone = normalizeGuardianPhone(parent.phone);
    const matches = studentsByPhone.get(phone) || [];
    const valid = matches.length === 1 && parentsByPhone.get(phone)?.length === 1 &&
      (existing === matches[0].id || existing === matches[0].institutionId);
    if (!valid) {
      await db.parentProfile.update({where: {userId: parent.id}, data: {studentId: null}});
      revoked.add(parent.id);
    }
  }
  for (const [phone, candidateParents] of parentsByPhone) {
    const candidateStudents = studentsByPhone.get(phone) || [];
    // The current schema stores ONE student per parent. Never guess among siblings.
    if (candidateStudents.length > 1 || candidateParents.length > 1) {
      ambiguous++;
      continue;
    }
    if (candidateStudents.length !== 1 || candidateParents.length !== 1) continue;
    const student = candidateStudents[0];
    const parent = candidateParents[0];
    if (!parent.parentProfile || revoked.has(parent.id)) continue;
    const existing = parent.parentProfile.studentId;
    // Never hijack an existing different link.
    if (existing && existing !== student.id && existing !== student.institutionId) continue;
    if (existing === student.id) continue;
    await db.parentProfile.update({
      where: { userId: parent.id },
      data: { studentId: student.id }
    });
    linked++;
  }
  return { linked, ambiguous };
}
