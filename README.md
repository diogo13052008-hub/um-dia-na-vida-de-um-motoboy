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

## Dinâmica e cálculos

As oito corridas são as definidas na conversa anterior. O jogo utiliza os mesmos **endereços, distâncias e preços** e atribui durações narrativas estimadas. Os preços não são garantias de pagamento atual do iFood. Em junho de 2026 houve reajuste divulgado pela plataforma, portanto estes valores devem ser tratados como **dados da simulação**, não como cotação atual.

- Soma máxima de receitas aceitando as oito ofertas: **R$ 71,40**.
- Distância máxima remunerada das oito corridas: **41,5 km**.
- Combustível: **R$ 0,20/km**; desgaste: **R$ 0,10/km**.
- Alimentação: **R$ 25,00**; outros custos: **R$ 5,00** (fixos por dia de expediente).
- Exemplo com oito aceitas: R$ 8,30 combustível + R$ 4,15 manutenção + R$ 30,00 fixos = **R$ 42,45** de custos; líquido **R$ 28,95**.
- O dia começa às **08:00** e a disponibilidade vai até **18:00**, ou até a conclusão da última entrega, se ultrapassar 18:00. Se o participante rejeitar a corrida, não recebe e não roda esses quilômetros, mas a espera entre ofertas permanece dentro do expediente. O relógio visual mostra o horário da oferta e, após aceitar, o término estimado dela.
- Fórmula individual: `líquido = bruto − (km × 0,30 + 30,00)`; `líquido/hora = líquido ÷ horas totais de disponibilidade no dia`.
- Participantes removidos pelo administrador permanecem registrados na base, mas são excluídos das médias. O administrador não pode avançar sem resposta de todos os participantes **ativos**; nenhuma recusa automática é fabricada.
- Mapa **esquemático**, sem precisão geográfica de rotas. Deslocamentos entre o fim de uma entrega e a coleta seguinte não são contabilizados e poderiam reduzir ainda mais os ganhos em uma situação real.
- Os resultados consolidados e gráficos são gerados apenas após a liberação do administrador, usando exclusivamente escolhas armazenadas no servidor.

**Salário mínimo nacional oficial por hora em 2026: R$ 7,37**, Decreto nº 12.797/2025. A comparação gráfica é didática: regime de vínculo e benefícios são distintos. Não é correto concluir que todos os motoboys ganham os valores simulados.

Fontes:
- https://entregador.ifood.com.br/ganhos/
- https://entregador.ifood.com.br/sem-categoria/correcao-inflacionaria-2026/
- https://legis.senado.gov.br/norma/41882097/publicacao/41888369

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
