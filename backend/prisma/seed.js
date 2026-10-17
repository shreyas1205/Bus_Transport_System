import 'dotenv/config';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
const prisma=new PrismaClient();
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');

async function upsertUser(data){return prisma.user.upsert({where:{email:data.email},update:data,create:data});}
async function main(){
  await prisma.routeStop.deleteMany(); await prisma.routeChange.deleteMany(); await prisma.vehicleLocation.deleteMany(); await prisma.boardingEvent.deleteMany(); await prisma.busPass.deleteMany(); await prisma.payment.deleteMany(); await prisma.fee.deleteMany(); await prisma.vehicleService.deleteMany(); await prisma.incident.deleteMany(); await prisma.studentProfile.deleteMany(); await prisma.staffProfile.deleteMany(); await prisma.driverProfile.deleteMany(); await prisma.parentProfile.deleteMany(); await prisma.route.deleteMany(); await prisma.user.deleteMany(); await prisma.stop.deleteMany(); await prisma.vehicle.deleteMany();
  const stops=[];
  for(const [name,lat,lon,radius,transportFee] of [['Main Gate',12.9719,77.5937,120,12000],['Metro Station',12.9754,77.5992,150,14000],['Hostel Block A',12.9688,77.6009,150,16000],['Tech Park',12.9656,77.5928,150,18000],['City Mall',12.9634,77.5872,150,20000]]) stops.push(await prisma.stop.create({data:{name,locationText:name,latitude:lat,longitude:lon,geofenceM:radius,transportFee}}));
  const bus=await prisma.vehicle.create({data:{busNumber:'1',registrationNo:'KA-01-CB-101',model:'Ashok Leyland Viking',capacity:52,odometerKm:12480,lastServiceKm:10000,status:'ACTIVE',latitude:12.9700,longitude:77.5940,speedKmph:26}}).catch(async()=>prisma.vehicle.create({data:{busNumber:'1',registrationNo:'KA-01-CB-101',model:'Ashok Leyland Viking',capacity:52}}));
  const bus2=await prisma.vehicle.create({data:{busNumber:'2',registrationNo:'KA-01-CB-102',model:'Tata Starbus',capacity:40,odometerKm:5000,lastServiceKm:0,status:'ACTIVE',latitude:12.965,longitude:77.589,speedKmph:22}});
  const admin=await upsertUser({name:'Admin User',email:'admin@campusbus.local',passwordHash:hash('Pass@123'),role:'ADMIN',institutionId:'ADM001'});
  const driver=await upsertUser({name:'Ravi Kumar',email:'driver1@campusbus.local',passwordHash:hash('Pass@123'),role:'DRIVER',phone:'9000000001',institutionId:'DRV001'});
  await prisma.driverProfile.create({data:{userId:driver.id,licenseNumber:'KA-DL-99881',licenseExpiry:new Date('2028-10-15')}});
  const route=await prisma.route.create({data:{code:'CB-R1',name:'North Campus Loop',description:'Main Gate → Metro → Hostel → Tech Park',assignedBusId:bus.id,assignedDriverId:driver.id}});
  for(const [i,s] of stops.entries()) await prisma.routeStop.create({data:{routeId:route.id,stopId:s.id,sequence:i+1,plannedEta:`${7+i}:1${i}`}});
  const student=await upsertUser({name:'Ananya Sharma',email:'student1@campusbus.local',passwordHash:hash('Pass@123'),role:'STUDENT',phone:'9000000002',institutionId:'23CSE001',assignedRouteId:route.id,pickupStopId:stops[2].id});
  await prisma.studentProfile.create({data:{userId:student.id,course:'B.Tech CSE',semester:'5',guardianName:'Meera Sharma',guardianPhone:'9000000003'}});
  const staff=await upsertUser({name:'Dr. Priya Rao',email:'staff1@campusbus.local',passwordHash:hash('Pass@123'),role:'STAFF',phone:'9000000004',institutionId:'STAFF001',assignedRouteId:route.id,pickupStopId:stops[0].id});
  await prisma.staffProfile.create({data:{userId:staff.id,department:'Computer Science'}});
  const parent=await upsertUser({name:'Meera Sharma',email:'parent1@campusbus.local',passwordHash:hash('Pass@123'),role:'PARENT',phone:'9000000003',institutionId:'PAR001'});
  await prisma.parentProfile.create({data:{userId:parent.id,studentId:student.id}});
  const due=new Date(); due.setDate(due.getDate()+10);
  await prisma.fee.createMany({data:[{userId:student.id,academicYear:'2026-27',amount:18000,dueDate:due},{userId:staff.id,academicYear:'2026-27',amount:12000,dueDate:due}]});
  const now=new Date(); const end=new Date(now); end.setDate(end.getDate()+30);
  await prisma.busPass.create({data:{userId:student.id,routeId:route.id,passNumber:'CB-PASS-1001',validFrom:now,validUntil:end,status:'ACTIVE',qrPayload:'23CSE001|CB-PASS-1001'}});
  await prisma.vehicleService.create({data:{vehicleId:bus.id,serviceType:'Oil + brake inspection',serviceKm:10000,notes:'Routine service'}});
  await prisma.incident.create({data:{vehicleId:bus2.id,driverId:driver.id,type:'BREAKDOWN',priority:8,message:'Demo unresolved breakdown for dashboard'}});
  console.log('Seed complete. Admin:',admin.email);
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());

