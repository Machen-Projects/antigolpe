-- AntiGolpe: tabela de log de interações
--
-- Roda no banco `n8n_prospecta` (Postgres do container `evolution-postgres`).
-- O comando para aplicar via docker exec está no README.

CREATE TABLE IF NOT EXISTS antigolpe_interacoes (
    id              BIGSERIAL PRIMARY KEY,
    telefone_hash   TEXT NOT NULL,           -- SHA-256 do número (nunca o número em texto puro)
    tipo_mensagem   TEXT NOT NULL CHECK (tipo_mensagem IN ('texto', 'imagem', 'audio')),
    conteudo_resumido TEXT,                  -- trecho/descrição curta do que foi analisado (sem PII sensível quando possível)
    classificacao   TEXT NOT NULL CHECK (classificacao IN ('golpe', 'suspeito', 'seguro', 'indeterminado')),
    tipo_golpe      TEXT,                    -- ex: phishing, boleto_falso, falsa_promocao, golpe_parente, golpe_pix, falso_funcionario, outro
    confianca       TEXT CHECK (confianca IN ('alta', 'media', 'baixa')),
    explicacao      TEXT,                    -- explicação em linguagem simples que foi enviada ao usuário
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para as consultas de "Resultados Esperados/Obtidos" do TCC
-- (contagem por classificação, por tipo de golpe, evolução no tempo).
CREATE INDEX IF NOT EXISTS idx_antigolpe_classificacao ON antigolpe_interacoes (classificacao);
CREATE INDEX IF NOT EXISTS idx_antigolpe_tipo_golpe ON antigolpe_interacoes (tipo_golpe);
CREATE INDEX IF NOT EXISTS idx_antigolpe_criado_em ON antigolpe_interacoes (criado_em);

-- Views auxiliares para estatísticas rápidas (usadas no README / seção de resultados).
CREATE OR REPLACE VIEW antigolpe_stats_por_classificacao AS
SELECT classificacao, COUNT(*) AS total
FROM antigolpe_interacoes
GROUP BY classificacao
ORDER BY total DESC;

CREATE OR REPLACE VIEW antigolpe_stats_por_tipo_golpe AS
SELECT tipo_golpe, COUNT(*) AS total
FROM antigolpe_interacoes
WHERE tipo_golpe IS NOT NULL
GROUP BY tipo_golpe
ORDER BY total DESC;

-- A tabela é criada pelo usuário "evolution" (superuser do container), mas o
-- n8n conecta com o usuário "n8n_prospecta_user" (credencial
-- "Postgres - n8n_prospecta"). Sem os GRANTs abaixo, o INSERT do workflow
-- falha com "permission denied for table antigolpe_interacoes".
GRANT SELECT, INSERT, UPDATE ON antigolpe_interacoes TO n8n_prospecta_user;
GRANT USAGE, SELECT ON SEQUENCE antigolpe_interacoes_id_seq TO n8n_prospecta_user;
GRANT SELECT ON antigolpe_stats_por_classificacao, antigolpe_stats_por_tipo_golpe TO n8n_prospecta_user;
