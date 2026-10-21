// Deterministic policy (Annex A of the challenge). Pure function: no I/O, no LLM, no clock.
// "Prevalece o maior nível sustentado por achado confirmado."
import { FONTES_OBRIGATORIAS } from './tipos.ts';
import type { AchadoConferido, Motivo, Oportunidade, ProblemaEvidencia, Resultado, ResultadoTriagem } from './tipos.ts';

export const REGRAS_VERSAO = '2026-10-20.1';
const SETORES_SENSIVEIS = ['apostas', 'criptoativos', 'metais preciosos', 'comércio exterior'];
export const VALIDADE_MESES = 12;

const DESCRICAO_EVIDENCIA: Record<ProblemaEvidencia, string> = {
  EVIDENCIA_FORA_DO_CASO: 'gcs_uri fora do prefixo de evidências deste caso; objeto não foi lido.',
  EVIDENCIA_NAO_ENCONTRADA: 'Objeto referenciado em gcs_uri não existe (referência quebrada).',
  EVIDENCIA_NAO_REGISTRADA: 'Objeto existe, mas não consta no manifesto de integridade.',
  EVIDENCIA_ALTERADA: 'sha256 do objeto diverge do manifesto: arquivo alterado após a carga.',
  EVIDENCIA_DE_OUTRO_CASO: 'Snapshot pertence a outro caso; não pode sustentar este parecer.',
  EVIDENCIA_DIVERGENTE: 'Snapshot não corresponde ao achado (evidencia_id ou tipo de fonte diferente).',
  EVIDENCIA_INCOMPLETA: 'Snapshot sem evidência mínima (fonte, identificador/URL, data/hora e trecho).',
};

function vencida(consultadoEm: string, agora: Date): boolean {
  const limite = new Date(agora);
  limite.setUTCMonth(limite.getUTCMonth() - VALIDADE_MESES);
  const instante = new Date(consultadoEm);
  return Number.isNaN(instante.getTime()) || instante < limite; // unreadable date = not valid
}

/** A name match is a fact only when the snapshot carries the same identifier as the opportunity. */
const identificadorConfirmado = (achado: AchadoConferido, cnpj: string) =>
  achado.snapshot?.correspondencias.some(c => c.identificador === cnpj) ?? false;

