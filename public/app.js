const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const amount = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3});
const calendar = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'});
const money = (value) => currency.format(value / 100);
const quantity = (value) => amount.format(value / 1000);
const date = (value) => calendar.format(new Date(value));
const glyphs = {
  inventory:'M3 7l9-4 9 4v10l-9 4-9-4zm0 0 9 4 9-4m-9 4v10',
  movements:'M4 7h15m-4-4 4 4-4 4m5 6H5m4-4-4 4 4 4',
  orders:'M7 4h10v3h3v14H4V7h3zm0 3h10m-9 5h8m-8 4h8',
  fleet:'M3 5h12v12H3zm12 5h4l2 3v4h-6M7 20a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm11 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  plus:'M12 5v14M5 12h14',
  search:'M15 15l5 5m-4-9a5 5 0 1 1-10 0 5 5 0 0 1 10 0z',
  alert:'M12 3 2 20h20L12 3zm0 6v4m0 3v1',
  arrow:'M5 12h14m-5-5 5 5-5 5'
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${glyphs[name]}"/></svg>`;
const pages = { inventory:'Estoque', movements:'Movimentações', orders:'Pedidos', fleet:'Frota' };
const kinds = { mercadoria:'Mercadoria', equipamento:'Equipamento', material:'Material' };
const movements = { in:'Entrada',out:'Saída',count:'Inventário',reserve:'Reserva',fulfill:'Baixa de pedido',cancel:'Liberação' };
const orders = { reserved:'Reservado',fulfilled:'Atendido',cancelled:'Cancelado' };
const states = { available:'Disponível',maintenance:'Em manutenção',inactive:'Inativo',trip:'Em viagem' };
const fleetKinds = { trip:'Viagem',fuel:'Abastecimento',maintenance:'Manutenção' };
const options = (entries, current) => Object.entries(entries).map(([value,label]) =>
  `<option value="${escape(value)}"${String(value) === String(current) ? ' selected' : ''}>${escape(label)}</option>`).join('');
const badge = (text, tone = '') => `<span class="badge ${tone}">${escape(text)}</span>`;
const button = (text, action, id = '', variant = 'secondary') =>
  `<button type="button" class="${variant}" data-action="${action}"${id === '' ? '' : ` data-id="${id}"`}>${text}</button>`;
const empty = (title, detail) => `<div class="empty"><strong>${title}</strong><p>${detail}</p></div>`;
const head = (name, kicker, description, actions) => `<header class="page-head"><div><p class="eyebrow">${kicker}</p>
  <h1>${name}</h1><p>${description}</p></div><div class="head-actions">${actions}</div></header>`;
const table = (columns, rows, label) => `<div class="table-wrap" tabindex="0" role="region" aria-label="${label}"><table>
  <thead><tr>${columns.map((label) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
let data;
let page = 'inventory';
let filter = 'all';
let search = '';
let toastTimer;
let busy = false;

async function api(command = 'state', body, requestId) {
  const response = await fetch('/api/' + command, body ? {
    method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
}
function render() {
  $('#nav').innerHTML = Object.entries(pages).map(([key,label]) =>
    `<button type="button" data-page="${key}" ${page === key ? 'aria-current="page"' : ''}>${icon(key)}${label}</button>`).join('');
  $('#mode').textContent = data.demo ? 'DEMONSTRAÇÃO' : 'BASE LOCAL';
  $('#mode-caption').textContent = data.demo ? 'Registros fictícios para explorar' : 'Registros neste computador';
  $('#view').innerHTML = ({ inventory, movements:movementsPage, orders:ordersPage, fleet:fleetPage })[page]();
  $('#view').setAttribute('aria-busy','false');
  if (page === 'inventory') renderItems();
}
const available = (item) => item.stock - item.reserved;
const low = (item) => available(item) <= item.minimum;
const metric = (name, value, detail, glyph, tone = '') =>
  `<article class="metric ${tone}"><span class="metric-symbol">${icon(glyph)}</span><span>${name}</span>
    <strong>${value}</strong><small>${detail}</small></article>`;
function inventory() {
  const items = data.items;
  const value = Math.round(items.reduce((sum,i) => sum + i.stock * i.cost / 1000,0));
  const lowCount = items.filter(low).length;
  const active = data.orders.filter((order) => order.state === 'reserved').length;
  return head('Controle de estoque','ALMOXARIFADO / 01','Acompanhe mercadorias, materiais e equipamentos em um só lugar.',
    button(icon('movements') + ' Movimentar','movement') + button(icon('plus') + ' Novo item','item','','primary')) +
    `<section class="metrics" aria-label="Resumo do estoque">
      ${metric('Itens cadastrados',items.length,'Mercadorias, materiais e equipamentos','inventory')}
      ${metric('Estoque a custo',money(value),'Saldo físico × custo unitário','inventory','mint')}
      ${metric('Abaixo ou no mínimo',lowCount,'Considera o saldo disponível','alert','amber')}
      ${metric('Pedidos reservados',active,'Aguardando baixa ou liberação','orders','blue')}
    </section>
    <section class="panel" aria-labelledby="inventory-title">
      <div class="panel-head"><div><p class="eyebrow">CATÁLOGO</p><h2 id="inventory-title">Saldos por item</h2></div>
      <label class="search">${icon('search')}<input id="search" type="search" value="${escape(search)}" aria-label="Buscar por nome, código ou local" placeholder="Buscar nome, código ou local"></label></div>
      <div class="list-controls"><div class="filters" aria-label="Filtros do catálogo">
        ${Object.entries({all:'Todos',mercadoria:'Mercadorias',equipamento:'Equipamentos',material:'Materiais',low:'Estoque baixo'}).map(([key,label]) =>
          `<button type="button" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join('')}
      </div><span id="catalog-count"></span></div>
      <div id="items"></div>
    </section>`;
}
function renderItems() {
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const rows = data.items.filter((i) =>
    (filter === 'all' || i.kind === filter || (filter === 'low' && low(i))) &&
    [i.name,i.code,i.location].some((text) => text.toLocaleLowerCase('pt-BR').includes(query)));
  $('#catalog-count').textContent = rows.length + (rows.length === 1 ? ' item' : ' itens');
  $('#items').innerHTML = rows.length ? table(['Item','Local','Físico','Reservado','Disponível','Custo un.','Venda un.','Ações'],rows.map((i) =>
    `<tr><td><strong>${escape(i.name)}</strong><small>${escape(i.code)} · ${kinds[i.kind]} · ${escape(i.unit)}</small></td>
      <td>${escape(i.location || '—')}</td><td class="numeric">${quantity(i.stock)}</td><td class="numeric reserved">${quantity(i.reserved)}</td>
      <td>${badge(quantity(available(i)),low(i) ? 'warning' : 'positive')}</td><td class="numeric">${money(i.cost)}</td><td class="numeric">${money(i.price)}</td>
      <td><div class="row-actions">${button('Editar','item',i.id,'link')}${button('Movimentar','movement',i.id,'link')}</div></td></tr>`), 'Saldo, custo e preço dos itens')
    : data.items.length ? empty('Nenhum item corresponde à busca','Altere a busca ou o filtro.')
    : empty('Cadastre seu primeiro item','Use Novo item para cadastrar. Depois lance a entrada para registrar o saldo inicial.');
}
function movementsPage() {
  const rows = data.movements.map((m) => `<tr><td>${date(m.created)}</td><td><strong>${escape(m.name)}</strong><small>${escape(m.code)} · ${escape(m.unit)}</small></td>
    <td>${badge(movements[m.kind], m.delta < 0 ? 'warning' : m.delta > 0 ? 'positive' : 'info')}</td>
    <td class="numeric">${m.delta > 0 ? '+' : ''}${quantity(m.delta)}</td><td class="numeric">${m.reserved_delta > 0 ? '+' : ''}${quantity(m.reserved_delta)}</td>
    <td class="numeric">${quantity(m.balance)} / ${quantity(m.reserved_balance)}</td><td class="numeric">${money(m.cost)} / ${money(m.price)}</td>
    <td>${escape(m.ref || '—')}${m.notes ? `<small>${escape(m.notes)}</small>` : ''}</td></tr>`);
  return head('Movimentações','ALMOXARIFADO / 02','Consulte entradas, saídas, ajustes de inventário e alterações nas reservas.',
    button(icon('plus') + ' Movimentar','movement','','primary')) +
    `<section class="panel"><div class="panel-head"><div><p class="eyebrow">RASTREABILIDADE</p><h2>Histórico de estoque</h2></div></div>
    ${rows.length ? table(['Data','Item','Operação','Físico Δ','Reserva Δ','Saldo / reserva','Custo / venda un.','Referência'],rows,'Histórico de movimentações') : empty('Nenhuma movimentação registrada','As alterações no saldo aparecem aqui.')}</section>`;
}
function ordersPage() {
  const rows = data.orders.map((order) => {
    const lines = data.lines.filter((line) => line.order_id === order.id);
    const total = Math.round(lines.reduce((sum,line) => sum + line.price * line.quantity / 1000,0));
    return `<tr><td><strong>${escape(order.ref)}</strong><small>${escape(order.customer)}</small></td><td>${date(order.created)}</td>
      <td>${badge(orders[order.state], order.state === 'reserved' ? 'warning' : order.state === 'fulfilled' ? 'positive' : '')}</td>
      <td class="numeric">${money(total)}</td><td>${button('Ver pedido','viewOrder',order.id,'link')}</td></tr>`;
  });
  return head('Pedidos','EXPEDIÇÃO / 03','Separe produtos por pedido e dê baixa somente quando a saída acontecer.',
    button(icon('plus') + ' Reservar pedido','reserve','','primary')) +
    `<section class="panel"><div class="panel-head"><div><p class="eyebrow">RESERVAS E BAIXAS</p><h2>Pedidos cadastrados</h2></div></div>
    ${rows.length ? table(['Pedido / cliente ou setor','Criado em','Situação','Valor','Ação'],rows,'Pedidos e reservas') : empty('Nenhum pedido registrado','Crie uma reserva com itens que tenham saldo disponível.')}</section>`;
}
function fleetPage() {
  const list = data.vehicles;
  const cards = list.map((v) => `<article class="vehicle">
    <div class="vehicle-top"><span class="vehicle-icon">${icon('fleet')}</span>${badge(states[v.trip ? 'trip' : v.state],v.trip ? 'info' : v.state === 'available' ? 'positive' : v.state === 'maintenance' ? 'warning' : '')}</div>
    <p class="eyebrow">${escape(v.plate)}</p><h2>${escape(v.name)}</h2><p class="vehicle-km">${amount.format(v.km)} km</p>
    <div class="row-actions">${button('Editar','vehicle',v.id,'link')}${v.trip ? button('Registrar retorno','returnTrip',v.trip,'primary') : ''}</div>
    </article>`).join('');
  const events = data.fleet.map((f) => `<tr><td>${date(f.started)}${f.kind === 'trip' && f.completed ? `<small>Retorno em ${date(f.completed)}</small>` : ''}</td>
    <td><strong>${escape(f.plate)}</strong><small>${escape(f.name)}</small></td><td>${badge(fleetKinds[f.kind], f.kind === 'trip' ? 'info' : 'positive')}</td>
    <td>${escape(f.description)}${f.driver ? `<small>${escape(f.driver)}</small>` : ''}</td>
    <td>${amount.format(f.start_km)}${f.kind === 'trip' ? f.end_km == null ? ' · em viagem' : ' → ' + amount.format(f.end_km) : ''}</td>
    <td>${f.kind === 'fuel' ? quantity(f.liters) + ' L' : '—'}</td>
    <td class="numeric">${f.completed ? money(f.cost) : '—'}</td></tr>`);
  return head('Controle de frota','TRANSPORTE / 04','Registre saídas, retornos, abastecimentos e manutenções.',
    button(icon('fleet') + ' Registrar uso','fleetEvent') + button(icon('plus') + ' Novo veículo','vehicle','','primary')) +
    `<div class="vehicle-grid">${cards || `<section class="panel">${empty('Nenhum veículo cadastrado','Use Novo veículo para começar a controlar a frota.')}</section>`}</div>
    <section class="panel"><div class="panel-head"><div><p class="eyebrow">DIÁRIO DA FROTA</p><h2>Registros de uso</h2></div></div>
    ${events.length ? table(['Data','Veículo','Tipo','Descrição','Hodômetro','Volume','Custo'],events,'Histórico de uso da frota') : empty('Nenhum registro de frota','Use Registrar uso para lançar uma viagem, abastecimento ou manutenção.')}</section>`;
}

const input = (label,name,value = '',attributes = 'required') =>
  `<label>${label}<input name="${name}" value="${escape(value)}" ${attributes}></label>`;
const select = (label,name,entries,value) =>
  `<label>${label}<select name="${name}" required>${options(entries,value)}</select></label>`;
const num = (label,name,value = '',attributes = 'required') => input(label,name,value,`inputmode="decimal" ${attributes}`);
const grid = (...content) => `<div class="form-grid">${content.join('')}</div>`;
const decimals = (value, places) => {
  const text = String(value ?? '').trim().replace(',','.');
  if (!/^\d+(\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > places) throw new Error('Confira os valores numéricos. Use vírgula ou ponto para decimais, sem separador de milhar.');
  return Math.round(Number(text) * 10 ** places);
};
const formNumber = (value, places) => value == null ? '' : String(value / 10 ** places).replace('.',',');
const itemsOptions = () => Object.fromEntries(data.items.map((i) => [i.id,`${i.code} · ${i.name}`]));
const vehicleOptions = () => Object.fromEntries(data.vehicles.map((v) => [v.id,`${v.plate} · ${v.name}`]));
const description = (text) => `<p class="form-intro">${text}</p>`;
const getItem = (id) => data.items.find((i) => i.id === Number(id));
const getVehicle = (id) => data.vehicles.find((v) => v.id === Number(id));
function modal(title, html, action, parse, setup, submitText = 'Salvar') {
  const dialog = $('#dialog');
  $('#dialog-body').innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="close" data-action="close" aria-label="Fechar">×</button></header>
    ${action ? `<form id="form" method="post">${html}<p class="form-error" role="alert"></p><footer><button type="button" class="secondary" data-action="close">Voltar</button>
      <button type="submit" class="primary">${submitText}</button></footer></form>` : `<div class="dialog-content">${html}</div>`}`;
  if (!dialog.open) dialog.showModal();
  const form = $('#form');
  if (!form) return;
  const requestIds = new Map();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const submit = form.querySelector('button[type=submit]');
    const error = form.querySelector('.form-error');
    busy = true;
    submit.disabled = true;
    error.textContent = '';
    try {
      const values = parse(Object.fromEntries(new FormData(form)), form);
      const payload = JSON.stringify(values);
      if (!requestIds.has(payload)) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        requestIds.set(payload, Array.from(bytes, (byte) => byte.toString(16).padStart(2,'0')).join(''));
      }
      const result = await api(action, values, requestIds.get(payload));
      data = result.state;
      dialog.close();
      render();
      notify('Registro salvo.');
    } catch (failure) { error.textContent = failure.message; }
    finally { busy = false; submit.disabled = false; }
  });
  setup?.(form);
}
function editItem(id) {
  const item = getItem(id);
  modal(item ? 'Editar item' : 'Novo item',
    description('Cadastre a unidade e os valores unitários. Registre o saldo inicial em Movimentar.') +
    grid(input('Código / SKU','code',item?.code,'required maxlength="32"'), input('Descrição','name',item?.name,'required maxlength="120"')) +
    grid(select('Tipo','kind',kinds,item?.kind),select('Unidade','unit',{un:'Unidade',cx:'Caixa',kg:'Quilograma',L:'Litro',m:'Metro'},item?.unit)) +
    grid(input('Localização','location',item?.location,'maxlength="120"'),num('Estoque mínimo','minimum',formNumber(item?.minimum ?? 0,3))) +
    grid(num('Custo unitário (R$)','cost',formNumber(item?.cost ?? 0,2)),num('Preço de venda (R$)','price',formNumber(item?.price ?? 0,2))),
    'item', (f) => ({ ...f,id:item?.id,minimum:decimals(f.minimum,3),cost:decimals(f.cost,2),price:decimals(f.price,2) }));
}
function moveItem(id) {
  if (!data.items.length) return editItem();
  modal('Movimentar estoque',
    description('A entrada soma ao saldo, a saída usa o disponível e o inventário informa o saldo físico contado.') +
    select('Item','item',itemsOptions(),id) + '<p id="stock-hint" class="hint"></p>' +
    select('Operação','kind',{in:'Entrada',out:'Saída',count:'Ajuste por contagem'}) +
    grid(num('Quantidade','quantity'), '<div id="movement-value"></div>') +
    input('Referência (opcional)','ref','','maxlength="120"') +
    '<label>Observação <textarea name="notes" maxlength="500" rows="2"></textarea></label>',
    'movement',(f) => ({ ...f,item:Number(f.item),quantity:decimals(f.quantity,3),
      ...(f.kind === 'in' ? {cost:decimals(f.cost,2)} : f.kind === 'out' ? {price:decimals(f.price,2)} : {}) }),
    (form) => {
      const itemField = form.elements.namedItem('item');
      const refresh = () => {
        const item = getItem(itemField.value);
        const kind = form.elements.kind.value;
        $('#stock-hint').textContent = `Físico ${quantity(item.stock)} · Reservado ${quantity(item.reserved)} · Disponível ${quantity(available(item))} ${item.unit}`;
        $('#movement-value').innerHTML = kind === 'count' ? '' : kind === 'in'
          ? num('Custo unitário (R$)','cost',formNumber(item.cost,2))
          : num('Valor unitário de saída (R$)','price',formNumber(item.price,2));
        form.elements.notes.required = kind === 'count';
        form.elements.notes.placeholder = kind === 'count' ? 'Informe o motivo do ajuste' : 'Opcional';
        form.elements.quantity.closest('label').firstChild.textContent = kind === 'count' ? 'Quantidade física contada' : 'Quantidade';
      };
      itemField.addEventListener('change',refresh);
      form.elements.kind.addEventListener('change',refresh);
      refresh();
    });
}
function addOrderLine() {
  const parent = $('#order-lines');
  if (parent.children.length >= 100) return;
  const row = document.createElement('div');
  row.className = 'order-line';
  row.innerHTML = select('Item','line_item',itemsOptions()) + '<p class="hint line-hint"></p>' +
    grid(num('Quantidade','line_quantity'),num('Venda unitária (R$)','line_price')) +
    '<button class="link" type="button" data-action="removeLine">Remover item</button>';
  parent.append(row);
  const itemSelect = row.querySelector('select');
  const refresh = () => {
    const item = getItem(itemSelect.value);
    row.querySelector('.line-hint').textContent = 'Disponível: ' + quantity(available(item)) + ' ' + item.unit;
    row.querySelector('[name=line_price]').value = formNumber(item.price,2);
  };
  itemSelect.addEventListener('change',refresh);
  refresh();
}
function reserve() {
  if (!data.items.length) return editItem();
  modal('Reservar pedido',
    description('A reserva separa o saldo para este pedido. O estoque físico é baixado quando você confirma a saída.') +
    grid(input('Número ou referência','ref','','required maxlength="120"'),input('Cliente ou setor','customer','','required maxlength="120"')) +
    '<div id="order-lines"></div><button type="button" class="secondary" data-action="addLine">+ Adicionar item</button>',
    'reserve',(f, form) => ({ ref:f.ref,customer:f.customer,lines:[...form.querySelectorAll('.order-line')].map((row) => ({
      item:Number(row.querySelector('select').value),quantity:decimals(row.querySelector('[name=line_quantity]').value,3),
      price:decimals(row.querySelector('[name=line_price]').value,2)
    })) }),addOrderLine,'Reservar');
}
function viewOrder(id) {
  const order = data.orders.find((item) => item.id === id);
  const lines = data.lines.filter((line) => line.order_id === id);
  modal('Pedido ' + escape(order.ref), description(`${escape(order.customer)} · ${orders[order.state]} · ${date(order.created)}`) +
    (order.completed ? description('Finalizado em ' + date(order.completed)) : '') +
    table(['Item','Quantidade','Venda un.'], lines.map((line) => `<tr><td>${escape(line.name)}</td><td>${quantity(line.quantity)} ${escape(line.unit)}</td><td>${money(line.price)}</td></tr>`),'Itens do pedido') +
    (order.state === 'reserved' ? `<div class="detail-actions">${button('Cancelar reserva','cancel',id)}${button('Confirmar saída','fulfill',id,'primary')}</div>` : ''));
}
function finishOrder(id, action) {
  const out = action === 'fulfill';
  modal(out ? 'Confirmar saída' : 'Cancelar reserva',description(out
    ? 'A saída baixa a quantidade física e encerra a reserva de todos os itens deste pedido.'
    : 'A quantidade reservada volta a ficar disponível para outros pedidos.'),'finishOrder',() => ({id,action}),null,
    out ? 'Dar baixa no pedido' : 'Liberar reserva');
}
function editVehicle(id) {
  const v = getVehicle(id);
  modal(v ? 'Editar veículo' : 'Novo veículo',
    grid(input('Placa','plate',v?.plate,'required maxlength="12"'),input('Modelo ou identificação','name',v?.name,'required maxlength="120"')) +
    grid(num('Hodômetro (km)','km',v?.km ?? 0),select('Situação','state',{available:'Disponível',maintenance:'Em manutenção',inactive:'Inativo'},v?.state)),
    'vehicle',(f) => ({...f,id:v?.id,km:decimals(f.km,0)}));
}
function logVehicle() {
  if (!data.vehicles.length) return editVehicle();
  modal('Registrar uso da frota',
    select('Veículo','vehicle',vehicleOptions()) + grid(select('Tipo','kind',fleetKinds),num('Hodômetro (km)','km')) +
    input('Condutor ou responsável','driver','','maxlength="120"') + input('Destino ou descrição','description','','required maxlength="240"') +
    '<div id="fleet-values"></div>', 'fleetEvent',(f) => ({ ...f,vehicle:Number(f.vehicle),km:decimals(f.km,0),
      cost:f.kind === 'trip' ? 0 : decimals(f.cost,2),liters:f.kind === 'fuel' ? decimals(f.liters,3) : 0 }),
    (form) => {
      const vehicleChanged = () => { form.elements.km.value = getVehicle(form.elements.vehicle.value).km; };
      const kindChanged = () => {
        const kind = form.elements.kind.value;
        form.elements.driver.required = kind === 'trip';
        $('#fleet-values').innerHTML = kind === 'trip' ? description('Informe o hodômetro final no retorno.')
          : grid(num('Custo total (R$)','cost','0'), kind === 'fuel' ? num('Litros','liters') : '');
      };
      form.elements.vehicle.addEventListener('change',vehicleChanged);
      form.elements.kind.addEventListener('change',kindChanged);
      vehicleChanged(); kindChanged();
    });
}
function returnTrip(id) {
  const trip = data.fleet.find((entry) => entry.id === id);
  const vehicle = getVehicle(trip.vehicle_id);
  modal('Registrar retorno',description(escape(vehicle.plate) + ' · ' + escape(trip.description)) +
    grid(num('Hodômetro de retorno (km)','km',vehicle.km),num('Despesas da viagem (R$)','cost','0')),
    'returnTrip',(f) => ({id,km:decimals(f.km,0),cost:decimals(f.cost,2)}));
}
$('#view').addEventListener('input',(event) => {
  if (event.target.id === 'search') { search = event.target.value; renderItems(); }
});
$('#dialog').addEventListener('cancel',(event) => { if (busy) event.preventDefault(); });
document.addEventListener('click',(event) => {
  const button = event.target.closest('button');
  if (!button || !data || busy) return;
  const { page:next, action, id, filter:key } = button.dataset;
  if (next) { page = next; render(); $(dataPageSelector(next)).focus(); }
  if (key) {
    filter = key;
    for (const element of document.querySelectorAll('[data-filter]')) element.setAttribute('aria-pressed',String(element.dataset.filter === key));
    renderItems();
  }
  const record = Number(id);
  switch (action) {
    case 'close': $('#dialog').close(); break;
    case 'item': editItem(record); break;
    case 'movement': moveItem(record); break;
    case 'reserve': reserve(); break;
    case 'addLine': addOrderLine(); break;
    case 'removeLine': button.closest('.order-line').remove(); break;
    case 'viewOrder': viewOrder(record); break;
    case 'fulfill':
    case 'cancel': finishOrder(record, action); break;
    case 'vehicle': editVehicle(record); break;
    case 'fleetEvent': logVehicle(); break;
    case 'returnTrip': returnTrip(record); break;
  }
});
const dataPageSelector = (name) => `[data-page="${name}"]`;
api().then((result) => { data = result; render(); }).catch((error) => {
  $('#view').setAttribute('aria-busy','false');
  $('#view').textContent = 'Erro ao carregar o Pátio. ' + error.message;
});
