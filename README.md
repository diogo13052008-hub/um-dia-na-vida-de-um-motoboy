# Um dia na vida de um Motoboy — Rota Real

Aplicação web multiplayer didática, em português, com oito corridas **em São Paulo**, entrada por código, apelidos sem cadastro, sincronização por WebSockets, painel de controle do administrador e relatórios coletivos calculados a partir das respostas verdadeiras registradas na base de dados.

## Inicialização local (Node.js 22.13+)

```bash
npm install
npm start
```

Abra **http://localhost:3000**. Clique em **Criar uma nova sala**. No painel do administrador, clique em **Testar como participante** para abrir outra aba ou use o link/código em outro dispositivo. Na aba de participante, informe um apelido. Volte ao painel e inicie a rodada. Cada participante escolhe **Aceitar** ou **Recusar**. O administrador avança quando todos responderem; após a 8ª rodada, libera os resultados simultaneamente.

Por padrão, os dados ficam no banco SQLite `data/motoboy.sqlite`. Esse modo é adequado para testar e usar **uma única instância** de servidor; não substitui uma infraestrutura de produção escalável. Os resultados continuam registrados após reiniciar o processo. Somente os apelidos e as decisões são registrados, sem necessidade de cadastro ou e-mail.

### Se as pessoas estão em celulares diferentes

- Na **mesma rede Wi-Fi**, execute o servidor no computador e compartilhe `http://IP-DO-COMPUTADOR:3000/?s=CODIGO&participar=1` (verifique firewall e IP local). Isso funciona sem criar contas, mas o servidor precisa permanecer ligado.
- Pela **internet**, hospede a aplicação em um provedor que aceite Node.js + WebSockets + PostgreSQL (por exemplo, serviços com suporte a containers). Use HTTPS e um domínio ou endereço público. `localhost` **não é acessível** para a turma fora do computador do administrador.

## Infraestrutura para uma turma maior

A aplicação suporta PostgreSQL pela variável `DATABASE_URL` e Redis Adapter do Socket.IO pela `REDIS_URL` para comunicação entre **múltiplas instâncias**. O armazenamento de produção deve ser PostgreSQL; não use SQLite local ao distribuir o backend. É necessário configurar um load balancer/reverse proxy que permita upgrade para WebSockets. Como o app usa exclusivamente o transporte WebSocket, sessões persistentes (sticky sessions) não são obrigatórias para o protocolo, mas reconexões precisam alcançar a infraestrutura compartilhada. Teste carga, revise segurança e estabeleça limites adequados antes de abrir para centenas/milhares de usuários.

Com Docker disponível, use `docker compose up --build` para iniciar web + PostgreSQL + Redis localmente. A senha fornecida no `compose.yaml` é **apenas para teste**: troque-a antes de qualquer exposição pública. Defina credenciais por variáveis de ambiente no serviço de hospedagem.

Variáveis:

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta HTTP (padrão `3000`) |
| `DATABASE_URL` | String de conexão PostgreSQL; sem ela, usa SQLite |
| `SQLITE_PATH` | Arquivo SQLite; padrão `./data/motoboy.sqlite` |
| `REDIS_URL` | Conecta as salas de Socket.IO entre réplicas |
| `MAX_PLAYERS` | Tamanho máximo por sala, padrão 1.000 (limite configurável até 5.000) |
| `PG_POOL_SIZE` | Conexões PostgreSQL por processo, padrão 20 |
| `PG_SSL` | `true` para conexão TLS com PostgreSQL |
| `PG_SSL_INSECURE` | `true` somente se necessário em ambiente confiável de teste |

## Dinâmica revisada e cálculos (v2.1)

**Correção importante:** a versão anterior usava os pisos de pagamento do iFood como se fossem ofertas típicas, e distribuía oito entregas em dez horas. Isso não é representativo. O cenário revisado é explicitamente **hipotético**; valores de cada corrida não são extraídos de um banco de ofertas reais e não são apresentados como médias estatísticas.

As oito distâncias e os endereços originais foram mantidos. Para o cenário com adicionais simulados, os pagamentos agora são R$ 12,00, R$ 15,00, R$ 17,00, R$ 14,00, R$ 19,00, R$ 23,00, R$ 28,00 e R$ 25,00. Os horários são 08:05, 08:30, 09:05, 09:45, 10:15, 11:00, 11:50 e 12:50; o recorte de disponibilidade vai de 08:00 a 13:38. Não é um expediente inteiro.

