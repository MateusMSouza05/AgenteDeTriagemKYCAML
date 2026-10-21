# Plano de ação — Agente de triagem KYC/AML (Opção B · híbrida)

> Prazo: 20/10 (ter) a 24/10 (sáb). Orçamento: 8 a 12 h. Apresentação: 45 min.
> Documento de trabalho. Partes dele viram `docs/arquitetura.md` e `README.md` na entrega.

---

## 1. Problema em uma frase

Automatizar a coleta, a conferência e a classificação preliminar de risco KYC/AML, **sem tirar o humano da decisão** e **com prova de cada afirmação**.

## 2. Por que a Opção B

| | A · tudo no GCP | **B · híbrida** | C · 100% local |
|---|---|---|---|
| BigQuery/GCS reais | sim | **sim** | não (só SQL escrito) |
| IAM real (menor privilégio) | sim | **sim** | não |
| Agente | Agent Engine/Cloud Run | **local (`adk web`)** | local |
| Tempo extra de infra | +3 a 5 h | **+1,5 h** | 0 |
| Risco na demo | alto (deploy, rede) | **médio, com fallback local** | baixo |
| Nota em "Arquitetura e segurança" (25%) | máxima | **quase máxima** | baixa |

**Decisão:** B. Dados, evidências, permissões e modelo rodam de verdade no Google Cloud. Só o processo do agente roda na máquina. O PDF aceita isso de forma explícita: *"É aceitável executar parte da solução localmente [...] identifique partes não executadas."* O deploy do agente fica descrito, não executado, e isso é declarado no README.

**Fallback:** o mesmo código roda com `KYC_LOCAL=1`, lendo `data/*.csv` e `data/gcs/`. Se a rede ou o GCP falharem na apresentação, a demo continua.

---

## 3. Arquitetura

```
 Pessoa (gerente/avaliador)
        │ "triar V-003"
        ▼
 ┌──────────────────────────── Agente ADK (Gemini) ─────────────────────────────┐
 │  Interface em linguagem natural. Só chama a ferramenta; não classifica.       │
 │  Ferramenta única: triar_caso(caso_id)                                        │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼   (código TypeScript determinístico)
   1. valida caso_id (regex ^V-\d{3}$)
   2. dados.carregar_caso ──────────▶ BigQuery: vertice_api.fn_caso(@caso_id)
                                        (table function autorizada; só um caso por vez)
   3. evidencias.conferir ──────────▶ GCS: evidencias/{caso_id}/{evidencia_id}.json
                                        existe? caso_id bate? sha256 bate? evidência mínima?
   4. regras.classificar ───────────▶ LEVE | MODERADO | ALTO | PENDENTE + motivos
   5. parecer.renderizar ───────────▶ parecer oficial (modelo fixo, cita evidencia_id + gcs_uri)
   6. grava em vertice_demo.pareceres (só acrescenta linhas)
                                     ▼
   Agente apresenta o parecer e o encaminhamento:
   LEVE → gerente · MODERADO → sócio · ALTO → Comitê + bloqueio · PENDENTE → responsável + motivo
                                     ▼
   Decisão humana registrada em vertice_demo.decisoes_humanas (o agente NÃO escreve aqui)
```

### Por que assim

- **O LLM não decide nada.** A classificação sai de uma função TypeScript pura, testável e explicável. O Gemini só conversa e apresenta. Atende ao requisito *"Separe consultas e regras determinísticas da geração de linguagem natural"*. Também elimina a principal crítica possível a um agente regulatório: alucinar um nível de risco.
- **Parecer oficial = modelo fixo.** O texto gravado no BigQuery nunca é gerado pelo LLM. Se o Gemini cair, o parecer continua sendo produzido.
- **Ferramenta única.** Menos superfície de ataque. O agente não tem como "pedir outra coisa" ao banco ou ao bucket.

### Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| LLM classifica com base nos achados | Não determinístico, não auditável, viola o requisito |
| Agent Builder sem código | Pouco controle sobre a separação regra/LLM e sobre os testes |
| Regras em SQL (view no BigQuery) | Possível, mas a conferência da evidência (GCS) acontece fora do SQL; manter a regra num lugar só (TypeScript) simplifica |
| Várias ferramentas (consultar_bq, ler_gcs...) | O LLM passaria a orquestrar consultas; mais risco e nenhum ganho |

