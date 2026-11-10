import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const required = (value, field, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail('Confira o campo ' + field + '.');
  return value.trim();
};
const optional = (value, field, max = 120) => value === '' || value == null ? '' : required(value, field, max);
const integer = (value, field, min = 0, max = 1_000_000_000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail('Confira o campo ' + field + '.');
  return value;
};
const stamp = () => new Date().toISOString();
const money = (v, field) => integer(v, field, 0, 100_000_000);
const qty = (v, min = 0) => integer(v, 'quantidade', min, 100_000_000);
const units = ['un','cx','kg','L','m'];
const types = ['mercadoria','equipamento','material'];
const vehicleStates = ['available','maintenance','inactive'];

export function openOperations(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY, digest TEXT NOT NULL, result INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS items(
      id INTEGER PRIMARY KEY, code TEXT UNIQUE COLLATE NOCASE NOT NULL, name TEXT NOT NULL,
      kind TEXT NOT NULL, unit TEXT NOT NULL, location TEXT NOT NULL, minimum INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND stock),
      cost INTEGER NOT NULL, price INTEGER NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, ref TEXT UNIQUE COLLATE NOCASE NOT NULL,
      customer TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, completed TEXT);
    CREATE TABLE IF NOT EXISTS order_lines(order_id INTEGER REFERENCES orders(id), item_id INTEGER REFERENCES items(id),
      quantity INTEGER NOT NULL, price INTEGER NOT NULL, PRIMARY KEY(order_id,item_id));
    CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY, item_id INTEGER REFERENCES items(id), order_id INTEGER REFERENCES orders(id),
      kind TEXT NOT NULL, delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL, balance INTEGER NOT NULL, reserved_balance INTEGER NOT NULL,
      cost INTEGER NOT NULL, price INTEGER NOT NULL, ref TEXT NOT NULL, notes TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vehicles(id INTEGER PRIMARY KEY, plate TEXT UNIQUE COLLATE NOCASE NOT NULL, name TEXT NOT NULL,
      state TEXT NOT NULL, km INTEGER NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fleet_events(id INTEGER PRIMARY KEY, vehicle_id INTEGER REFERENCES vehicles(id),
      kind TEXT NOT NULL, driver TEXT NOT NULL, description TEXT NOT NULL, start_km INTEGER NOT NULL, end_km INTEGER,
      cost INTEGER NOT NULL, liters INTEGER NOT NULL, started TEXT NOT NULL, completed TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_trip ON fleet_events(vehicle_id) WHERE kind='trip' AND completed IS NULL;
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      if (/UNIQUE constraint failed/.test(error.message)) throw fail('Já existe um cadastro com esse código, pedido ou placa.', 409);
      throw error;
    }
  }
  const find = (table, id) => {
    const row = get(`SELECT * FROM ${table} WHERE id=?`, integer(id, 'registro', 1));
    if (!row) throw fail('Registro não encontrado.', 404);
    return row;
  };
  const insert = (sql, ...args) => Number(run(sql, ...args).lastInsertRowid);

  function ledger(item, kind, delta, reservedDelta, values) {
    const balance = item.stock + delta;
    const reserved = item.reserved + reservedDelta;
    if (reserved < 0 || balance < reserved) throw fail('O saldo disponível é insuficiente. Confira as reservas ativas.', 409);
    qty(balance);
    run('UPDATE items SET stock=?,reserved=?,cost=? WHERE id=?',
      balance, reserved, values.newCost ?? item.cost, item.id);
    insert(`INSERT INTO movements(item_id,order_id,kind,delta,reserved_delta,balance,reserved_balance,cost,price,ref,notes,created)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, item.id, values.order ?? null, kind, delta, reservedDelta, balance, reserved,
      values.cost ?? item.cost, values.price ?? item.price, values.ref ?? '', values.notes ?? '', stamp());
  }
  function item(id, body) {
    const code = required(body.code, 'código', 32).toUpperCase();
    const name = required(body.name, 'descrição');
    const { kind, unit } = body;
    if (!types.includes(kind) || !units.includes(unit)) throw fail('Selecione o tipo e a unidade.');
    const values = [code, name, kind, unit, optional(body.location, 'localização'), qty(body.minimum),
      money(body.cost, 'custo'), money(body.price, 'preço de venda')];
    if (unit !== 'kg' && unit !== 'L' && unit !== 'm' && body.minimum % 1000) throw fail('A unidade selecionada exige quantidade inteira.');
    if (id) {
      const existing = find('items', id);
      if (existing.unit !== unit && get('SELECT id FROM movements WHERE item_id=? LIMIT 1', id)) {
        throw fail('A unidade fica vinculada ao histórico depois da primeira movimentação.', 409);
      }
      run('UPDATE items SET code=?,name=?,kind=?,unit=?,location=?,minimum=?,cost=?,price=? WHERE id=?', ...values, id);
      return id;
    }
    return insert('INSERT INTO items(code,name,kind,unit,location,minimum,cost,price,created) VALUES (?,?,?,?,?,?,?,?,?)',
      ...values, stamp());
  }
  function itemQuantity(record, value, min) {
    const amount = qty(value, min);
    if (['un','cx'].includes(record.unit) && amount % 1000) throw fail('Use uma quantidade inteira para ' + record.name + '.');
    return amount;
  }
  function movement(body) {
    const record = find('items', body.item);
    const { kind } = body;
    if (!['in','out','count'].includes(kind)) throw fail('Selecione o tipo de movimentação.');
    const amount = itemQuantity(record, body.quantity, kind === 'count' ? 0 : 1);
    const ref = optional(body.ref, 'referência');
    const notes = optional(body.notes, 'observação', 500);
    if (kind === 'count' && !notes) throw fail('Informe o motivo do ajuste de inventário.');
    const cost = kind === 'in' ? money(body.cost, 'custo de entrada') : record.cost;
    const price = kind === 'out' ? money(body.price, 'valor de saída') : record.price;
    const delta = kind === 'in' ? amount : kind === 'out' ? -amount : amount - record.stock;
    let newCost = record.cost;
    if (kind === 'in') {
      const balance = BigInt(record.stock + amount);
      const total = BigInt(record.stock) * BigInt(record.cost) + BigInt(amount) * BigInt(cost);
      newCost = Number((total + balance / 2n) / balance);
    }
    ledger(record, kind, delta, 0, { ref, notes, cost, price, newCost });
    return record.id;
  }
  function reserve(body) {
    const ref = required(body.ref, 'número do pedido');
    const customer = required(body.customer, 'cliente ou setor');
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) throw fail('Adicione de 1 a 100 itens.');
    const seen = new Set();
    const order = insert("INSERT INTO orders(ref,customer,state,created) VALUES (?,?,'reserved',?)", ref, customer, stamp());
    for (const line of body.lines) {
      if (!line || typeof line !== 'object') throw fail('Item do pedido inválido.');
      const record = find('items', line.item);
      if (seen.has(record.id)) throw fail('Inclua cada item uma vez no pedido.');
      seen.add(record.id);
      const amount = itemQuantity(record, line.quantity, 1);
      const price = money(line.price, 'preço do pedido');
      run('INSERT INTO order_lines VALUES (?,?,?,?)', order, record.id, amount, price);
      ledger(record, 'reserve', 0, amount, { order, ref, price, notes:customer });
    }
    return order;
  }
  function finishOrder(id, action) {
    const order = find('orders', id);
    if (order.state !== 'reserved') throw fail('Este pedido já foi finalizado.', 409);
    if (!['fulfill','cancel'].includes(action)) throw fail('Ação do pedido inválida.');
    for (const line of all('SELECT * FROM order_lines WHERE order_id=?', id)) {
      const record = find('items', line.item_id);
      ledger(record, action, action === 'fulfill' ? -line.quantity : 0, -line.quantity,
        { order:id, ref:order.ref, price:line.price, notes:order.customer });
    }
    run('UPDATE orders SET state=?,completed=? WHERE id=?', action === 'fulfill' ? 'fulfilled' : 'cancelled', stamp(), id);
    return id;
  }
  const openTrip = (id) => get("SELECT id FROM fleet_events WHERE vehicle_id=? AND kind='trip' AND completed IS NULL", id);
  function vehicle(id, body) {
    const plate = required(body.plate, 'placa', 12).replace(/[-\s]/g,'').toUpperCase();
    if (!/^[A-Z0-9]{5,10}$/.test(plate)) throw fail('Confira a placa do veículo.');
    const name = required(body.name, 'modelo ou identificação');
    const { state } = body;
    if (!vehicleStates.includes(state)) throw fail('Confira a situação do veículo.');
    const km = integer(body.km, 'hodômetro', 0, 10_000_000);
    if (!id) return insert('INSERT INTO vehicles(plate,name,state,km,created) VALUES (?,?,?,?,?)', plate,name,state,km,stamp());
    const previous = find('vehicles', id);
    if (openTrip(id) && (km !== previous.km || state !== previous.state)) throw fail('Encerre a viagem antes de alterar a situação ou hodômetro.', 409);
    if (km < previous.km) throw fail('O hodômetro não pode diminuir.', 409);
    run('UPDATE vehicles SET plate=?,name=?,state=?,km=? WHERE id=?', plate,name,state,km,id);
    return id;
  }
  function fleetEvent(body) {
    const record = find('vehicles', body.vehicle);
    const { kind } = body;
    if (!['trip','fuel','maintenance'].includes(kind)) throw fail('Selecione o tipo de registro.');
    if (record.state === 'inactive') throw fail('Reative o veículo antes de lançar registros.', 409);
    if (kind === 'trip' && (record.state !== 'available' || openTrip(record.id))) throw fail('O veículo precisa estar disponível para sair.', 409);
    if (kind === 'maintenance' && openTrip(record.id)) throw fail('Encerre a viagem antes de registrar manutenção.', 409);
    const km = integer(body.km, 'hodômetro', record.km, 10_000_000);
    const driver = kind === 'trip' ? required(body.driver, 'condutor') : optional(body.driver, 'responsável');
    const description = required(body.description, kind === 'trip' ? 'destino ou finalidade' : 'descrição', 240);
    const cost = kind === 'trip' ? 0 : money(body.cost, 'valor total');
    const liters = kind === 'fuel' ? integer(body.liters, 'litros', 1, 10_000_000) : 0;
    const at = stamp();
    const id = insert(`INSERT INTO fleet_events(vehicle_id,kind,driver,description,start_km,end_km,cost,liters,started,completed)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, record.id,kind,driver,description,km,kind === 'trip' ? null : km,cost,liters,at,kind === 'trip' ? null : at);
    run('UPDATE vehicles SET km=? WHERE id=?', km, record.id);
    return id;
  }
  function returnTrip(id, body) {
    const trip = find('fleet_events', id);
    if (trip.kind !== 'trip' || trip.completed) throw fail('Essa viagem já foi encerrada ou não existe.', 409);
    const record = find('vehicles', trip.vehicle_id);
    const km = integer(body.km, 'hodômetro de retorno', record.km, 10_000_000);
    const cost = money(body.cost, 'despesa da viagem');
    run('UPDATE fleet_events SET end_km=?,cost=?,completed=? WHERE id=?', km,cost,stamp(),id);
    run('UPDATE vehicles SET km=? WHERE id=?', km,record.id);
    return id;
  }
  function snapshot() {
    return {
      items: all('SELECT * FROM items ORDER BY name COLLATE NOCASE'),
      movements: all('SELECT m.*,i.code,i.name,i.unit FROM movements m JOIN items i ON i.id=m.item_id ORDER BY m.id DESC'),
      orders: all('SELECT * FROM orders ORDER BY id DESC'),
      lines: all('SELECT l.*,i.code,i.name,i.unit FROM order_lines l JOIN items i ON i.id=l.item_id'),
      vehicles: all(`SELECT v.*,(SELECT f.id FROM fleet_events f WHERE f.vehicle_id=v.id AND f.kind='trip' AND f.completed IS NULL) AS trip
        FROM vehicles v ORDER BY plate`),
      fleet: all('SELECT f.*,v.plate,v.name FROM fleet_events f JOIN vehicles v ON v.id=f.vehicle_id ORDER BY f.id DESC')
    };
  }
  const commands = {
    item:(body) => item(body.id == null ? null : integer(body.id,'registro',1), body),
    movement, reserve, finishOrder:(body) => finishOrder(body.id, body.action),
    vehicle:(body) => vehicle(body.id == null ? null : integer(body.id,'registro',1), body),
    fleetEvent, returnTrip:(body) => returnTrip(body.id, body)
  };
  return {
    db,
    snapshot: () => {
      db.exec('BEGIN');
      try { const data = snapshot(); db.exec('COMMIT'); return data; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    execute(command, body, key) {
      if (!Object.hasOwn(commands, command)) throw fail('Operação inválida.', 404);
      if (key !== undefined && (typeof key !== 'string' || !/^[a-f0-9]{32}$/.test(key))) throw fail('Identificador de operação inválido.');
      const digest = key && createHash('sha256').update(JSON.stringify([command, body])).digest('hex');
      return transaction(() => {
        const previous = key && get('SELECT digest,result FROM requests WHERE key=?', key);
        if (previous) {
          if (previous.digest !== digest) throw fail('Identificador já usado em outra operação.', 409);
          return previous.result;
        }
        const result = commands[command](body);
        if (key) run('INSERT INTO requests VALUES (?,?,?)', key, digest, result);
        return result;
      });
    }
  };
}