| Corrida | km estimados | Recebimento simulado | Duração |
| --- | ---: | ---: | ---: |
| 1 | 2,2 | R$ 12,00 | 18 min |
| 2 | 4,1 | R$ 15,00 | 28 min |
| 3 | 4,8 | R$ 17,00 | 32 min |
| 4 | 2,8 | R$ 14,00 | 22 min |
| 5 | 5,3 | R$ 19,00 | 35 min |
| 6 | 6,7 | R$ 23,00 | 42 min |
| 7 | 8,4 | R$ 28,00 | 52 min |
| 8 | 7,2 | R$ 25,00 | 48 min |

Se o participante aceita as 8: **R$ 153,00** de faturamento bruto, **41,5 km** nas entregas, **R$ 42,45** de custos simulados (R$ 8,30 de combustível, R$ 4,15 de manutenção, R$ 25 de alimentação e R$ 5 de outros), **R$ 110,55** de ganho líquido estimado, **5h38** de disponibilidade, correspondendo a **R$ 19,62 líquidos/h** e **R$ 27,16 brutos/h**. Esses números são construção de um cenário educativo, **não a média real de quem trabalha no iFood**.

A remuneração pode variar por rota, distância, região, horários, bonificações e outros fatores. Como referência comparativa:
- [iFood — ganhos](https://entregador.ifood.com.br/ganhos/): piso de R$ 7,50 por rota de moto e R$ 1,50 por km total remunerável (2026); esses pisos **não** são médias por corrida.
- [Folha 01/10/2026](https://www1.folha.uol.com.br/colunas/painelsa/2026/10/ifood-relanca-portal-com-dados-sobre-delivery-e-setor.shtml): segundo o iFood, média de **R$ 30,07 brutos/h**, baseada em dados do primeiro trimestre de 2026. É dado divulgado pela empresa, não garantia individual; o conceito de hora pode diferir da simulação.
- [Cebrap/Amobitec — estudo divulgado em 2025](https://institucional.ifood.com.br/estudos-e-pesquisas/ganhos-autonomia-aplicativos/): faixa de **R$ 17–22 líquidos/h**, considerando cenários de tempo de espera e custos; dados de estudo anterior, não tabela de 2026.
- [Decreto 12.797/2025](https://legis.senado.gov.br/norma/41882097/publicacao/41888369): salário mínimo equivalente a **R$ 7,37/h em 2026**, contexto diferente de vínculo e direitos trabalhistas.

**O mapa não é uma rota conectada.** O jogo não mede nem cobra quilômetros vazios entre as diferentes regiões de São Paulo. Portanto, seus custos por quilômetro representam somente as entregas aceitas e podem estar subestimados. O cálculo de despesas é hipotético, conforme os parâmetros do exercício. Recusar uma oferta não gera receita nem quilômetros de entrega, mas o relógio avança até a próxima oferta.

Os resultados individuais e coletivos continuam provenientes somente das decisões reais gravadas no servidor. Se já houver salas ou sessões antigas abertas, **crie uma sala nova após o deploy**, porque o conjunto de regras mudou; em hospedagem gratuita o banco local pode ser apagado entre reinícios.

## Segurança, privacidade e limitações

- Cada sala usa **código público e token de administrador secreto**; cada participante tem um token individual. Ambos são armazenados no navegador para retomar a sessão. Compartilhe somente o link **de participante**, nunca o token de administrador.
- A base guarda hashes dos tokens, decisões e apelidos; não são cadastradas senhas, CPFs, e-mails ou endereços pessoais.
- Os resultados são persistidos até que a base seja limpa. Antes de uso público, estabeleça uma política de retenção e exclusão de dados conforme sua realidade.
- Validação da ordem e autoria das decisões ocorre **no servidor**, com chave primária que impede respostas duplicadas; o administrador não consegue alterar uma resposta de participante.
- O aplicativo tem limites simples por socket e não inclui autenticação institucional, proteção avançada contra abuso, métricas de carga ou políticas automáticas de expiração. Um deploy público relevante deve acrescentá-las.
- O código de sala e o apelido são suficientes para entrar **somente antes do começo** da atividade.

## Testes

```bash
npm test
```

Testa a soma exata das corridas, custos, relógio, cálculo horário, salas, ordem das decisões, bloqueio de duplicações e liberação do resultado final.