---

## 4. Modelo de dados (BigQuery)

Dois datasets: `vertice_demo` (mesmo nome do SQL inicial do PDF, para o avaliador reconhecer) e `vertice_api`. No BigQuery a permissão costuma ser por dataset: quem lê um dataset lê todas as tabelas dele. A rotina autorizada precisa ficar **fora** do dataset das tabelas brutas; senão, a permissão para chamá-la também libera `SELECT *` nas tabelas.

| Dataset | Tabelas / rotinas | Quem acessa |
|---|---|---|
| `vertice_demo` | `oportunidades`, `achados`, `evidencias` (manifesto), `pareceres`, `decisoes_humanas` | administradores; a rotina autorizada lê; **permissão por tabela**: agente escreve só `pareceres`, humanos escrevem só `decisoes_humanas` |
| `vertice_api` | `fn_caso(caso_id)` — table function | agente (leitura) |

### Tabelas

- **`oportunidades`**: contrato original do PDF. PK `caso_id`.
- **`achados`**: contrato original do PDF, com as 9 colunas. PK `(caso_id, achado_id)`, porque `achado_id` se repete entre casos (`A-SAN`). Clusterizada por `caso_id`, já que toda consulta filtra por caso.
- **`evidencias`** (nova): `evidencia_id`, `caso_id`, `gcs_uri`, `sha256`. É o manifesto de integridade, gravado no momento da carga. O `generation` ficou de fora: o sha256 já detecta alteração e o versionamento do bucket guarda o histórico.
- **`pareceres`** (nova): `parecer_id`, `caso_id`, `resultado`, `motivos` (JSON), `evidencias` (ARRAY), `texto`, `regras_versao`, `gerado_em`, `valido_ate`. Só recebe inserções, nunca atualizações; o histórico fica preservado.
- **`decisoes_humanas`** (nova): `caso_id`, `parecer_id`, `decisao` (APROVADO/RECUSADO/LIBERADO_INICIO), `responsavel`, `justificativa`, `decidido_em`.

### Como evitar que um achado de outro caso contamine o parecer (requisito 1)

1. **Na consulta:** a table function recebe `@caso_id` como parâmetro, sem concatenar string. Isso impede SQL injection e impede trazer outro caso.
2. **No código:** uma verificação explícita confere que toda linha retornada tem `caso_id === caso pedido` e interrompe a triagem se não tiver.
3. **No caminho do GCS:** o caminho carrega o caso (`evidencias/{caso_id}/...`), e o código recusa URIs fora desse prefixo.
4. **No conteúdo:** o `caso_id` gravado dentro do snapshot JSON precisa bater. O caso V-006 testa justamente isso.
5. **No join:** `USING (caso_id)`, nunca pelo nome da empresa.

### Armadilha do `LEFT JOIN`

Uma oportunidade sem achados devolve uma linha com nulos. A regra trata isso como "consultas não realizadas", logo PENDENTE, nunca como "nada encontrado", logo LEVE. Há um teste específico para isso.

---

## 5. Evidências (GCS)

### Organização do bucket

```
gs://vertice-kyc-<projeto>/
  evidencias/{caso_id}/{evidencia_id}.json
```

O URI difere do exemplo do PDF (`evidencias/a-sancoes.json`). O PDF autoriza a mudança: *"adapte os URIs e declare o mapeamento"*. **Motivo:** com o caso no caminho, cada caso fica isolado, a permissão pode ser por prefixo e a contaminação é detectável.

### Configuração do bucket e por quê

| Configuração | Por quê |
|---|---|
| Uniform bucket-level access | Permissão só por IAM, sem ACL por objeto, mais fácil de auditar |
| Public access prevention | Impede publicar evidência por engano |
| Object versioning | Arquivo alterado vira nova *generation*; a versão original não se perde |
| Região `southamerica-east1` | Residência de dados no Brasil (argumento de LGPD), na mesma região do BigQuery |
| Retention policy (descrita, não travada) | Política de retenção; travar é irreversível, então fica só no desenho |

### Como detectar referência quebrada ou arquivo alterado (requisito 2)

Para cada achado, `evidencias.conferir` verifica, nesta ordem:

