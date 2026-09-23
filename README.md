# AntiGolpe

Assistente de IA via WhatsApp para ajudar pessoas idosas a identificar golpes
digitais (phishing, boleto falso, falsas promoções, golpe do parente, golpe
do PIX, falsos funcionários de banco/INSS/Correios) **e fake news/
desinformação** (fotos fora de contexto, boatos de saúde e política,
notícias falsas). Projeto acadêmico da Atividade Extensionista de ADS
(UNINTER).

Stack: n8n + Evolution API + Postgres + Google Gemini, rodando em Docker.

## Status atual

**Sistema completo, testado de ponta a ponta com dados reais:**
- n8n + Evolution API + Postgres rodando em Docker
- Workflow `AntiGolpe - WhatsApp` ativo no n8n
- Webhook da Evolution API apontando para o workflow
- Tabela `antigolpe_interacoes` recebendo gravações reais
- Número de WhatsApp do assistente conectado
- Classificação do Gemini validada com mensagens de teste (texto, imagem e
  áudio). A resposta sai sempre em português simples, sem jargão técnico, e
  o histórico é gravado corretamente no Postgres.

Pronto para uso e para demonstração.

### Nota técnica: publicação de workflow no n8n

Esta versão do n8n trata **"Save" e "Publish" como ações separadas** para
um workflow já ativo: salvar uma alteração no editor cria uma nova versão
(`versionId`), mas o webhook de produção continua rodando a versão anterior
(`activeVersionId`) até ela ser publicada. Depois de editar qualquer node
(por exemplo, trocar uma credencial) e salvar, é preciso publicar a versão:

```powershell
docker exec n8n n8n publish:workflow --id=EW8T2Fnr78UTfydm
docker restart n8n
```

Se uma edição feita pela UI parecer "não pegar" (o comportamento antigo
continua mesmo depois de salvar), a causa provável é essa. Para conferir se
`versionId` e `activeVersionId` batem:

```powershell
docker exec n8n node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true}); console.log(db.prepare(\"SELECT versionId, activeVersionId FROM workflow_entity WHERE id='EW8T2Fnr78UTfydm'\").get());"
```

## Arquitetura

```
WhatsApp
        │
        ▼
Evolution API (self-hosted, container evolution-api)
        │ webhook (evento MESSAGES_UPSERT)
        ▼
n8n: workflow "AntiGolpe - WhatsApp" (workflows/antigolpe.json)
  1. Webhook Evolution API
  2. Filtro - Validar Mensagem       (ignora eco/grupo/status; aceita texto/imagem/áudio)
  3. Extração - Dados e Tipo         (número, nome, tipo de mensagem)
  4. É Texto? (IF)
       ├─ sim → segue direto
       └─ não → Buscar Mídia Base64 (Evolution API) → Normalizar Mídia
  5. Montar Conteúdo Gemini          (monta prompt + parts multimodais)
  6. Classificar com Gemini          (HTTP Request → Gemini generateContent,
                                       responseSchema força JSON estruturado)
       ├─ sucesso → Parsear Classificação (+ rede de segurança anti-falso-"seguro")
       └─ erro    → Fallback - Erro Gemini (resposta cautelosa padrão)
  7. Montar Mensagem WhatsApp        (texto final em português simples)
  8. Envio - Evolution API           (responde no WhatsApp de quem escreveu)
  9. Log - Antigolpe Interações      (grava no Postgres, telefone com hash SHA-256)
```

Banco: Postgres do container `evolution-postgres`, banco `n8n_prospecta`,
tabela `antigolpe_interacoes` (ver `sql/001_create_antigolpe_interacoes.sql`).

Credenciais:
- **Gemini API Key - Query Auth** (`httpQueryAuth`, criada manualmente na UI
  do n8n; ver "Como recriar a credencial do Gemini" abaixo). Usada pelo node
  de classificação.
- **Evolution API** (`httpHeaderAuth`, id `C9CSIEAuFeK4qAj6`). Usada para buscar mídia (imagem/áudio em
  base64) e enviar a resposta.
- **Postgres - n8n_prospecta** (`postgres`, id `NpFd8Wsxhcs56Q9H`). Usada para o log de interações.

## Como recriar a credencial do Gemini (em um setup novo)

O node "Classificar com Gemini" faz a chamada REST direta à API do Gemini
(`generateContent`) em vez de usar o node de IA do n8n, porque só a chamada
direta permite pedir resposta em **JSON estruturado** (`responseSchema`) e
anexar imagem/áudio em base64 no mesmo request.

