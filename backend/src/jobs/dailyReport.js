import { isDemoMode } from '../demoMode.js';
import nodemailer from 'nodemailer';
import { prisma } from '../prisma.js';

export async function generateAndSendDailyReport(dateInput) {
  const date=new Date(dateInput); date.setHours(0,0,0,0); const end=new Date(date); end.setDate(end.getDate()+1);
  const events=await prisma.boardingEvent.findMany({where:{scannedAt:{gte:date,lt:end}},include:{user:{select:{name:true,institutionId:true,role:true}}}});
  const boarded=events.filter(e=>e.status==='BOARDED').length; const rejected=events.filter(e=>e.status==='REJECTED').length;
  const report={date:date.toISOString().slice(0,10),boarded,rejected,total:events.length};
  if(!isDemoMode() && process.env.SMTP_HOST && process.env.REPORT_EMAIL){
    const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
    await transporter.sendMail({from:process.env.SMTP_USER,to:process.env.REPORT_EMAIL,subject:`NaviGuard Daily Attendance ${report.date}`,text:JSON.stringify(report,null,2)});
    report.emailSent=true;
  } else report.emailSent=false;
  return report;
}

export function startDailyReportJob() {
  if (isDemoMode()) return;
  const tick=async()=>{ const d=new Date(); d.setDate(d.getDate()-1); try{ await generateAndSendDailyReport(d); }catch(err){console.error('Daily report job failed',err.message);} };
  const nextRun=new Date(); nextRun.setHours(0,5,0,0); if(nextRun<=new Date()) nextRun.setDate(nextRun.getDate()+1);
  setTimeout(()=>{tick(); setInterval(tick,24*60*60*1000);}, nextRun.getTime()-Date.now());
}