| Checagem | Falha | Motivo registrado |
|---|---|---|
| URI dentro de `evidencias/{caso_id}/` | fora do prefixo | `EVIDENCIA_FORA_DO_CASO` |
| Objeto existe | 404 (caso V-008) | `EVIDENCIA_NAO_ENCONTRADA` |
| sha256 do conteúdo == manifesto | divergente | `EVIDENCIA_ALTERADA` |
| `caso_id` dentro do JSON == caso | divergente (caso V-006) | `EVIDENCIA_DE_OUTRO_CASO` |
| Evidência mínima (fonte, identificador/URL, data/hora, trecho) | campo ausente | `EVIDENCIA_INCOMPLETA` |

**Por que sha256 próprio e não o `md5Hash` do GCS:** o md5 do GCS prova que o upload não corrompeu, mas é recalculado se alguém sobrescreve o arquivo. O sha256 gravado no BigQuery no momento da carga é uma âncora independente. Quem altera o arquivo não altera o manifesto, porque não tem permissão nos dois lugares.

**Demo ao vivo:** editar um JSON, subir de novo e rodar a triagem, que acusa `EVIDENCIA_ALTERADA`.

---

## 6. Regras (determinísticas)

Função pura `classificar(oportunidade: Oportunidade, achados: AchadoConferido[]): Resultado`, avaliada nesta ordem:

1. **Integridade.** Qualquer falha da seção 5 gera um motivo de exceção, e o achado afetado **não vira fato**.
2. **Completude.** As 4 fontes obrigatórias (`SANCOES`, `PEP`, `PROCESSOS`, `MIDIA`) precisam ter linha com status `CONCLUIDA`.
   - Linha ausente: `FONTE_AUSENTE` (V-007).
   - Status `INDISPONIVEL`: `FONTE_INDISPONIVEL` (V-004).
   - `consultado_em` com mais de 12 meses: `CONSULTA_VENCIDA`.
3. **Confirmação.** Um achado `ALTO`/`MODERADO` só vira fato se o identificador no snapshot for igual ao `cnpj` da oportunidade. Caso contrário: `HOMONIMO` (V-005).
4. **Nível pelos fatos confirmados e pelo cadastro:**
   - ALTO: sanção ou achado ALTO confirmado; beneficiário final não identificado.
   - MODERADO: achado MODERADO confirmado; setor sensível (apostas, criptoativos, metais preciosos, comércio exterior).
   - Cadastro não ativo: impede LEVE e gera o motivo `CADASTRO_INATIVO`.
5. **Resultado final**, seguindo *"prevalece o maior nível sustentado por achado confirmado"*:
   - Há fato ALTO: **ALTO**, mesmo com pendências, que são listadas. Encaminha ao Comitê e bloqueia o início.
   - Há qualquer pendência ou exceção: **PENDENTE**, com piso de nível quando houver MODERADO. Nunca LEVE.
   - Há fato MODERADO: **MODERADO**, que exige aprovação do sócio e monitoramento reforçado.
   - Nenhum dos anteriores: **LEVE**, parecer preliminar para o gerente.

Cada motivo carrega `codigo`, `descricao` e `evidencia_id`, o que dá evidência por fato.

### Resultado esperado dos 8 casos

| Caso | Dado | Resultado | Encaminhamento | Motivo |
|---|---|---|---|---|
| V-001 | 4 fontes OK, nada encontrado | LEVE | gerente | — |
| V-002 | setor criptoativos | MODERADO | sócio | `SETOR_SENSIVEL` |
| V-003 | sanção com identificador igual | ALTO | Comitê + bloqueio | `SANCAO_CONFIRMADA` |
| V-004 | sanções indisponível | PENDENTE | gerente/analista | `FONTE_INDISPONIVEL` |
| V-005 | sanção, identificador diferente | PENDENTE | revisão humana | `HOMONIMO` |
| V-006 | snapshot de mídia é do V-001 | PENDENTE | revisão humana | `EVIDENCIA_DE_OUTRO_CASO` |
| V-007 | sem linha de PEP | PENDENTE | analista | `FONTE_AUSENTE` |
| V-008 | gcs_uri inexistente | PENDENTE | revisão humana | `EVIDENCIA_NAO_ENCONTRADA` |

---

## 7. Segurança e permissões

### Identidades