A credencial usada pelos nodes de IA do n8n (`googlePalmApi`) não se
autentica corretamente num node HTTP Request genérico nesta versão do n8n,
então a classificação usa uma credencial **Query Auth** separada, com a
mesma API key. Sem essa credencial, o sistema não quebra: toda mensagem
recebe a resposta cautelosa padrão ("não consegui analisar") em vez da
classificação real.

**Configuração (uma vez só):**

1. Abra o n8n: http://localhost:5678
2. Vá em **Credentials → Add Credential → Query Auth**
3. Preencha:
   - **Name** (nome da credencial, campo de cima): `Gemini API Key - Query Auth`
   - **Name** (dentro da credencial, o parâmetro da URL): `key`
   - **Value**: a API key do Google AI Studio
4. Salve.
5. Abra o workflow **AntiGolpe - WhatsApp**, clique no node **"Classificar
   com Gemini"**, selecione a credencial no campo Query Auth, **feche o
   painel do node** e só então clique em **Save** no canto superior direito.
6. **Publique a versão salva** (ver a nota técnica no início deste README):
   ```powershell
   docker exec n8n n8n publish:workflow --id=EW8T2Fnr78UTfydm
   docker restart n8n
   ```

### Reconectar o WhatsApp (se a sessão cair)

O WhatsApp desconecta sozinho se o container da Evolution API ficar parado
por muito tempo (`connectionStatus` vira `close`). Isso é do próprio
WhatsApp e **precisa de ação manual com o celular**, não dá para
automatizar. A forma mais simples é o **pairing code** (um código de 8
caracteres digitado no celular, sem escanear QR Code):

```powershell
curl -s -X GET "http://localhost:8080/instance/connect/NOME_DA_INSTANCIA?number=NUMERO_DO_WHATSAPP" -H "apikey: SUA_AUTHENTICATION_API_KEY_AQUI"
```

A `AUTHENTICATION_API_KEY` fica no `.env` do projeto `evolution-api-docker`.
A resposta traz um campo `"pairingCode"` (ex: `"5S8PVD6Q"`). **Use nos
próximos ~60 segundos**, porque ele expira rápido; se demorar, gere outro.
No celular com o número do assistente:

1. WhatsApp → **⋮** (3 pontinhos) ou Configurações → **Aparelhos conectados**
2. **Conectar um aparelho**
3. Na tela da câmera, toque em **"Conectar com número de telefone"**
4. Digite o `pairingCode` recebido

Confirme a reconexão consultando o banco:
```powershell
docker exec evolution-postgres psql -U evolution -d evolution -c "SELECT \"connectionStatus\" FROM \"Instance\" WHERE name='NOME_DA_INSTANCIA';"
```
Deve retornar `open`.

> `NOME_DA_INSTANCIA` é o nome da instância cadastrada na Evolution API, o
> mesmo usado nas URLs dos nodes de mídia e envio em
> `workflows/antigolpe.json`.

## Como subir o ambiente (se os containers estiverem parados)

```powershell
# Evolution API + Postgres + Redis
cd evolution-api-docker
docker compose up -d postgres redis evolution-api

# n8n
cd n8n-docker
docker compose up -d

# Garantir que o n8n enxerga a Evolution API/Postgres pela rede Docker
docker network connect evolution-net n8n
```

Depois de subir, confira:
- n8n: http://localhost:5678
- Evolution API Manager: http://localhost:8080/manager

## Como reimportar o workflow

O JSON do workflow fica em `workflows/antigolpe.json`, versionado neste
repositório. Para importar:

```powershell
docker cp workflows\antigolpe.json n8n:/tmp/antigolpe.json
docker exec n8n n8n import:workflow --input=/tmp/antigolpe.json
docker exec n8n n8n update:workflow --id=EW8T2Fnr78UTfydm --active=true
docker restart n8n
```

O `id` do workflow (`EW8T2Fnr78UTfydm`) está fixo no JSON para que a
importação sempre atualize o mesmo workflow em vez de criar um duplicado.

**Atenção**: depois de ativar/desativar o workflow via CLI, é preciso rodar
`docker restart n8n` para a rota do webhook ser registrada. O campo `active`
no banco muda na hora, mas a rota só é registrada na inicialização do
processo. Logo depois do restart, o primeiro POST ao webhook pode dar 404
por alguns segundos enquanto a rota é registrada; nesse caso, tente de novo
em ~5 segundos.

