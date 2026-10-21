# Agente de triagem KYC/AML — Vértice Auditores & Consultores

MVP do desafio **Desenvolvedor(a) Google Cloud Pleno**: um agente que faz a triagem preliminar KYC/AML de oportunidades, com dados no **BigQuery**, evidências no **Cloud Storage**, regras determinísticas e um agente **ADK** (Gemini no Vertex AI) como interface.

> Caso fictício. Todos os dados, empresas e identificadores (`ID-SINTETICO-*`, `@vertice.example`) são sintéticos. Nenhuma alegação se refere a pessoas ou empresas reais.

- Desenho técnico: [docs/arquitetura.md](docs/arquitetura.md)
- Plano de trabalho e decisões: [docs/PLANO.md](docs/PLANO.md)
- Pareceres gerados: [pareceres/](pareceres/)

## Resultado

| Caso | Situação nos dados | Resultado | Encaminhamento | Motivo |
|---|---|---|---|---|
| V-001 | 4 fontes concluídas, nada encontrado | **LEVE** | gerente | — |
| V-002 | setor de criptoativos | **MODERADO** | sócio | `SETOR_SENSIVEL` |
| V-003 | sanção confirmada por identificador | **ALTO** | Comitê, início bloqueado | `SANCAO_CONFIRMADA` |
| V-004 | fonte de sanções indisponível | **PENDENTE** | pesquisa / gerente | `FONTE_INDISPONIVEL` |
| V-005 | sanção por nome, identificador diferente | **PENDENTE** | revisão humana | `HOMONIMO` |
| V-006 | snapshot de mídia pertence ao V-001 | **PENDENTE** | revisão humana | `EVIDENCIA_DE_OUTRO_CASO` |
| V-007 | sem registro da fonte PEP | **PENDENTE** | pesquisa / gerente | `FONTE_AUSENTE` |
| V-008 | `gcs_uri` aponta para objeto inexistente | **PENDENTE** | revisão humana | `EVIDENCIA_NAO_ENCONTRADA` |

V-001 a V-004 são os quatro cenários pedidos. V-005 a V-008 são exceções adicionais (o desafio pede ao menos uma).

## Como funciona (resumo)

```
pessoa → agente ADK (Gemini) → triar_caso(caso_id)
           → BigQuery: vertice_api.fn_caso(@caso_id)        um caso, por parâmetro
           → GCS: evidencias/{caso_id}/...                  existe? caso certo? sha256 = manifesto?
           → regras.classificar()                           função pura, sem LLM
           → parecer em modelo fixo → vertice_demo.pareceres
         ← parecer sem alteração + resumo
pessoa → decisão registrada em vertice_demo.decisoes_humanas
```

O Gemini **não classifica nem redige o parecer oficial**: ele só chama a ferramenta e apresenta o resultado. Detalhes em [docs/arquitetura.md](docs/arquitetura.md).

## Estrutura

```
src/
  tipos.ts        contrato (Oportunidade, Achado, Motivo, ResultadoTriagem)
  dados.ts        BigQuery (fn_caso) | espelho local data/*.csv
  evidencias.ts   GCS | espelho local data/gcs + conferência de integridade
  regras.ts       política do Anexo A (função pura)
  parecer.ts      parecer em modelo fixo + registro no BigQuery
  triar.ts        orquestração + linha de comando
  agent.ts        agente ADK (rootAgent, ferramenta triar_caso)
tests/            node:test — cenários, bordas e parecer
sql/              ddl.sql, fn_caso.sql, consultas.sql
infra/setup.sh    provisionamento GCP (APIs, BigQuery, GCS, conta de serviço, IAM)
data/             pacote sintético (CSVs, manifesto sha256, snapshots JSON)
scripts/          gerar-dados.ts (regenera o pacote)
pareceres/        pareceres preliminares gerados
```

## Como reproduzir

Requisito: **Node.js 24** (executa TypeScript direto, sem build).

O `.npmrc` desativa scripts de instalação das dependências (`ignore-scripts=true`): o `better-sqlite3`, trazido pelo `@google/adk-devtools`, já vem com binários prontos, mas tenta compilar e falha em máquinas sem ferramentas de C++. De quebra, reduz risco de cadeia de suprimentos. `npm test` e `npm run` funcionam normalmente.

### A. Local, sem GCP (2 minutos)

Usa o espelho em `data/` no lugar de BigQuery e GCS. Não precisa de conta nem gera custo.

```bash
npm ci
npm test
```

```bash
cp .env.example .env    # depois edite: KYC_LOCAL=1
npm run triar V-001 V-002 V-003 V-004
```

O comando imprime cada parecer e grava `pareceres/<caso>.md`. Com `--json`, imprime o resultado estruturado: `npm run triar -- --json V-003`.

