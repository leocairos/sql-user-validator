require('dotenv').config();

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const loginsPath = path.join(__dirname, 'logins.json');

if (!fs.existsSync(loginsPath)) {
  console.error('ERRO: O arquivo logins.json não foi encontrado.');
  process.exit(1);
}

const loginsToTest = JSON.parse(fs.readFileSync(loginsPath, 'utf8'));

const dbConfigBase = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    readOnlyIntent: process.env.DB_READ_ONLY_INTENT === 'true'
  }
};

// Query para capturar as informações do ambiente
const queryServerInfo = `
    SELECT 
        DATABASEPROPERTYEX('${process.env.DB_NAME}', 'Updateability') AS DbStatus,
        @@SERVERNAME AS ServerName,
        ISNULL(CAST(SERVERPROPERTY('InstanceName') AS VARCHAR), 'MSSQLSERVER (Default)') AS InstanceName
`;

const queryRoles = `
    SELECT r.name AS RoleName
    FROM sys.database_role_members rm
    JOIN sys.database_principals r ON rm.role_principal_id = r.principal_id
    WHERE rm.member_principal_id = DATABASE_PRINCIPAL_ID();
`;

// Permissões em nível de OBJETO:
// tabela/view inteira (SELECT) ou procedure (EXECUTE)
const queryAcessos = `
    SELECT 
        s.name AS SchemaName,
        t.name AS ObjectName,
        t.type_desc AS ObjectType
    FROM sys.objects t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.type IN ('U', 'V', 'P') 
      AND HAS_PERMS_BY_NAME(
          QUOTENAME(s.name) + '.' + QUOTENAME(t.name), 
          'OBJECT', 
          CASE WHEN t.type = 'P' THEN 'EXECUTE' ELSE 'SELECT' END
      ) = 1
    ORDER BY ObjectType, SchemaName, ObjectName;
`;

// Permissões em nível de COLUNA:
// tabelas/views em que o usuário NÃO tem SELECT no objeto inteiro,
// mas tem SELECT em uma ou mais colunas.
// Ex.: GRANT SELECT ON SA4020 (A4_COD, A4_NOME, D_E_L_E_T_) TO user01;
const queryAcessosColunas = `
    SELECT
        s.name AS SchemaName,
        t.name AS ObjectName,
        t.type_desc AS ObjectType,
        c.name AS ColumnName
    FROM sys.objects t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id
    WHERE t.type IN ('U', 'V')
      AND HAS_PERMS_BY_NAME(
          QUOTENAME(s.name) + '.' + QUOTENAME(t.name),
          'OBJECT', 'SELECT'
      ) = 0
      AND HAS_PERMS_BY_NAME(
          QUOTENAME(s.name) + '.' + QUOTENAME(t.name),
          'OBJECT', 'SELECT', c.name, 'COLUMN'
      ) = 1
    ORDER BY ObjectType, SchemaName, ObjectName, c.column_id;
`;

// Helpers de CSV (escapa aspas e remove quebras de linha)
const csv = (valor) => `"${String(valor ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
const linhaCsv = (...campos) => campos.map(csv).join(',') + '\n';

// Agrupa as linhas por objeto, juntando as colunas permitidas
function agruparColunas(rows) {
  const mapa = new Map();
  for (const r of rows) {
    const chave = `${r.SchemaName}.${r.ObjectName}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        SchemaName: r.SchemaName,
        ObjectName: r.ObjectName,
        ObjectType: r.ObjectType,
        colunas: []
      });
    }
    mapa.get(chave).colunas.push(r.ColumnName);
  }
  return [...mapa.values()];
}

async function runValidation() {
  let csvContent = 'login,Roles,SchemaName,ObjectName,ObjectType,NivelAcesso,Colunas\n';
  let isServerInfoPrinted = false;

  console.log('Iniciando validação de acessos...\n');

  for (const creds of loginsToTest) {
    const config = {
      ...dbConfigBase,
      user: creds.user,
      password: creds.password
    };

    let pool;
    try {
      pool = await new sql.ConnectionPool(config).connect();

      // Imprime as informações do servidor na PRIMEIRA conexão bem sucedida
      if (!isServerInfoPrinted) {
        const infoResult = await pool.request().query(queryServerInfo);
        const info = infoResult.recordset[0];

        console.log('==================================================');
        console.log('📌 INFORMAÇÕES DO AMBIENTE CONECTADO');
        console.log(`📡 Servidor: ${info.ServerName}`);
        console.log(`🖥️ Instância: ${info.InstanceName}`);
        console.log(`📂 Banco de Dados: ${process.env.DB_NAME}`);
        console.log(`🚦 Status da Base (Updateability): ${info.DbStatus}`);
        console.log('==================================================\n');

        isServerInfoPrinted = true;
      }

      console.log(`[+] Validando acesso para: ${creds.user}...`);

      // Roles
      const resultRoles = await pool.request().query(queryRoles);
      const rolesArray = resultRoles.recordset.map(r => r.RoleName);
      const rolesString = rolesArray.length > 0 ? rolesArray.join('; ') : 'public';

      // Permissões de objeto
      const resultAcessos = await pool.request().query(queryAcessos);
      const acessosObjeto = resultAcessos.recordset;

      // Permissões de coluna
      const resultColunas = await pool.request().query(queryAcessosColunas);
      const acessosColuna = agruparColunas(resultColunas.recordset);

      console.log(`    Objetos com acesso total: ${acessosObjeto.length} | Tabelas/views com acesso por coluna: ${acessosColuna.length}`);

      for (const row of acessosObjeto) {
        csvContent += linhaCsv(
          creds.user, rolesString, row.SchemaName, row.ObjectName, row.ObjectType,
          'OBJETO', row.ObjectType === 'SQL_STORED_PROCEDURE' ? 'N/A' : '*'
        );
      }

      for (const obj of acessosColuna) {
        csvContent += linhaCsv(
          creds.user, rolesString, obj.SchemaName, obj.ObjectName, obj.ObjectType,
          'COLUNA', obj.colunas.join('; ')
        );
      }

      if (acessosObjeto.length === 0 && acessosColuna.length === 0) {
        csvContent += linhaCsv(
          creds.user, rolesString, 'SEM_ACESSO',
          'Nenhum objeto de leitura/execução disponível', 'N/A', 'N/A', 'N/A'
        );
      }

    } catch (err) {
      console.log(`[-] Falha ao conectar com: ${creds.user} (${err.message.split('\n')[0]})`);
      csvContent += linhaCsv(creds.user, 'N/A', 'ERRO_CONEXAO', err.message, 'ERRO', 'N/A', 'N/A');
    } finally {
      if (pool) {
        await pool.close();
      }
    }
  }

  const fileName = 'resultado_acessos.csv';
  fs.writeFileSync(fileName, csvContent, 'utf-8');

  console.log(`\n✅ Concluído! Resultados exportados para o arquivo: ${fileName}`);
}

// Validação de variáveis obrigatórias
if (!process.env.DB_SERVER || !process.env.DB_PORT || !process.env.DB_NAME) {
  console.error('ERRO: Faltam parâmetros no .env (DB_SERVER, DB_PORT, DB_NAME).');
  process.exit(1);
}

runValidation();