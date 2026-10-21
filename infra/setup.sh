#!/usr/bin/env bash
# Provisions the GCP side of the MVP: APIs, BigQuery, GCS, service account and least-privilege IAM.
# Safe to re-run. Every command passes the project explicitly (never relies on the gcloud default).
#   PROJECT=projeto-vertice-auditores bash infra/setup.sh
set -euo pipefail

PROJECT="${PROJECT:-projeto-vertice-auditores}"
REGION="${REGION:-southamerica-east1}"
BUCKET="${KYC_BUCKET:-vertice-kyc-$PROJECT}"
SA_NAME="kyc-agente"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
USER_EMAIL="$(gcloud config get account 2>/dev/null)"
cd "$(dirname "$0")/.."

# bq needs a Python; on Windows/Git Bash point it at the one gcloud already uses.
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

step "3. Tables and data"
# Input tables are rebuilt from data/*.csv on every run. They are dropped instead of loaded with
# --replace because a truncating load rewrites the schema and silently drops PK/FK constraints.
# pareceres and decisoes_humanas are never dropped.
for t in achados evidencias oportunidades; do $BQ rm -f --table "$PROJECT:vertice_demo.$t"; done
sql sql/ddl.sql
for t in oportunidades achados evidencias; do
  $BQ load --source_format=CSV --skip_leading_rows=1 "$PROJECT:vertice_demo.$t" "data/$t.csv"
done

step "4. Bucket gs://$BUCKET (uniform access, no public access, versioning)"
gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --project "$PROJECT" --versioning

step "5. Evidence snapshots"
gcloud storage rsync --recursive data/gcs/evidencias "gs://$BUCKET/evidencias" --project "$PROJECT"

step "6. Authorized table function"
sql sql/fn_caso.sql
# Add or remove an access entry of a dataset (bq has no flag for authorized routines / single readers).
dataset_access() { # add|remove dataset json-entry
  local f="infra/.dataset-$2.json"
  $BQ show --format=prettyjson "$PROJECT:$2" > "$f"
  node -e '
    const fs = require("fs"); const [mode, f, entry] = process.argv.slice(1);
    const ds = JSON.parse(fs.readFileSync(f, "utf8")); const e = JSON.parse(entry);
    const canon = v => v && typeof v === "object" ? JSON.stringify(Object.keys(v).sort().map(k => [k, canon(v[k])])) : JSON.stringify(v);
    ds.access = ds.access.filter(a => canon(a) !== canon(e)); // BigQuery may return keys in another order
    if (mode === "add") ds.access.push(e);
    fs.writeFileSync(f, JSON.stringify(ds));' "$1" "$f" "$3"
  $BQ update --source "$f" "$PROJECT:$2" >/dev/null
  rm -f "$f"
}
# CREATE OR REPLACE invalidates the authorization, so it is removed and granted again on every run.
ROUTINE="{\"routine\":{\"projectId\":\"$PROJECT\",\"datasetId\":\"vertice_api\",\"routineId\":\"fn_caso\"}}"
dataset_access remove vertice_demo "$ROUTINE"
dataset_access add vertice_demo "$ROUTINE"

step "7. Service account $SA"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name "KYC triage agent (read one case, write pareceres)"
  sleep 15 # new service accounts take a few seconds to be usable in IAM policies
fi

step "8. Least-privilege IAM for the agent"
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

step "9. Let $USER_EMAIL run locally as the agent (impersonation, no key file)"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" \
  --member "user:$USER_EMAIL" --role roles/iam.serviceAccountTokenCreator >/dev/null

echo
echo "Done. Next, run locally as the agent:"
echo "  gcloud auth application-default login --impersonate-service-account=$SA"
