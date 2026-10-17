import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
const router=express.Router();
const statuses=new Set(['OPEN','IN_PROGRESS','RESOLVED','REJECTED']);
const include={user:{select:{id:true,name:true,email:true,institutionId:true,phone:true,role:true}}};

router.get('/',auth,allow('ADMIN','STUDENT','PARENT'),async(req,res)=>{
 const where=req.user.role==='ADMIN'?{}:{userId:req.user.id};
 res.json(await prisma.complaint.findMany({where,include,orderBy:{createdAt:'desc'}}));
});
router.post('/',auth,allow('STUDENT','PARENT'),async(req,res)=>{
 const subject=String(req.body?.subject||'').trim(),description=String(req.body?.description||'').trim(),category=String(req.body?.category||'OTHER').trim()||'OTHER';
 if(!subject||!description)return res.status(400).json({message:'Subject and description are required.'});
 if(subject.length>120||description.length>2000)return res.status(400).json({message:'Complaint is too long.'});
 const c=await prisma.complaint.create({data:{userId:req.user.id,subject,category,description},include});
 const admins=await prisma.user.findMany({where:{role:'ADMIN'},select:{id:true}});
 if(admins.length)await prisma.notification.createMany({data:admins.map(a=>({userId:a.id,type:'GENERAL',title:`New complaint · ${subject}`,message:`${req.user.name||req.user.role} submitted a ${category.replaceAll('_',' ').toLowerCase()} complaint.`}))});
 req.app.get('io')?.emit('complaint:new',c);res.status(201).json(c);
});
router.patch('/:id/status',auth,allow('ADMIN'),async(req,res)=>{
 const status=String(req.body?.status||'').trim(),adminResponse=typeof req.body?.adminResponse==='string'?req.body.adminResponse.trim():undefined;
 if(!statuses.has(status))return res.status(400).json({message:'Invalid complaint status.'});
 const old=await prisma.complaint.findUnique({where:{id:req.params.id}});if(!old)return res.status(404).json({message:'Complaint not found.'});
 const c=await prisma.complaint.update({where:{id:old.id},data:{status,...(adminResponse!==undefined?{adminResponse:adminResponse||null}:{}),resolvedAt:status==='RESOLVED'?(old.resolvedAt||new Date()):null},include});
 await prisma.notification.create({data:{userId:old.userId,type:'GENERAL',title:`Complaint ${status.replaceAll('_',' ').toLowerCase()}`,message:adminResponse||`Your complaint "${old.subject}" is now ${status.replaceAll('_',' ').toLowerCase()}.`}});
 req.app.get('io')?.emit('complaint:update',c);res.json(c);
});
export default router;