| Identidade | Papel | Onde |
|---|---|---|
| Você (administrador) | Owner do projeto; roda `setup.sh` | projeto |
| `kyc-agente@<proj>.iam.gserviceaccount.com` | `roles/bigquery.jobUser` | projeto |
| | `roles/bigquery.dataViewer` | **só** dataset `vertice_api` (rotina autorizada) |
| | `roles/bigquery.dataEditor` | **só** tabela `vertice_demo.pareceres` (permissão por tabela) |
| | `roles/storage.objectViewer` com condição IAM `objects/evidencias/` | bucket |
| | `roles/aiplatform.user` | projeto (Gemini) |
| Revisor humano | `dataEditor` em `decisoes_humanas` | tabela |

**Rotina autorizada:** o agente não tem acesso a `vertice_demo`. A table function `fn_caso` é autorizada a ler esse dataset em nome do agente. Na prática, o agente só enxerga dados através dela, um caso por vez. Essa é a resposta direta a *"Não permita SQL livre"*.

**Evolução para produção:** separar a saída (`pareceres`, `decisoes_humanas`) num terceiro dataset, com retenção e auditoria próprias. No MVP, a permissão por tabela já garante o mesmo privilégio mínimo com menos peças.

### Sem chave JSON de conta de serviço

Localmente, o código roda como a conta do agente via impersonation:

```bash
gcloud auth application-default login --impersonate-service-account=kyc-agente@<proj>.iam.gserviceaccount.com
```

Nenhuma chave em disco ou no repositório. Para isso, seu usuário recebe `roles/iam.serviceAccountTokenCreator` na conta do agente. Ponto extra na avaliação: rodar local já exercita o privilégio mínimo real.

### Outros cuidados

- Validação de `caso_id` por regex antes de qualquer consulta.
- **Prompt injection:** o `trecho` e os snapshots são dados. Não passam pela regra via LLM. O agente recebe o resultado já estruturado, e a instrução proíbe alterar o nível.
- `.gitignore` para `.env` e credenciais. Dados 100% sintéticos (`ID-SINTETICO-*`, e-mails `@vertice.example`).
- Validade do parecer: `valido_ate = gerado_em + 12 meses`.
- Finalidade e retenção descritas no README (LGPD: finalidade = diligência pré-contratação; acesso = papéis acima; retenção = prazo regulatório).

---

## 8. Testes

Arquivo único `tests/triagem.test.ts` (`node --test`, o runner que já vem no Node, sem Jest), rodando no modo local, sem GCP e sem custo:

| Teste | Entrada | Saída esperada |
|---|---|---|
| 8 casos ponta a ponta | V-001 a V-008 | tabela da seção 6 |
| Sem achados (armadilha do LEFT JOIN) | oportunidade sem linhas | PENDENTE / `FONTE_AUSENTE` |
| Arquivo alterado | snapshot com 1 byte mudado | PENDENTE / `EVIDENCIA_ALTERADA` |
| ALTO + fonte indisponível | sanção confirmada + PEP indisponível | ALTO (pendência listada) |
| Consulta vencida | `consultado_em` com 13 meses | PENDENTE / `CONSULTA_VENCIDA` |
| caso_id malicioso | `"V-001' OR 1=1"` | erro de validação, nenhuma consulta |

Os mesmos 8 casos também rodam contra o BigQuery e o GCS reais na demo, provando que local e nuvem dão o mesmo resultado.

---

## 9. Estrutura do repositório

```
AgenteDeTriagemKYCAML/
  data/                 base sintética (pronta)
    oportunidades.csv  achados.csv  sec_mock.json  gcs/evidencias/...
  sql/
    ddl.sql             tabelas (pronto, ajustar para 2 datasets)
    fn_caso.sql         table function autorizada
    consultas.sql       consultas de demonstração
  infra/setup.sh        gcloud/bq: APIs, datasets, carga, bucket, upload, manifesto, conta, IAM
  src/
    tipos.ts            Oportunidade, Achado, Motivo, Resultado (contrato das regras)
    dados.ts            BigQuery | CSV (KYC_LOCAL=1)
    evidencias.ts       GCS | pasta local + checagens da seção 5
    regras.ts           classificar() — pura
    parecer.ts          modelo fixo do parecer
    agent.ts            rootAgent ADK, ferramenta triar_caso
    triar.ts            CLI: node src/triar.ts V-003 (demo sem LLM)
  scripts/gerar-dados.ts  (porta do gerador Python; uma linguagem só no projeto)
  tests/triagem.test.ts
  docs/PLANO.md  docs/arquitetura.md
  README.md  .env.example  package.json  tsconfig.json
```

