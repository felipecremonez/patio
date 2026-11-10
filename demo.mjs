export function seed(ops) {
  if (ops.snapshot().items.length || ops.snapshot().vehicles.length) return;
  const { execute } = ops;
  const catalog = [
    ['MER-001','Arroz tipo 1 · 5 kg','mercadoria','un','A-01',24000,2490,3290,86000],
    ['MER-014','Óleo de soja · 900 ml','mercadoria','un','A-03',24000,618,849,142000],
    ['MER-032','Café torrado · 500 g','mercadoria','un','B-01',20000,1850,2490,42000],
    ['MAT-008','Caixa de papelão M','material','un','D-02',30000,275,0,29000],
    ['EQU-003','Balança de bancada','equipamento','un','Expedição',2000,78000,0,3000],
    ['MER-057','Maçã gala a granel','mercadoria','kg','Hortifruti',12000,599,899,27150],
    ['MAT-013','Detergente neutro · 5 L','material','un','D-04',6000,1480,0,5000]
  ];
  for (const [code,name,kind,unit,location,minimum,cost,price,quantity] of catalog) {
    const item = execute('item',{code,name,kind,unit,location,minimum,cost,price});
    execute('movement',{item,kind:'in',quantity,cost,ref:'Carga inicial',notes:'Dados de demonstração'});
  }
  execute('reserve',{ref:'PED-041',customer:'Reposição · Loja Norte',lines:[{item:1,quantity:18000,price:3290},{item:2,quantity:24000,price:849}]});
  execute('reserve',{ref:'PED-042',customer:'Setor de expedição',lines:[{item:4,quantity:8000,price:0}]});
  execute('movement',{item:3,kind:'out',quantity:6000,price:2490,ref:'BALCÃO-016'});
  const van = execute('vehicle',{plate:'FTR2A19',name:'Fiat Fiorino',state:'available',km:52840});
  const truck = execute('vehicle',{plate:'GHL8F21',name:'VW Delivery 9.170',state:'available',km:91205});
  const pickup = execute('vehicle',{plate:'DVC4J06',name:'Chevrolet Montana',state:'maintenance',km:31450});
  execute('fleetEvent',{vehicle:van,kind:'fuel',km:52840,description:'Abastecimento · rota norte',liters:35200,cost:21990});
  execute('fleetEvent',{vehicle:truck,kind:'trip',km:91205,description:'Entrega · Loja Norte',driver:'Rafael Silva'});
  execute('fleetEvent',{vehicle:pickup,kind:'maintenance',km:31450,description:'Revisão preventiva',cost:48000});
}
