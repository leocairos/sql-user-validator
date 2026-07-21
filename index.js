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

// Atualizado para usar a variável de ambiente conforme solicitado
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

// QUERY ATUALIZADA: Agora inclui 'P' (Procedures) e testa a permissão correspondente
const queryAcessos = `
    SELECT 
        s.name AS SchemaName,
        t.name AS ObjectName,
        t.type_desc AS ObjectType
    FROM sys.objects t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.type IN ('U', 'V', 'P') 
      AND HAS_PERMS_BY_NAME(
          s.name + '.' + t.name, 
          'OBJECT', 
          CASE WHEN t.type = 'P' THEN 'EXECUTE' ELSE 'SELECT' END
      ) = 1
    ORDER BY ObjectType, SchemaName, ObjectName;
`;

async function runValidation() {
  let csvContent = 'login,Roles,SchemaName,ObjectName,ObjectType\n';
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
      pool = await sql.connect(config);

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

      // Extrai as Roles
      const resultRoles = await pool.request().query(queryRoles);
      const rolesArray = resultRoles.recordset.map(r => r.RoleName);
      const rolesString = rolesArray.length > 0 ? rolesArray.join('; ') : 'public';

      // Extrai as permissões de Objeto
      const resultAcessos = await pool.request().query(queryAcessos);

      if (resultAcessos.recordset.length > 0) {
        for (const row of resultAcessos.recordset) {
          csvContent += `"${creds.user}","${rolesString}","${row.SchemaName}","${row.ObjectName}","${row.ObjectType}"\n`;
        }
      } else {
        csvContent += `"${creds.user}","${rolesString}","SEM_ACESSO","Nenhum objeto de leitura/execução disponível","N/A"\n`;
      }

    } catch (err) {
      console.log(`[-] Falha ao conectar com: ${creds.user} (${err.message.split('\n')[0]})`);
      const erroLimpo = err.message.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
      csvContent += `"${creds.user}","N/A","ERRO_CONEXAO","${erroLimpo}","ERRO"\n`;
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