### B. Nuvem (BigQuery, GCS, IAM e Gemini reais)

Requisitos: `gcloud` autenticado e um projeto com faturamento.

1. Provisionar (pode rodar de novo sem quebrar; no Windows, use o Git Bash):
   ```bash
   PROJECT=seu-projeto bash infra/setup.sh
   ```
   O script ativa as APIs, cria `vertice_demo` e `vertice_api` em `southamerica-east1`, carrega os CSVs, cria o bucket privado e versionado, envia os snapshots, cria e autoriza a `fn_caso`, cria a conta `kyc-agente` e aplica o IAM mínimo. O bucket padrão é `vertice-kyc-<projeto>`; com outro nome, regenere os dados com `KYC_BUCKET=<nome> node scripts/gerar-dados.ts` antes.
2. Rodar localmente **como a conta do agente**, sem chave JSON:
   ```bash
   gcloud auth application-default login --impersonate-service-account=kyc-agente@seu-projeto.iam.gserviceaccount.com
   ```
3. Configurar `.env` a partir de `.env.example` (`GOOGLE_CLOUD_PROJECT`, `KYC_BUCKET`, `KYC_LOCAL=0`).
4. Triar pela linha de comando (também grava em `vertice_demo.pareceres`):
   ```bash
   npm run triar V-001 V-002 V-003 V-004 V-005 V-006 V-007 V-008
   ```
5. Conversar com o agente:
   ```bash
   npm run agente
   ```
   Abre o ADK Web em http://localhost:8000. Alternativa no terminal: `npm run agente:cli`.
6. Consultas de demonstração e monitoramento: [sql/consultas.sql](sql/consultas.sql).

## Testes

`npm test` roda o `tsc` (checagem de tipos) e 29 testes com `node:test`, offline, sobre `data/`.

| Grupo | O que prova |
|---|---|
| Cenários V-001 a V-008 | resultado, motivos, bloqueio e encaminhamento esperados |
| Rastreabilidade | todo motivo cita `evidencia_id` e `gcs_uri` do próprio caso; V-001 cita as 4 evidências conferidas |
| Sem achados | `LEFT JOIN` vazio vira PENDENTE, nunca LEVE |
| Arquivo alterado | 1 palavra trocada no snapshot muda o sha256: `EVIDENCIA_ALTERADA` e PENDENTE |
| URI fora do caso | caminho de outro caso ou com `..` não é lido |
| ALTO + fonte indisponível | ALTO prevalece, pendência listada |
| MODERADO + pendência | PENDENTE com piso MODERADO |
| Consulta vencida | mais de 12 meses: `CONSULTA_VENCIDA` |
| Beneficiário final não identificado | ALTO |
| `caso_id` malicioso | `V-001' OR 1=1 --`, `../V-001` etc. são recusados antes de qualquer leitura |
| Contaminação | achado de outro caso interrompe a triagem |
| Parecer | cada parecer traz resultado, todas as evidências, motivos, aviso de decisão humana e validade de 12 meses |

Também foi verificado que **local e nuvem dão o mesmo resultado** nos 8 casos, e que o agente recusa aprovar casos e recusa identificadores fora do formato.

## O que é simulado ou não foi executado

| Item | Situação |
|---|---|
| Fontes (sanções, PEP, processos, mídia) | snapshots JSON sintéticos; nenhuma coleta real |
| SEC (permissibilidade) e Salesforce | fora do escopo. O SEC seria uma checagem anterior ao KYC ("a Vértice pode prestar este serviço a este cliente?"); fica como evolução |
| Comitê e decisões humanas | tabela `decisoes_humanas` + exemplo de `INSERT` em `sql/consultas.sql`; sem fluxo integrado |
| Deploy do agente | não executado. O agente roda local com a mesma conta de serviço que usaria no Agent Engine ou no Cloud Run |
| Retention lock do bucket | não aplicado (é irreversível); descrito abaixo |
| BigQuery, GCS, IAM e Gemini | **reais**, no projeto `projeto-vertice-auditores` |

## Segurança