export function classificar(op: Oportunidade, achados: AchadoConferido[], agora: Date): ResultadoTriagem {
  const fatos: Motivo[] = [];
  const pendencias: Motivo[] = [];
  let nivel = 0; // 0 LEVE · 1 MODERADO · 2 ALTO

  // 1. Completeness: every required source must have a row.
  for (const fonte of FONTES_OBRIGATORIAS) {
    if (!achados.some(a => a.tipo_fonte === fonte)) {
      pendencias.push({ codigo: 'FONTE_AUSENTE', descricao: `Nenhum registro da fonte obrigatória ${fonte}.` });
    }
  }

  // 2. Each finding: evidence integrity → query concluded → still valid → level → identifier confirmed.
  for (const a of achados) {
    const ref = { evidencia_id: a.evidencia_id, gcs_uri: a.gcs_uri };
    if (a.problema) {
      pendencias.push({ codigo: a.problema, descricao: `${a.tipo_fonte}: ${DESCRICAO_EVIDENCIA[a.problema]}`, ...ref });
      continue;
    }
    if (a.status_consulta !== 'CONCLUIDA') {
      pendencias.push({ codigo: 'FONTE_INDISPONIVEL', descricao: `Consulta ${a.tipo_fonte} não concluída (status ${a.status_consulta}).`, ...ref });
      continue;
    }
    if (vencida(a.consultado_em, agora)) {
      pendencias.push({ codigo: 'CONSULTA_VENCIDA', descricao: `Consulta ${a.tipo_fonte} de ${a.consultado_em} excede ${VALIDADE_MESES} meses.`, ...ref });
      continue;
    }
    if (a.nivel_achado === 'SEM_ACHADO') continue;
    if (a.nivel_achado !== 'MODERADO' && a.nivel_achado !== 'ALTO') {
      pendencias.push({ codigo: 'NIVEL_INVALIDO', descricao: `Consulta ${a.tipo_fonte} com nível desconhecido: ${a.nivel_achado}.`, ...ref });
      continue;
    }
    if (!identificadorConfirmado(a, op.cnpj)) {
      pendencias.push({ codigo: 'HOMONIMO', descricao: `${a.tipo_fonte}: correspondência por nome sem identificador confirmado; não vira fato, requer revisão humana.`, ...ref });
      continue;
    }
    if (a.nivel_achado === 'ALTO') {
      const codigo = a.tipo_fonte === 'SANCOES' ? 'SANCAO_CONFIRMADA' : 'ACHADO_ALTO_CONFIRMADO';
      fatos.push({ codigo, descricao: `${a.tipo_fonte}: ${a.trecho}`, ...ref });
      nivel = 2;
    } else {
      fatos.push({ codigo: 'ACHADO_MODERADO_CONFIRMADO', descricao: `${a.tipo_fonte}: ${a.trecho}`, ...ref });
      nivel = Math.max(nivel, 1);
    }
  }

  // 3. Registry facts from the opportunity record.
  const cadastro = { evidencia_id: `oportunidades:${op.caso_id}` };
  if (!op.beneficiario_final_identificado) {
    fatos.push({ codigo: 'BENEFICIARIO_NAO_IDENTIFICADO', descricao: 'Beneficiário final não identificado no cadastro.', ...cadastro });
    nivel = 2;
  }
  if (SETORES_SENSIVEIS.includes(op.setor.trim().toLowerCase())) {
    fatos.push({ codigo: 'SETOR_SENSIVEL', descricao: `Setor sensível segundo a política: ${op.setor}.`, ...cadastro });
    nivel = Math.max(nivel, 1);
  }
  if (op.situacao !== 'ATIVA') {
    pendencias.push({ codigo: 'CADASTRO_INATIVO', descricao: `Situação cadastral ${op.situacao}; Leve exige cadastro ativo.`, ...cadastro });
  }

  // 4. Final result: confirmed ALTO wins; any open item blocks a conclusion; never LEVE with open items.
  const resultado: Resultado = nivel === 2 ? 'ALTO' : pendencias.length ? 'PENDENTE' : nivel === 1 ? 'MODERADO' : 'LEVE';

  return {
    caso_id: op.caso_id,
    razao_social: op.razao_social,
    resultado,
    nivel_minimo: resultado === 'PENDENTE' && nivel === 1 ? 'MODERADO' : null,
    encaminhamento: encaminhar(resultado, op, pendencias),
    bloqueia_inicio: resultado === 'ALTO' || resultado === 'PENDENTE',
    motivos: [...fatos, ...pendencias],
    evidencias: achados.map(a => ({
      achado_id: a.achado_id,
      tipo_fonte: a.tipo_fonte,
      status_consulta: a.status_consulta,
      nivel_achado: a.nivel_achado,
      consultado_em: a.consultado_em,
      trecho: a.trecho,
      evidencia_id: a.evidencia_id,
      gcs_uri: a.gcs_uri,
      conferida: a.problema === null,
    })),
    regras_versao: REGRAS_VERSAO,
    avaliado_em: agora.toISOString(),
  };
}

function encaminhar(resultado: Resultado, op: Oportunidade, pendencias: Motivo[]): string {
  switch (resultado) {
    case 'LEVE':
      return `Gerente (${op.gerente}): parecer preliminar para revisão e autorização humana.`;
    case 'MODERADO':
      return `Sócio responsável (${op.socio}): aprovação com ressalvas e monitoramento reforçado.`;
    case 'ALTO':
      return 'Comitê de Aceitação: início bloqueado até decisão humana registrada.';
    case 'PENDENTE': {
      // Exceptions that need judgment go to a person; missing/failed queries go back to research first.
      const revisao = pendencias.some(p => p.codigo === 'HOMONIMO' || p.codigo.startsWith('EVIDENCIA_') || p.codigo === 'CADASTRO_INATIVO');
      return revisao
        ? `Revisão humana (analista responsável, gerente ${op.gerente}): exceção registrada; sem classificação até análise.`
        : `Pesquisa: refazer ou completar consultas e, persistindo a falha, escalar ao gerente ${op.gerente}.`;
    }
  }
}
