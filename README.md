# Pátio · Estoque e frota

Aplicação web local para almoxarifados, mercados e operações de frota. Interface em português, valores em reais e dados persistidos em SQLite.

## Rodar no computador

1. Instale **Node.js 24 ou superior**.
2. Extraia o ZIP, abra um terminal dentro da pasta que contém `package.json` e execute `npm start`.
3. Abra [http://127.0.0.1:3000](http://127.0.0.1:3000). A base de trabalho começa vazia.

Para explorar com registros fictícios, execute `npm run dev` no lugar de `npm start`. Pare o servidor anterior com Ctrl+C antes de alternar. Os dois modos usam bancos separados. Nenhum pacote externo é necessário.

## Estoque

1. Em **Estoque → Novo item**, informe código, descrição, tipo, unidade, localização, mínimo, custo e venda unitários. Use valor de venda zero para materiais ou equipamentos que não são vendidos.
2. Em **Movimentar → Entrada**, registre o saldo inicial ou uma reposição. Em **Saída**, informe o que saiu e o valor unitário praticado, se houver.
3. Em **Ajuste por contagem**, informe a **quantidade física total contada** e o motivo. O sistema calcula a diferença. Caso a contagem fique abaixo do reservado, resolva as reservas antes de aplicar o ajuste.
4. **Físico** é o total registrado. **Reservado** é a parte comprometida em pedidos. **Disponível** é a diferença entre ambos. As saídas diretas usam o disponível. O alerta compara o disponível com o mínimo do item.
5. **Movimentações** mostra data, operação, quantidade, saldo resultante, custo, venda e referência. Entradas recalculam o custo médio ponderado, arredondado para centavos. O custo unitário pode ser corrigido no cadastro. O preço de venda do catálogo funciona como sugestão para saídas e pedidos.

Unidade e caixa aceitam quantidades inteiras. Quilograma, litro e metro aceitam até três casas decimais.

## Pedidos

Em **Pedidos → Reservar pedido**, informe a referência, o cliente ou setor e os itens. A reserva compromete o disponível sem reduzir o físico. Em **Ver pedido**, use **Confirmar saída** para dar baixa em todos os itens ou **Cancelar reserva** para devolver as quantidades ao disponível.

## Frota

Cadastre placa, identificação, situação e hodômetro. Em **Registrar uso**, lance viagem, abastecimento ou manutenção. Uma viagem aberta aparece como **Em viagem**. No cartão do veículo, clique em **Registrar retorno** e informe o hodômetro final e as despesas. Os registros ficam no diário da frota. A situação **Em manutenção** é controlada no cadastro do veículo e pode ser definida separadamente do lançamento de uma despesa de manutenção.

## Dados e GitHub

- O banco de trabalho fica em `data/patio.sqlite` e o de demonstração em `data/demo.sqlite`. Preserve a pasta `data/` ao atualizar os arquivos. Faça cópia da pasta com o servidor parado.
- O projeto opera em um computador, acessível por endereço local. Esta versão é de uso local, com um estoque lógico e campo de localização por item. O código e o banco de trabalho ficam separados.
- Para publicar o código, crie um repositório no GitHub e envie os arquivos extraídos. A pasta `data/` e bancos SQLite estão excluídos no `.gitignore`. Mantenha os dados de trabalho fora do repositório.
- Execute `npm test` para validar as regras de saldo, reservas, repetição de uma operação e hodômetro.