**Stack:** TypeScript no Node 24 (já instalado).

| Necessidade | Pacote | Por quê |
|---|---|---|
| Agente | `@google/adk` + `@google/adk-devtools` | ADK oficial para TypeScript (repo `google/adk-js`); `adk web` para a demo |
| BigQuery | `@google-cloud/bigquery` | cliente oficial; consulta parametrizada nativa (`params`) |
| GCS | `@google-cloud/storage` | cliente oficial; lê `generation` e metadados |
| Schema da ferramenta | `zod` | é o formato que o ADK TS usa para descrever parâmetros da ferramenta |
| CSV (modo local) | `csv-parse` | o Node não tem parser de CSV; escrever um à mão erra em aspas e vírgulas |
| Testes | `node:test` + `node:assert` | já vêm no Node; zero dependência |
| sha256 | `node:crypto` | já vem no Node |
| Rodar `.ts` | o próprio Node 24 | executa TypeScript direto (type stripping), sem build nem `ts-node`; `tsc --noEmit` só para checar tipos |

Gemini via Vertex AI (modelo flash vigente), configurado por `.env` (`GOOGLE_GENAI_USE_VERTEXAI=TRUE`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`).

**Restrição do type stripping:** o código não usa `enum`, `namespace` nem parameter properties. Para conjuntos fechados, usa union de strings (`type Resultado = 'LEVE' | 'MODERADO' | 'ALTO' | 'PENDENTE'`), que também é mais legível.

### Por que TypeScript

- Você vai defender o código ao vivo; a linguagem com mais fluência pesa mais que a escolha "padrão".
- Tipos explícitos (`Resultado`, `Motivo`, `AchadoConferido`) deixam o contrato das regras visível no próprio código, o que ajuda na rastreabilidade.
- O desafio não exige linguagem (*"ADK ou caminho mais simples"*), e o ADK tem SDK oficial em TS.
- **Trade-off aceito:** o ADK Python tem mais exemplos e documentação. Dúvidas no TS se resolvem pelo código-fonte do `adk-js`.

---

## 10. Cronograma

| Dia | Fase | O quê | Horas | Pronto quando |
|---|---|---|---|---|
| **Ter 20** | 0 · Preparação | login gcloud, projeto, alerta de orçamento, APIs, `npm init` + dependências, `git init` | 1 | `gcloud auth list` ok, `bq ls` ok |
| **Qua 21** | 1 · Núcleo | `tipos.ts`, `regras.ts`, `evidencias.ts` (local), `dados.ts` (local), porta do gerador, testes | 2,5 | `node --test` verde nos 8 casos + bordas |
| **Qui 22** | 2 · Infra GCP | `setup.sh`, `fn_caso.sql`, carga, bucket, manifesto, IAM | 1,5 | consulta via conta do agente devolve só 1 caso |
| | 3 · Adaptadores | BigQuery e GCS reais em `dados.ts`/`evidencias.ts` | 1,5 | mesmos resultados local × nuvem |
| **Sex 23** | 4 · Agente | `parecer.ts`, `agent.ts`, `triar.ts`, gravação em `pareceres` | 2 | `adk web` tria os 8 casos |
| | 5 · Documentação | `arquitetura.md`, README (custos, segurança, monitoramento, limitações, uso de IA) | 1,5 | README reproduzível do zero |
| **Sáb 24** | 6 · Entrega | ensaio de 45 min, vídeo reserva, envio | 1 | enviado |
| | | **Total** | **~11 h** | |

**Ordem com motivo:** o núcleo (regras + testes) vem primeiro porque concentra 60% da nota e não depende de nada externo. Se o GCP travar, ainda existe uma entrega sólida.

---

## 11. Custos (estimativa)

| Serviço | Uso | Custo |
|---|---|---|
| BigQuery | KB de dados, dezenas de consultas | US$ 0 (free tier: 1 TB/mês de consulta, 10 GB de armazenamento) |
| Cloud Storage | ~30 arquivos de 1 KB | ~US$ 0 |
| Vertex AI Gemini (flash) | ~100 chamadas curtas | < US$ 0,50 |
| **Total do desafio** | | **< US$ 1, debitado dos créditos** |

**Proteção:** alerta de orçamento de US$ 5 no Billing (fase 0). No fim, `gcloud projects delete` ou apagar o bucket e os datasets.

---

## 12. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| ADK TS com menos exemplos que o Python | média | atraso na fase 4 | o agente é fino (1 ferramenta); consultar o código do `adk-js`; plano B: `triar.ts` (CLI) demonstra tudo sem LLM |
| Type stripping do Node não aceita `enum`/`namespace` | baixa | erro ao rodar | usar union de strings; `tsc --noEmit` no `npm test` pega cedo |
| Mistura ESM/CommonJS nos pacotes Google | baixa | erro de import | `"type": "module"` no `package.json` desde o início |
| Quota ou modelo Gemini indisponível na conta trial ou na região | média | agente sem LLM | `GOOGLE_CLOUD_LOCATION=global`; o parecer oficial não depende do LLM; dá para demonstrar via CLI |
| Nome do bucket já usado (nome global) | alta | `setup.sh` falha | usar `vertice-kyc-<projeto>` |
| Datasets e bucket em regiões diferentes | baixa | erro de carga | tudo em `southamerica-east1`, definido numa variável só |
| Impersonation falha (falta `serviceAccountTokenCreator`) | média | código sem credencial | `setup.sh` concede; propagação de IAM leva até 1–2 min |
| Scripts bash no Windows | média | `setup.sh` não roda | rodar no Git Bash (já instalado) |
| LLM "reinterpreta" o nível no chat | baixa | resposta incoerente | instrução restrita + o parecer oficial é o texto da ferramenta, exibido como está |
| Rede ou GCP falha na demo | baixa | demo trava | `KYC_LOCAL=1` + vídeo reserva |
| Estourar o orçamento de horas | média | entrega incompleta | cortes em ordem: SEC mock → gravação em `pareceres` → `adk web` (usar CLI) |
| Custo inesperado | baixa | consumir créditos | alerta de US$ 5 + limpeza no fim |

---

## 13. Monitoramento numa implantação real (para o README)

- **Qualidade:** taxa de PENDENTE por motivo; divergência entre a recomendação e a decisão humana (meta: abaixo dos 19% atuais); casos LEVE revertidos depois.
- **Fontes:** disponibilidade e latência por fonte; idade das consultas.
- **Integridade:** contagem de `EVIDENCIA_*` por dia. Qualquer `EVIDENCIA_ALTERADA` gera alerta imediato.
- **Segurança:** Cloud Audit Logs (Data Access) no BigQuery e no GCS; alerta quando a conta do agente tem acesso negado (tentativa fora do escopo).
- **Operação e custo:** tempo de triagem, tokens Gemini por caso, custo por caso.
- **Processo:** casos ALTO sem decisão humana há mais de N dias; projetos iniciados sem parecer.

---

## 14. Fora do escopo (declarado)

SEC e Salesforce reais, coleta automática de fontes, Comitê integrado, business case, deploy do agente (descrito: Agent Engine ou Cloud Run com a mesma conta de serviço), travamento da retention policy.

## 15. Uso de IA (declarar na entrega)

Claude (Anthropic) como assistente de análise, código e documentação; Gemini (Vertex AI) como LLM do agente; bibliotecas listadas em `package.json`.

---

## 16. Início das atividades — Fase 0 (hoje)

Passos que dependem de você:

1. **gcloud CLI:** já instalado (SDK 559.0.0, bq 2.1.28).
2. **Login:**
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```
3. **Criar o projeto** (ou usar o criado com a conta) e anotar o ID: `gcloud projects list`.
4. **Billing:** confirmar o projeto vinculado à conta de créditos e criar um alerta de orçamento de US$ 5 (Console → Billing → Budgets & alerts).
5. **Node:** 24 já instalado (roda TypeScript direto).
6. **Git:** `git init` nesta pasta. A pasta pai `Documents` já é um repositório, então este projeto precisa do próprio.

Passos que eu faço em seguida:

- Ativar as APIs (`bigquery`, `storage`, `aiplatform`, `iamcredentials`) e escrever o `infra/setup.sh`.
- Criar `package.json`/`tsconfig.json`, portar o gerador e escrever `tipos.ts`, `regras.ts`, `evidencias.ts`, `dados.ts` (modo local) e os testes. Isso não depende do GCP e pode começar já.
