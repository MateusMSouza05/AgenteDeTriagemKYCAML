#!/usr/bin/env bash
# Provisiona o lado GCP do MVP: APIs, BigQuery, GCS, conta de serviço e IAM de menor privilégio.
# Pode rodar de novo sem quebrar. Todo comando passa o projeto explicitamente (nunca depende do padrão do gcloud).
#   PROJECT=projeto-vertice-auditores bash infra/setup.sh
set -euo pipefail

PROJECT="${PROJECT:-projeto-vertice-auditores}"
REGION="${REGION:-southamerica-east1}"
BUCKET="${KYC_BUCKET:-vertice-kyc-$PROJECT}"
SA_NAME="kyc-agente"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
USER_EMAIL="$(gcloud config get account 2>/dev/null)"
cd "$(dirname "$0")/.."

# O bq precisa de Python; no Windows/Git Bash, aponta para o mesmo que o gcloud já usa.
: "${CLOUDSDK_PYTHON:=$(gcloud info --format='value(basic.python_location)')}"
export CLOUDSDK_PYTHON
BQ="bq --project_id=$PROJECT --location=$REGION --quiet"
sql() { sed "s/SEU_PROJETO/$PROJECT/g" "$1" | $BQ query --use_legacy_sql=false --format=none; }
step() { echo; echo "== $*"; }

step "1. APIs"
gcloud services enable bigquery.googleapis.com storage.googleapis.com aiplatform.googleapis.com \
  iamcredentials.googleapis.com cloudresourcemanager.googleapis.com --project "$PROJECT"

step "2. Datasets ($REGION)"
$BQ show --dataset "$PROJECT:vertice_demo" >/dev/null 2>&1 || \
  $BQ mk --dataset --description "KYC/AML synthetic data (hiring challenge)" "$PROJECT:vertice_demo"
$BQ show --dataset "$PROJECT:vertice_api" >/dev/null 2>&1 || \
  $BQ mk --dataset --description "Authorized table functions: the agent's only read path" "$PROJECT:vertice_api"

step "3. Tabelas e dados"
# As tabelas de entrada são recriadas a partir de data/*.csv a cada execução. Elas são apagadas em vez de
# carregadas com --replace porque a carga que trunca reescreve o schema e descarta PK/FK sem avisar.
# pareceres e decisoes_humanas nunca são apagadas.
for t in achados evidencias oportunidades; do $BQ rm -f --table "$PROJECT:vertice_demo.$t"; done
sql sql/ddl.sql
for t in oportunidades achados evidencias; do
  $BQ load --source_format=CSV --skip_leading_rows=1 "$PROJECT:vertice_demo.$t" "data/$t.csv"
done

step "4. Bucket gs://$BUCKET (acesso uniforme, sem acesso público, versionamento)"
gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --project "$PROJECT" --versioning

step "5. Snapshots de evidência"
gcloud storage rsync --recursive data/gcs/evidencias "gs://$BUCKET/evidencias" --project "$PROJECT"

step "6. Table function autorizada"
sql sql/fn_caso.sql
# Adiciona ou remove uma entrada de acesso de um dataset (o bq não tem flag para rotina autorizada / leitor único).
dataset_access() { # add|remove dataset json-entry
  local f="infra/.dataset-$2.json"
  $BQ show --format=prettyjson "$PROJECT:$2" > "$f"
  node -e '
    const fs = require("fs"); const [mode, f, entry] = process.argv.slice(1);
    const ds = JSON.parse(fs.readFileSync(f, "utf8")); const e = JSON.parse(entry);
    const canon = v => v && typeof v === "object" ? JSON.stringify(Object.keys(v).sort().map(k => [k, canon(v[k])])) : JSON.stringify(v);
    ds.access = ds.access.filter(a => canon(a) !== canon(e)); // o BigQuery pode devolver as chaves em outra ordem
    if (mode === "add") ds.access.push(e);
    fs.writeFileSync(f, JSON.stringify(ds));' "$1" "$f" "$3"
  $BQ update --source "$f" "$PROJECT:$2" >/dev/null
  rm -f "$f"
}
# CREATE OR REPLACE invalida a autorização, por isso ela é removida e concedida de novo a cada execução.
ROUTINE="{\"routine\":{\"projectId\":\"$PROJECT\",\"datasetId\":\"vertice_api\",\"routineId\":\"fn_caso\"}}"
dataset_access remove vertice_demo "$ROUTINE"
dataset_access add vertice_demo "$ROUTINE"

step "7. Conta de serviço $SA"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name "KYC triage agent (read one case, write pareceres)"
  sleep 15 # conta de serviço nova leva alguns segundos para poder entrar em políticas de IAM
fi

step "8. IAM de menor privilégio para o agente"
for role in roles/bigquery.jobUser roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" \
    --condition None --quiet >/dev/null
done
dataset_access add vertice_api "{\"role\":\"READER\",\"userByEmail\":\"$SA\"}"
$BQ add-iam-policy-binding --member "serviceAccount:$SA" --role roles/bigquery.dataEditor \
  "$PROJECT:vertice_demo.pareceres" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --project "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/storage.objectViewer \
  --condition "expression=resource.name.startsWith(\"projects/_/buckets/$BUCKET/objects/evidencias/\"),title=somente-evidencias" \
  >/dev/null

step "9. Permite a $USER_EMAIL rodar localmente como o agente (impersonation, sem arquivo de chave)"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" \
  --member "user:$USER_EMAIL" --role roles/iam.serviceAccountTokenCreator >/dev/null

echo
echo "Pronto. Em seguida, para rodar localmente como o agente:"
echo "  gcloud auth application-default login --impersonate-service-account=$SA"
