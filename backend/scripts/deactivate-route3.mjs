import 'dotenv/config';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma.js';
try {
 const result = await prisma.$transaction(async tx => {
  const matches = await tx.route.findMany({where:{name:'West block',code:'Route 3'}});
  assert.equal(matches.length,1,'Expected exactly one matching route');
  assert.equal(matches[0].id,'cmule6z0u0002m8o8u11pvhm7','Unexpected route ID');
  const protectedState = async () => ({route:await tx.route.findUnique({where:{code:'CB-R1'}}),bus:await tx.vehicle.findUnique({where:{registrationNo:'KA-01-CB-101'}})});
  const before=await protectedState();
  assert.equal(before.route.isActive,true);
  assert.equal((await tx.user.findUnique({where:{id:before.route.assignedDriverId}})).name,'Ravi Kumar');
  const history=async()=>Promise.all([tx.boardingEvent.count(),tx.vehicleLocation.count(),tx.incident.count(),tx.routeChange.count(),tx.route.count()]);
  const counts=await history();
  const updated=await tx.route.update({where:{id:matches[0].id},data:{isActive:false}});
  assert.deepEqual(await protectedState(),before);
  assert.deepEqual(await history(),counts);
  assert.equal(await tx.route.count({where:{id:updated.id,isActive:true}}),0);
  return {route3:{id:updated.id,code:updated.code,name:updated.name,isActive:updated.isActive},cbR1:before.route,bus:before.bus,historyCountsUnchanged:counts};
 });
 console.log(JSON.stringify(result,null,2));
} finally {await prisma.$disconnect()}
