require('dotenv').config();

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const loginsPath = path.join(__dirname, '../logins.json');

if (!fs.existsSync(loginsPath)) {
  console.error('ERRO: O ficheiro logins.json não foi encontrado.');
  process.exit(1);
}

const loginsToTest = JSON.parse(fs.readFileSync(loginsPath, 'utf8'));

const dbConfigBase = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10), // Garante que a porta é um número inteiro
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    readOnlyIntent: process.env.DB_READ_ONLY_INTENT === 'true'
  }
};

const queryAcessos = `
    SELECT 
        s.name AS SchemaName,
        t.name AS ObjectName,
        t.type_desc AS ObjectType
    FROM sys.objects t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.type IN ('U', 'V')
      AND HAS_PERMS_BY_NAME(s.name + '.' + t.name, 'OBJECT', 'SELECT') = 1
    ORDER BY ObjectType, SchemaName, ObjectName;
`;

async function runValidation() {
  let csvContent = 'login,SchemaName,ObjectName,ObjectType\n';

  for (const creds of loginsToTest) {
    console.log(`A validar o acesso para: ${creds.user}...`);

    const config = {
      ...dbConfigBase,
      user: creds.user,
      password: creds.password
    };

    let pool;
    try {
      pool = await sql.connect(config);
      const result = await pool.request().query(queryAcessos);

      if (result.recordset.length > 0) {
        for (const row of result.recordset) {
          csvContent += `"${creds.user}","${row.SchemaName}","${row.ObjectName}","${row.ObjectType}"\n`;
        }
      } else {
        csvContent += `"${creds.user}","SEM_ACESSO","Nenhum objeto de leitura disponível","N/A"\n`;
      }

    } catch (err) {
      const erroLimpo = err.message.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
      csvContent += `"${creds.user}","ERRO_CONEXAO","${erroLimpo}","ERRO"\n`;
    } finally {
      if (pool) {
        await pool.close();
      }
    }
  }

  const fileName = 'resultado_acessos.csv';
  fs.writeFileSync(fileName, csvContent, 'utf-8');

  console.log(`\nConcluído! Os resultados foram exportados para o ficheiro: ${fileName}`);
}

// Validação de segurança básica antes de tentar estabelecer qualquer ligação
if (!process.env.DB_SERVER || !process.env.DB_PORT || !process.env.DB_NAME) {
  console.error('ERRO: Faltam parâmetros de configuração no ficheiro .env. Por favor, verifique se o ficheiro foi criado corretamente.');
  process.exit(1);
}

runValidation();