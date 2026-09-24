import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

const statuses = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']);

const complaintInclude = {
  user: { select: { id: true, name: true, email: true, institutionId: true, phone: true } },
};

router.get('/', auth, allow('ADMIN', 'STUDENT'), async (req, res) => {
  const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
  const complaints = await prisma.complaint.findMany({
    where,
    include: complaintInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(complaints);
});

router.post('/', auth, allow('STUDENT'), async (req, res) => {
  const subject = String(req.body?.subject || '').trim();
  const description = String(req.body?.description || '').trim();
  const category = String(req.body?.category || 'OTHER').trim() || 'OTHER';

  if (!subject || !description) {
    return res.status(400).json({ message: 'Subject and description are required.' });
  }
  if (subject.length > 120) {
    return res.status(400).json({ message: 'Subject must be 120 characters or fewer.' });
  }
  if (description.length > 2000) {
    return res.status(400).json({ message: 'Description must be 2000 characters or fewer.' });
  }

  const complaint = await prisma.complaint.create({
    data: {
      userId: req.user.id,
      subject,
      category,
      description,
    },
    include: complaintInclude,
  });

  req.app.get('io')?.emit('complaint:new', complaint);
  res.status(201).json(complaint);
});

router.patch('/:id/status', auth, allow('ADMIN'), async (req, res) => {
  const status = String(req.body?.status || '').trim();
  const adminResponse = typeof req.body?.adminResponse === 'string'
    ? req.body.adminResponse.trim()
    : undefined;

  if (!statuses.has(status)) {
    return res.status(400).json({ message: 'Invalid complaint status.' });
  }

  const existing = await prisma.complaint.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: 'Complaint not found.' });

  const data = {
    status,
    ...(adminResponse !== undefined ? { adminResponse: adminResponse || null } : {}),
    resolvedAt: status === 'RESOLVED' ? (existing.resolvedAt || new Date()) : null,
  };

  const complaint = await prisma.complaint.update({
    where: { id: req.params.id },
    data,
    include: complaintInclude,
  });

  req.app.get('io')?.emit('complaint:update', complaint);
  res.json(complaint);
});

export default router;
