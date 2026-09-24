import express from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const allowedCreateRoles = new Set(['FLEET_MANAGER','DRIVER','STUDENT','STAFF','PARENT']);
const aiCreateRoles = new Set(['DRIVER','STUDENT','PARENT']);

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '.')
  .replace(/^\.+|\.+$/g, '')
  .replace(/\.{2,}/g, '.');

const roleFromText = (value) => {
  const role = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const aliases = {
    STUDENT: 'STUDENT', STUDENTS: 'STUDENT', STUD: 'STUDENT', S: 'STUDENT',
    DRIVER: 'DRIVER', DRIVERS: 'DRIVER', DRV: 'DRIVER', D: 'DRIVER',
    PARENT: 'PARENT', PARENTS: 'PARENT', MOM: 'PARENT', DAD: 'PARENT',
  };
  return aliases[role] || (aiCreateRoles.has(role) ? role : null);
};

function generateTempPassword() {
  return `Cb!${crypto.randomBytes(5).toString('hex')}`;
}

router.get('/', auth, allow('ADMIN'), async (req, res) => {
  const where = req.query.role ? { role: req.query.role } : {};
  const users = await prisma.user.findMany({
    where,
    select: {
      id:true,name:true,email:true,role:true,phone:true,institutionId:true,
      assignedRoute:true,pickupStop:true
    },
    orderBy:{name:'asc'}
  });
  res.json(users);
});

router.post('/', auth, allow('ADMIN'), async (req, res) => {
  const {
    name, email, password, role, phone, institutionId,
    licenseNumber, licenseExpiry, course, semester, department, studentId
  } = req.body || {};

  if (!name?.trim() || !email?.trim() || !password || !role) {
    return res.status(400).json({message:'Name, email, password and role are required'});
  }
  if (!allowedCreateRoles.has(role)) {
    return res.status(400).json({message:'This account role cannot be created from the Admin panel'});
  }
  if (String(password).length < 6) {
    return res.status(400).json({message:'Password must be at least 6 characters'});
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          passwordHash: hash(String(password)),
          role,
          phone: phone?.trim() || null,
          institutionId: institutionId?.trim() || null
        }
      });

      if (role === 'DRIVER') {
        await tx.driverProfile.create({
          data: {
            userId:user.id,
            licenseNumber: licenseNumber?.trim() || 'PENDING',
            licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null
          }
        });
      }
      if (role === 'STUDENT') {
        await tx.studentProfile.create({
          data:{userId:user.id, course:course?.trim()||null, semester:semester?.trim()||null}
        });
      }
      if (role === 'STAFF') {
        await tx.staffProfile.create({
          data:{userId:user.id, department:department?.trim()||null}
        });
      }
      if (role === 'PARENT') {
        await tx.parentProfile.create({
          data:{userId:user.id, studentId:studentId?.trim()||null}
        });
      }
      return user;
    });

    res.status(201).json({
      id:created.id,
      name:created.name,
      email:created.email,
      role:created.role,
      phone:created.phone,
      institutionId:created.institutionId,
      passwordProvided:true
    });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({message:'Email or institution ID already exists'});
    throw e;
  }
});

// AI-assisted bulk credential automation. It turns a simple roster into accounts,
// generating unique login emails, strong temporary passwords and institution IDs.
router.post('/ai-bulk-create', auth, allow('ADMIN'), async (req, res) => {
  const raw = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!raw.length) return res.status(400).json({message:'Add at least one roster record'});
  if (raw.length > 100) return res.status(400).json({message:'You can create up to 100 accounts at a time'});

  const records = raw.map((r, index) => ({
    index,
    name: String(r?.name || '').trim(),
    role: roleFromText(r?.role),
    phone: String(r?.phone || '').trim(),
    institutionId: String(r?.institutionId || '').trim(),
    studentId: String(r?.studentId || '').trim(),
    course: String(r?.course || '').trim(),
    semester: String(r?.semester || '').trim(),
    licenseNumber: String(r?.licenseNumber || '').trim(),
    licenseExpiry: String(r?.licenseExpiry || '').trim(),
  }));

  const invalid = records.filter(r => !r.name || !r.role);
  if (invalid.length) {
    return res.status(400).json({
      message:'Each line needs a name and role (Driver, Student or Parent)',
      invalid: invalid.map(r => ({index:r.index+1,name:r.name,role:r.role}))
    });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findMany({select:{email:true,institutionId:true}});
      const emails = new Set(existing.map(x => String(x.email).toLowerCase()));
      const ids = new Set(existing.map(x => x.institutionId).filter(Boolean));
      const output = [];
      const year = new Date().getFullYear();

      const nextEmail = (name) => {
        const base = slugify(name) || `user${Date.now()}`;
        let email = `${base}@campusbus.local`;
        let n = 2;
        while (emails.has(email)) email = `${base}.${n++}@campusbus.local`;
        emails.add(email);
        return email;
      };

      const nextInstitutionId = (role) => {
        const prefix = role === 'DRIVER' ? 'DRV' : role === 'PARENT' ? 'PAR' : 'STU';
        let n = 1;
        let id = `${prefix}-${year}-${String(n).padStart(3,'0')}`;
        while (ids.has(id)) id = `${prefix}-${year}-${String(++n).padStart(3,'0')}`;
        ids.add(id);
        return id;
      };

      for (const r of records) {
        const email = nextEmail(r.name);
        const password = generateTempPassword();
        const institutionId = r.institutionId || nextInstitutionId(r.role);

        const user = await tx.user.create({
          data:{
            name:r.name,
            email,
            passwordHash:hash(password),
            role:r.role,
            phone:r.phone || null,
            institutionId,
          }
        });

        if (r.role === 'DRIVER') {
          await tx.driverProfile.create({data:{
            userId:user.id,
            licenseNumber:r.licenseNumber || 'PENDING',
            licenseExpiry:r.licenseExpiry ? new Date(r.licenseExpiry) : null,
          }});
        }
        if (r.role === 'STUDENT') {
          await tx.studentProfile.create({data:{
            userId:user.id,
            course:r.course || null,
            semester:r.semester || null,
          }});
        }
        if (r.role === 'PARENT') {
          await tx.parentProfile.create({data:{
            userId:user.id,
            studentId:r.studentId || null,
          }});
        }

        output.push({
          id:user.id,
          name:user.name,
          role:user.role,
          email,
          password,
          institutionId,
          phone:user.phone,
        });
      }
      return output;
    });

    res.status(201).json({message:`Created ${created.length} account${created.length===1?'':'s'} automatically.`,created});
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({message:'A generated account conflicted with an existing email or institution ID. Please retry this batch.'});
    throw e;
  }
});

router.patch('/:id/role',auth,allow('ADMIN'),async(req,res)=>{
  const user=await prisma.user.update({where:{id:req.params.id},data:{role:req.body.role}});
  res.json(user);
});

router.patch('/:id/phone',auth,allow('ADMIN'),async(req,res)=>{
  const phone=typeof req.body.phone==='string'?req.body.phone.trim():'';
  const target=await prisma.user.findUnique({where:{id:req.params.id},select:{id:true,role:true}});
  if(!target)return res.status(404).json({message:'User not found'});
  if(target.role!=='DRIVER')return res.status(400).json({message:'Only driver phone numbers can be changed here'});
  const user=await prisma.user.update({where:{id:req.params.id},data:{phone:phone||null},select:{id:true,name:true,email:true,role:true,phone:true,institutionId:true}});
  res.json(user);
});

export default router;