## Como rodar a migration do Postgres (se recriar o banco do zero)

```powershell
docker cp sql\001_create_antigolpe_interacoes.sql evolution-postgres:/tmp/001.sql
docker exec evolution-postgres psql -U evolution -d n8n_prospecta -f /tmp/001.sql
```

Neste setup ela já foi aplicada: a tabela `antigolpe_interacoes`, os
índices, as views de estatística e os `GRANT`s para o usuário
`n8n_prospecta_user` já existem no banco.

## Como testar

### Teste automatizado (sem depender do WhatsApp)

```powershell
node scripts\test_webhook.js
```

Dispara 3 requisições sintéticas direto no webhook do n8n (texto de golpe
óbvio, texto neutro e um caso de baixa confiança) e imprime o resultado de
cada uma. Não precisa do WhatsApp conectado: testa a lógica do workflow e a
chamada real ao Gemini.

### Teste real, via WhatsApp

Mande uma mensagem de teste pelo WhatsApp para o número do assistente, por
exemplo:

> "Parabéns! Você ganhou um prêmio de R$500, clique aqui para resgatar:
> http://premio-fake-teste.click"

A resposta automática chega em poucos segundos, em português simples,
dizendo que parece um golpe e recomendando não clicar.

### Consultar o histórico/estatísticas (para a seção de Resultados do TCC)

```sql
-- Total por classificação
SELECT * FROM antigolpe_stats_por_classificacao;

-- Total por tipo de golpe identificado
SELECT * FROM antigolpe_stats_por_tipo_golpe;

-- Últimas interações
SELECT tipo_mensagem, classificacao, tipo_golpe, confianca, criado_em
FROM antigolpe_interacoes ORDER BY criado_em DESC LIMIT 20;
```

Rode via:
```powershell
docker exec evolution-postgres psql -U evolution -d n8n_prospecta -c "SELECT * FROM antigolpe_stats_por_classificacao;"
```

## Estrutura de arquivos

```
AntiGolpe/
├── README.md                              (este arquivo)
├── prompts/
│   └── antigolpe_system_prompt.md         (prompt do Gemini, documentado com few-shot)
├── sql/
│   └── 001_create_antigolpe_interacoes.sql (schema do Postgres)
├── workflows/
│   └── antigolpe.json                     (workflow completo do n8n, versionado)
└── scripts/
    └── test_webhook.js                    (teste automatizado ponta a ponta)
```

## Limitações conhecidas

- **Sem memória de conversa**: cada mensagem é analisada isoladamente. O
  caso de uso é "analise isso pra mim", não uma conversa contínua, então
  isso simplifica o sistema e evita o custo de manter memória por sessão.
- **Áudio/imagem dependem do formato que a Evolution API entrega**: o código
  assume os campos `imageMessage`/`audioMessage` no formato padrão do
  Baileys/Evolution API. Figurinhas (sticker), vídeo e documentos (PDF) não
  são tratados; mensagens desses tipos são ignoradas pelo filtro e nenhuma
  resposta é enviada.
- **Ainda sem teste com usuários idosos reais**: a validação com o grupo de
  idosos em São Sepé (RS) é uma etapa futura, fora do escopo deste código.
  Os exemplos few-shot do prompt foram escritos com base em golpes
  conhecidos e documentados publicamente, não em testes de campo.
- **Rate limit do Gemini**: usa o plano gratuito do Google AI Studio, sujeito
  a limite de requisições por minuto. Não há controle de fila/throttling
  além do retry automático do node (2 tentativas).
- **Não há painel visual** para as estatísticas: as consultas da seção
  "Como testar" são feitas via SQL direto.

## Segurança e privacidade

- O número de telefone de quem escreve **nunca é gravado em texto puro** no
  banco, só o hash SHA-256 (`telefone_hash`), calculado direto no SQL
  (`encode(sha256(numero::bytea), 'hex')`).
- O conteúdo da mensagem só é gravado (truncado em 300 caracteres) para
  mensagens de texto. Imagens e áudios são registrados apenas como
  `"[imagem recebido - conteúdo não textual]"` / `"[audio recebido...]"`,
  sem guardar o conteúdo em si.
- Nenhuma credencial (API key, senha) está neste repositório. O workflow só
  referencia os IDs das credenciais cadastradas no n8n.
