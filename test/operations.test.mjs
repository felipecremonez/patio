import test from 'node:test';
import assert from 'node:assert/strict';
import { openOperations } from '../operations.mjs';

const item = {code:'ABC',name:'Produto',kind:'mercadoria',unit:'un',location:'A1',minimum:2000,cost:300,price:550};

test('reservas são atômicas, protegem o saldo e preservam histórico', (t) => {
  const ops = openOperations(':memory:');
  t.after(() => ops.db.close());
  const first = ops.execute('item',item);
  const second = ops.execute('item',{...item,code:'DEF'});
  const entry = {item:first,kind:'in',quantity:10000,cost:300};
  const key = '1234'.repeat(8);
  ops.execute('movement',entry,key);
  ops.execute('movement',entry,key);
  assert.throws(() => ops.execute('movement',{...entry,cost:400},key),/Identificador/);
  ops.execute('movement',{item:first,kind:'in',quantity:10000,cost:500});
  assert.equal(ops.snapshot().items[0].cost,400);
  assert.throws(() => ops.execute('reserve',{ref:'P-1',customer:'Loja',lines:[
    {item:first,quantity:4000,price:550},{item:second,quantity:1000,price:550}
  ]}), /saldo disponível/);
  assert.equal(ops.snapshot().orders.length,0);
  assert.equal(ops.snapshot().movements.length,2);
  const body = {ref:'P-1',customer:'Loja',lines:[{item:first,quantity:4000,price:550}]};
  const order = ops.execute('reserve',body);
  assert.throws(() => ops.execute('movement',{item:first,kind:'out',quantity:17000,price:550}),/saldo disponível/);
  assert.throws(() => ops.execute('movement',{item:first,kind:'count',quantity:3000,notes:'Contagem'}),/saldo disponível/);
  ops.execute('finishOrder',{id:order,action:'fulfill'});
  assert.throws(() => ops.execute('finishOrder',{id:order,action:'fulfill'}),/finalizado/);
  const next = ops.execute('reserve',{...body,ref:'P-2'});
  ops.execute('finishOrder',{id:next,action:'cancel'});
  const current = ops.snapshot().items.find((row) => row.id === first);
  assert.equal(current.stock,16000);
  assert.equal(current.reserved,0);
  assert.equal(ops.snapshot().movements[0].reserved_delta,-4000);
});

test('frota bloqueia viagens duplicadas e protege o hodômetro', (t) => {
  const ops = openOperations(':memory:');
  t.after(() => ops.db.close());
  const vehicle = ops.execute('vehicle',{plate:'ABC1D22',name:'Van',state:'available',km:100});
  const body = {vehicle,kind:'trip',driver:'Ana',description:'Entrega',km:105};
  const trip = ops.execute('fleetEvent',body);
  assert.throws(() => ops.execute('fleetEvent',body),/disponível/);
  ops.execute('fleetEvent',{vehicle,kind:'fuel',km:110,description:'Posto',cost:6400,liters:10000});
  assert.throws(() => ops.execute('returnTrip',{id:trip,km:109,cost:0}),/hodômetro/);
  ops.execute('returnTrip',{id:trip,km:120,cost:1000});
  assert.equal(ops.snapshot().vehicles[0].trip,null);
  assert.equal(ops.snapshot().vehicles[0].km,120);
});