- **Menor privilégio:** a conta `kyc-agente` só lê através da `fn_caso` (um caso por chamada), só lê objetos sob `evidencias/` (sem listar, sem escrever) e só escreve em `pareceres`. Matriz completa em [docs/arquitetura.md](docs/arquitetura.md#5-identidade-e-permissões).
- **Sem SQL livre:** o agente tem uma ferramenta; o `caso_id` é validado por regex (`zod` e código) e vai como parâmetro da consulta.
- **Sem chave de conta de serviço:** uso local via impersonation; `.env` e `*.key.json` estão no `.gitignore`.
- **Bucket:** acesso uniforme por IAM, prevenção de acesso público, versionamento.
- **Prompt injection:** trechos e snapshots são dados. A classificação não passa pelo LLM, e a instrução do agente manda ignorar ordens contidas em evidências.
- **Integridade:** manifesto sha256 independente do bucket; `.gitattributes` evita que o Git altere os snapshots.

## Dados pessoais e LGPD

- **Neste repositório:** só dados sintéticos; nenhum CPF, CNPJ, nome ou e-mail real.
- **Finalidade (implantação real):** diligência KYC/AML antes da contratação, conforme a política da firma.
- **Acesso:** papéis da seção de segurança; leitura de dados brutos só por administradores; agente restrito a um caso por vez.
- **Retenção:** parecer válido por até 12 meses (ou até alteração societária relevante); registros de PLD guardados pelo prazo legal (a Lei 9.613/1998 exige no mínimo 5 anos), com retention policy no bucket e expiração por partição nas tabelas.
- **Residência:** dados e evidências em `southamerica-east1`. O Gemini recebe só o pedido do usuário e o parecer já pronto.

## Custos

| Serviço | Uso no MVP | Custo |
|---|---|---|
| BigQuery | KB de dados, dezenas de consultas | US$ 0 (free tier: 1 TB de consulta e 10 GB de armazenamento por mês) |
| Cloud Storage | 30 arquivos de ~1 KB | ~US$ 0 |
| Vertex AI (Gemini 2.5 Flash) | dezenas de chamadas curtas | centavos |

Recomendado: alerta de orçamento (por exemplo, US$ 5) no Billing, sem contar os créditos. Para apagar tudo:

```bash
gcloud projects delete seu-projeto
```

Ou só os recursos: `bq rm -r -f seu-projeto:vertice_demo`, `bq rm -r -f seu-projeto:vertice_api`, `gcloud storage rm -r gs://vertice-kyc-seu-projeto` e `gcloud iam service-accounts delete kyc-agente@seu-projeto.iam.gserviceaccount.com`.

## O que eu monitoraria em produção

- **Qualidade:** taxa de PENDENTE por motivo (`sql/consultas.sql`, consulta 6); divergência entre recomendação e decisão humana (hoje 19% entre analistas); casos LEVE revertidos depois.
- **Fontes:** disponibilidade e latência por fonte; idade das consultas.
- **Integridade:** qualquer `EVIDENCIA_ALTERADA` ou `EVIDENCIA_DE_OUTRO_CASO` gera alerta imediato.
- **Processo:** casos bloqueados sem decisão humana há mais de N dias (consulta 5); projetos iniciados sem parecer.
- **Segurança:** Cloud Audit Logs (Data Access) de BigQuery e GCS; alerta para acesso negado à conta do agente.
- **Operação e custo:** tempo por triagem, tokens do Gemini por caso, custo por caso.

## Limitações e o que faria antes de produção

- **Fontes reais:** substituir os snapshots por coletores, com o snapshot e o sha256 gravados no momento da coleta.
- **Deploy:** publicar o agente no Agent Engine ou no Cloud Run com a conta `kyc-agente`, atrás de autenticação (IAP) e com Secret Manager para a configuração.
- **Guarda de saída do LLM:** conferir automaticamente que a resposta do chat não contradiz o resultado do parecer (hoje o registro oficial já não depende do LLM, mas o chat pode errar no resumo).
- **Separar a saída:** `pareceres` e `decisoes_humanas` num dataset próprio, com retenção e auditoria próprias.
- **Retention lock** no bucket e expiração por partição, conforme o prazo legal.
- **Política versionada:** a lista de setores sensíveis e a de fontes obrigatórias viriam de configuração aprovada pela área de compliance, com o `regras_versao` gravado em cada parecer (já existe).
- **Mais exceções:** alteração societária relevante (invalida o parecer), entidade no exterior (MODERADO, não modelado porque não há campo nos dados).
- **CI:** `npm test` e um `setup.sh` em projeto de teste a cada mudança.

## Uso de IA, bibliotecas e serviços

- **Claude (Anthropic)**, via Claude Code: apoio na análise do desafio, no desenho, no código, nos testes e na documentação. Todo o conteúdo foi revisado e as decisões foram tomadas pelo autor.
- **Gemini 2.5 Flash (Vertex AI):** modelo do agente.
- **Bibliotecas:** `@google/adk`, `@google/adk-devtools`, `@google-cloud/bigquery`, `@google-cloud/storage`, `zod`, `csv-parse`, `typescript` (ver `package.json`).
- **Serviços Google Cloud:** BigQuery, Cloud Storage, IAM, IAM Credentials, Vertex AI.
